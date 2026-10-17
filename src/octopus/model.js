// -----------------------------------------------------------------------------
// Octopus JSON -> plain values. Pure: no I/O, no Gladys.
//
// Tariff codes read `<fuel>-<registers>R-<product code>-<region>`, e.g.
// E-1R-AGILE-24-10-01-C (electricity, one register, Agile, London) or
// G-1R-VAR-22-11-01-A. The unit rates and standing charges are published per
// tariff code in pence, VAT included or not: the integration keeps the VAT
// included value, in pounds. A rate holds over [valid_from, valid_to), with
// `valid_to: null` for a rate still in force (fixed and flexible tariffs);
// Agile has one rate per half hour.
//
// The tariff and meter logic follows BottlecapDave/HomeAssistant-OctopusEnergy
// (MIT, Copyright (c) 2021 David Kendall), ported to JavaScript.
// -----------------------------------------------------------------------------

import { GAS_VOLUME_CORRECTION } from '../constants.js';

const HALF_HOUR = 30 * 60_000;
const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const time = (value) => {
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
};

// --- Tariffs ---------------------------------------------------------------------

// Regions are the GSP groups A..P without I and O.
const TARIFF = /^([EG])-([12])R-([A-Z0-9-]+)-([A-HJ-NP])$/;

/** `{ fuel: 'electricity' | 'gas', registers, product, region }`, or undefined. */
export function parseTariff(code) {
  const match = TARIFF.exec(String(code ?? '').trim());
  if (!match) {
    return undefined;
  }
  return {
    fuel: match[1] === 'G' ? 'gas' : 'electricity',
    registers: Number(match[2]),
    product: match[3],
    region: match[4],
  };
}

export const productOf = (code) => parseTariff(code)?.product;

/**
 * The agreement in force at `t`, else the nearest one in time (a half hour
 * just outside the agreements, e.g. before the first one, is priced with its
 * neighbour); undefined only without any agreement.
 */
export function agreementNear(agreements = [], t) {
  const exact = agreementAt(agreements, t);
  if (exact) {
    return exact;
  }
  let best;
  let bestDistance = Infinity;
  for (const a of agreements) {
    const from = time(a.valid_from);
    if (from === null) {
      continue;
    }
    const to = a.valid_to ? time(a.valid_to) : Infinity;
    const distance = t < from ? from - t : t - to;
    if (distance < bestDistance) {
      best = a;
      bestDistance = distance;
    }
  }
  return best;
}

/** The agreement in force at `t`, or undefined. */
export function agreementAt(agreements = [], t) {
  return agreements.find((a) => {
    const from = time(a.valid_from);
    const to = a.valid_to ? time(a.valid_to) : null;
    return from !== null && from <= t && (to === null || t < to);
  });
}

/**
 * The meters of an account in use at `t`: import electricity meter points and
 * gas meter points with an agreement in force. Export points (solar) are left
 * out. `serials` lists the meters of a point, newest last (a replaced meter
 * stays in the list).
 */
export function metersOf(account = {}, t) {
  const meters = [];
  for (const property of account.properties ?? []) {
    const movedOut = property.moved_out_at ? time(property.moved_out_at) : null;
    if (movedOut !== null && movedOut <= t) {
      continue;
    }
    const place = [property.address_line_1, property.postcode].filter(Boolean).join(', ');
    for (const point of property.electricity_meter_points ?? []) {
      const agreement = agreementAt(point.agreements, t);
      if (point.is_export || !point.mpan || !agreement) {
        continue;
      }
      meters.push({
        kind: 'electricity',
        point: String(point.mpan),
        serials: (point.meters ?? []).map((m) => m.serial_number).filter(Boolean),
        agreements: point.agreements ?? [],
        tariffCode: agreement.tariff_code,
        place,
      });
    }
    for (const point of property.gas_meter_points ?? []) {
      const agreement = agreementAt(point.agreements, t);
      if (!point.mprn || !agreement) {
        continue;
      }
      meters.push({
        kind: 'gas',
        point: String(point.mprn),
        serials: (point.meters ?? []).map((m) => m.serial_number).filter(Boolean),
        agreements: point.agreements ?? [],
        tariffCode: agreement.tariff_code,
        place,
      });
    }
  }
  return meters;
}

