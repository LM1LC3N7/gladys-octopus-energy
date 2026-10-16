// -----------------------------------------------------------------------------
// Agile transitions -> scene events. Pure. Nothing fires without a previous
// value: the first reading after a start only sets the baseline.
// -----------------------------------------------------------------------------

import { CURRENCY, SCENE_TRIGGERS } from './constants.js';
import { cheapestWindow } from './octopus/model.js';

const base = (device, price) => ({
  device,
  price: price.slot.price,
  currency: CURRENCY,
  ends_at: price.slot.endsAt,
});

/** The events between two Agile price states of a region. */
export function priceEvents(device, previous, current) {
  const events = [];
  if (!previous || !current || previous.slot.startsAt === current.slot.startsAt) {
    return events;
  }
  if (current.cheap !== previous.cheap) {
    events.push({
      key: current.cheap ? SCENE_TRIGGERS.CHEAP_STARTED : SCENE_TRIGGERS.CHEAP_ENDED,
      data: base(device, current),
    });
  }
  if (current.negative && !previous.negative) {
    events.push({ key: SCENE_TRIGGERS.NEGATIVE_STARTED, data: base(device, current) });
  }
  return events;
}

/** Tomorrow's Agile prices just appeared. */
export function tomorrowEvent(device, tomorrow, cheapHours) {
  // The cheapest consecutive window: something a scene can wait for.
  const window = cheapestWindow(tomorrow.slots, cheapHours);
  return {
    key: SCENE_TRIGGERS.TOMORROW,
    data: {
      device,
      currency: CURRENCY,
      average: tomorrow.stats.avg,
      min: tomorrow.stats.min,
      max: tomorrow.stats.max,
      negative_slots: tomorrow.slots.filter((s) => s.price < 0).length,
      cheapest_start: window?.start ?? null,
      cheapest_end: window?.end ?? null,
    },
  };
}
