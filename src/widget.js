// -----------------------------------------------------------------------------
// The "Octopus prices" dashboard widget. Pure.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { CURRENCY } from './constants.js';
import { T } from './i18n.js';
import { cheapestWindow, localClock } from './octopus/model.js';

const pick = (text, language) => (typeof text === 'string' ? text : (text[language] ?? text.en));
const money = (value) =>
  value === null || value === undefined ? '—' : `${value.toFixed(4)} ${CURRENCY}`;
const hhmm = (iso, timeZone) => {
  const { hour, minute } = localClock(Date.parse(iso), timeZone);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

const priceColor = (price) =>
  price < 0 ? WIDGET_COLORS.SUCCESS : price > 0.3 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL;

/** `entry`: `{ name, slots, price, standingCharge }` of an Agile region or a meter. */
export function pricesWidget({ entry, cheapHours, now, timeZone, language = 'en' }) {
  const components = [{ type: 'text', text: entry.name, variant: 'heading' }];
  const price = entry.price;
  if (!price?.slot) {
    components.push({ type: 'text', text: T.widget.noData, variant: 'body' });
    return { ttl_seconds: 60, components };
  }
  components.push({
    type: 'value',
    label: T.widget.now,
    value: price.slot.price.toFixed(4),
    unit: CURRENCY,
    color: priceColor(price.slot.price),
  });
  if (price.next) {
    components.push({
      type: 'value',
      label: T.widget.next,
      value: price.next.price.toFixed(4),
      unit: CURRENCY,
    });
  }
  if (price.stats) {
    components.push({
      type: 'value',
      label: T.widget.today,
      value: price.stats.avg.toFixed(4),
      unit: CURRENCY,
    });
  }
  if (price.tomorrow) {
    components.push({
      type: 'value',
      label: T.widget.tomorrow,
      value: price.tomorrow.stats.avg.toFixed(4),
      unit: CURRENCY,
    });
  }
  const nowIso = new Date(now).toISOString();
  const upcoming = entry.slots.filter((s) => s.endsAt && s.endsAt > nowIso);
  const items = [];
  const window = cheapestWindow(upcoming.slice(0, 96), cheapHours);
  if (window) {
    items.push({
      label: pick(T.widget.cheapest(cheapHours), language),
      value:
        `${hhmm(window.start, timeZone)} – ${hhmm(window.end, timeZone)} · ${money(window.avg)}`.slice(
          0,
          40,
        ),
      icon: 'clock',
      color: WIDGET_COLORS.SUCCESS,
    });
  }
  if (price.stats) {
    const negatives = upcoming.filter((s) => s.price < 0).length;
    items.push({
      label: T.widget.negative,
      value: pick(T.widget.negativeCount(negatives), language),
      icon: 'trending-down',
      color: negatives > 0 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    });
    items.push({
      label: T.widget.tomorrowRow,
      value: pick(price.tomorrow ? T.widget.published : T.widget.notYet, language),
      icon: 'calendar',
      color: price.tomorrow ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    });
  }
  if (entry.standingCharge) {
    items.push({
      label: T.widget.standing,
      value: `${entry.standingCharge.price.toFixed(4)} ${CURRENCY}/day`,
      icon: 'home',
    });
  }
  if (items.length > 0) {
    components.push({ type: 'status', items });
  }
  const points = entry.slots
    .filter((s) => s.endsAt && Date.parse(s.endsAt) - Date.parse(s.startsAt) <= 60 * 60_000)
    .slice(-300)
    .map((s) => ({ t: s.startsAt, v: Math.round(s.price * 10000) / 10000 }));
  if (points.length > 1) {
    components.push({
      type: 'chart',
      chart_type: 'stepline',
      title: T.widget.chart,
      unit: CURRENCY,
      now_marker: true,
      series: [{ name: `${CURRENCY}/kWh`, points }],
    });
  }
  return { ttl_seconds: 300, components };
}
