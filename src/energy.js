// -----------------------------------------------------------------------------
// The delegated energy contract: the core sends the 30-minute intervals of a
// billing period, the integration answers one cost per interval from the
// unit rates of the tariff the meter point was on at that instant (the
// account agreements: a tariff change mid-period is priced right). Pure; the
// rates are fetched by the app.
// -----------------------------------------------------------------------------

import { agreementAt, parseTariff, slotAt } from './octopus/model.js';

const HALF_HOUR = 30 * 60_000;

/** The tariff codes the intervals need, with the range of each: `[{ tariffCode, from, to }]`. */
export function tariffRanges(intervals, agreements) {
  const ranges = new Map();
  for (const { starts_at } of intervals) {
    const t = Date.parse(starts_at);
    const agreement = agreementAt(agreements, t);
    if (!agreement) {
      throw new Error(`No Octopus agreement in force on ${starts_at}`);
    }
    const range = ranges.get(agreement.tariff_code) ?? { from: t, to: t + HALF_HOUR };
    range.from = Math.min(range.from, t);
    range.to = Math.max(range.to, t + HALF_HOUR);
    ranges.set(agreement.tariff_code, range);
  }
  return [...ranges.entries()].map(([tariffCode, r]) => ({ tariffCode, ...r }));
}

/**
 * The costs of the intervals. `slotsByTariff` maps a tariff code to its rate
 * slots (src/octopus/model.js `slotsOf`). A negative Agile price is a credit
 * the core cannot take (a cost is ≥ 0): it counts as zero.
 */
export function intervalCosts(intervals, agreements, slotsByTariff) {
  return intervals.map(({ starts_at, kwh }) => {
    const t = Date.parse(starts_at);
    const tariffCode = agreementAt(agreements, t)?.tariff_code;
    const slot = slotAt(slotsByTariff.get(tariffCode) ?? [], t);
    if (!slot) {
      // Never a silent zero: the core retries the interval at its next run.
      throw new Error(`No Octopus unit rate for ${starts_at}`);
    }
    return {
      starts_at,
      cost: Math.max(0, kwh * slot.price),
      label: (parseTariff(tariffCode)?.product ?? 'Octopus').slice(0, 64),
    };
  });
}