/** The current Agile import product among the public products, or undefined. */
export function pickAgileProduct(products = [], t) {
  return products
    .filter(
      (p) =>
        /^AGILE-\d/.test(p.code ?? '') &&
        (p.direction ?? 'IMPORT') === 'IMPORT' &&
        !p.is_business &&
        (!p.available_to || time(p.available_to) > t),
    )
    .sort((a, b) => (time(b.available_from) ?? 0) - (time(a.available_from) ?? 0))[0]?.code;
}

export const agileTariffCode = (product, region) => `E-1R-${product}-${region}`;

// --- Rates -> slots --------------------------------------------------------------

/**
 * Rates (pence) -> sorted slots `{ startsAt, endsAt, price }` in pounds, VAT
 * included; `endsAt` is null for a rate still in force. When a tariff lists
 * one rate per payment method, the direct debit one wins (as on most bills).
 */
export function slotsOf(rates = []) {
  const byStart = new Map();
  for (const rate of rates) {
    const start = time(rate?.valid_from);
    const pence = num(rate?.value_inc_vat);
    if (start === null || pence === null) {
      continue;
    }
    const key = new Date(start).toISOString();
    const known = byStart.get(key);
    if (known && rate.payment_method === 'NON_DIRECT_DEBIT') {
      continue;
    }
    const end = rate.valid_to ? time(rate.valid_to) : null;
    byStart.set(key, {
      startsAt: key,
      endsAt: end === null ? null : new Date(end).toISOString(),
      price: Math.round(pence * 1000) / 100000,
    });
  }
  return [...byStart.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** The slot containing `t`, or undefined. */
export function slotAt(slots, t) {
  const iso = new Date(t).toISOString();
  // The latest start wins: a rate still in force never hides a newer one.
  for (let i = slots.length - 1; i >= 0; i -= 1) {
    const s = slots[i];
    if (s.startsAt <= iso && (s.endsAt === null || iso < s.endsAt)) {
      return s;
    }
  }
  return undefined;
}

// --- Local time ------------------------------------------------------------------

/** The local calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function localDate(t, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(t));
}

/** The local wall clock { hour, minute } of an instant. */
export function localClock(t, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(new Date(t))
    .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return { hour: Number(parts.hour), minute: Number(parts.minute) };
}

/** The local midnight starting the day of `t` (DST-safe: steps back by half hours). */
export function startOfLocalDay(t, timeZone) {
  const date = localDate(t, timeZone);
  let start = Math.floor(t / HALF_HOUR) * HALF_HOUR;
  while (localDate(start - HALF_HOUR, timeZone) === date) {
    start -= HALF_HOUR;
  }
  return start;
}

/**
 * The local midnight starting the day after `t`. Never `t + 24 h`: a local
 * day lasts 23 hours in March and 25 hours in October.
 */
export function nextLocalDay(t, timeZone) {
  const date = localDate(t, timeZone);
  let next = startOfLocalDay(t, timeZone) + 22 * 60 * 60_000;
  while (localDate(next, timeZone) === date) {
    next += HALF_HOUR;
  }
  return next;
}

/** The instant of a local wall-clock time on the day of `t` (DST-safe). */
export function localTimeOn(t, { hour, minute }, timeZone) {
  let at = startOfLocalDay(t, timeZone) + (hour * 60 + minute) * 60_000;
  const clock = localClock(at, timeZone);
  at += ((hour - clock.hour) * 60 + (minute - clock.minute)) * 60_000;
  return at;
}

// --- Agile price state -------------------------------------------------------------

// Only the short slots of a time-of-use tariff (Agile: 30 minutes) make a price curve.
const halfHourly = (slots) =>
  slots.filter(
    (s) => s.endsAt !== null && Date.parse(s.endsAt) - Date.parse(s.startsAt) <= 2 * HALF_HOUR,
  );

export function slotsOfDay(slots, date, timeZone) {
  return halfHourly(slots).filter((s) => localDate(s.startsAt, timeZone) === date);
}

export function stats(slots) {
  if (slots.length === 0) {
    return null;
  }
  const prices = slots.map((s) => s.price);
  return {
    avg: prices.reduce((a, b) => a + b, 0) / prices.length,
    min: Math.min(...prices),
    max: Math.max(...prices),
  };
}

const slotMinutes = (slot) => (Date.parse(slot.endsAt) - Date.parse(slot.startsAt)) / 60_000;

/** The `hours` cheapest hours of a day: the start instants of its N cheapest slots. */
export function cheapSlots(daySlots, hours) {
  if (daySlots.length === 0) {
    return new Set();
  }
  const count = Math.min(
    daySlots.length,
    Math.max(1, Math.round((hours * 60) / slotMinutes(daySlots[0]))),
  );
  return new Set(
    [...daySlots]
      .sort((a, b) => a.price - b.price || a.startsAt.localeCompare(b.startsAt))
      .slice(0, count)
      .map((s) => s.startsAt),
  );
}

/** The cheapest `hours` consecutive hours among `slots`, or undefined if too short. */
export function cheapestWindow(slots, hours) {
  const usable = halfHourly(slots);
  if (usable.length === 0) {
    return undefined;
  }
  const size = Math.max(1, Math.round((hours * 60) / slotMinutes(usable[0])));
  let best;
  for (let i = 0; i + size <= usable.length; i += 1) {
    const window = usable.slice(i, i + size);
    if (window.some((s, j) => j > 0 && s.startsAt !== window[j - 1].endsAt)) {
      continue;
    }
    const avg = window.reduce((a, s) => a + s.price, 0) / size;
    if (!best || avg < best.avg) {
      best = { start: window[0].startsAt, end: window[size - 1].endsAt, avg };
    }
  }
  return best;
}

/** The state of half-hourly prices (Agile) at an instant. */
export function priceState(slots, t, { timeZone, cheapHours }) {
  const slot = slotAt(slots, t);
  if (!slot) {
    return undefined;
  }
  const daySlots = slotsOfDay(slots, localDate(t, timeZone), timeZone);
  const cheap = cheapSlots(daySlots, cheapHours);
  const tomorrowSlots = slotsOfDay(slots, localDate(nextLocalDay(t, timeZone), timeZone), timeZone);
  return {
    slot,
    next: slot.endsAt ? slotAt(slots, Date.parse(slot.endsAt)) : undefined,
    stats: stats(daySlots),
    cheap: cheap.has(slot.startsAt),
    negative: slot.price < 0,
    tomorrow:
      tomorrowSlots.length > 0 ? { slots: tomorrowSlots, stats: stats(tomorrowSlots) } : null,
  };
}

// --- Consumption --------------------------------------------------------------------

/** m³ of gas -> kWh (Ofgem: × volume correction × calorific value ÷ 3.6). */
export const gasKwh = (m3, calorificValue) => (m3 * GAS_VOLUME_CORRECTION * calorificValue) / 3.6;

/**
 * The kWh of a local day [from, to) from 30-minute intervals, or null while
 * the day is incomplete (Octopus readings arrive late: a partial total would
 * look like a low day).
 */
export function dayTotal(intervals, from, to) {
  const inDay = intervals.filter((i) => {
    const t = Date.parse(i.starts_at);
    return t >= from && t < to;
  });
  if (inDay.length < Math.round((to - from) / HALF_HOUR)) {
    return null;
  }
  return Math.round(inDay.reduce((sum, i) => sum + i.kwh, 0) * 1000) / 1000;
}

/**
 * Octopus consumption results -> 30-minute intervals in kWh: elapsed,
 * aligned, finite (gas read in m³ on SMETS2 meters is converted).
 */
export function consumptionIntervals(results = [], { now, gasM3 = false, calorificValue = 40 }) {
  const byStart = new Map();
  for (const item of results) {
    const start = time(item?.interval_start);
    const end = time(item?.interval_end) ?? (start === null ? null : start + HALF_HOUR);
    const value = num(item?.consumption);
    if (start === null || value === null || value < 0 || end > now || start % HALF_HOUR !== 0) {
      continue;
    }
    const kwh = gasM3 ? gasKwh(value, calorificValue) : value;
    byStart.set(start, {
      starts_at: new Date(start).toISOString(),
      kwh: Math.round(kwh * 10000) / 10000,
    });
  }
  return [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}
