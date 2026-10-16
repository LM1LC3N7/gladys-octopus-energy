// -----------------------------------------------------------------------------
// The pure model: tariff codes, meters of an account, rates -> slots, the
// Agile price state, consumption intervals and the delegated pricing.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import { intervalCosts, tariffRanges } from '../src/energy.js';
import {
  agreementAt,
  cheapestWindow,
  consumptionIntervals,
  gasKwh,
  metersOf,
  parseTariff,
  pickAgileProduct,
  priceState,
  slotAt,
  slotsOf,
  startOfLocalDay,
} from '../src/octopus/model.js';
import { tomorrowEvent } from '../src/triggers.js';
import {
  AGILE_RATES,
  AGILE_TARIFF,
  FLAT_RATES,
  MPAN,
  MPRN,
  NOW,
  OLD_RATES,
  OLD_SERIAL,
  OLD_TARIFF,
  PRODUCTS,
  SERIAL,
  account,
  readings,
} from './fixtures/octopus.js';

const LONDON = 'Europe/London';

test('tariff codes', () => {
  assert.deepEqual(parseTariff('E-1R-AGILE-24-10-01-C'), {
    fuel: 'electricity',
    registers: 1,
    product: 'AGILE-24-10-01',
    region: 'C',
  });
  assert.equal(parseTariff('G-1R-VAR-22-11-01-N').fuel, 'gas');
  assert.equal(parseTariff('E-2R-VAR-22-11-01-A').registers, 2);
  assert.equal(parseTariff('nope'), undefined);
  assert.equal(parseTariff('E-1R-AGILE-24-10-01-I'), undefined, 'no region I');
});

test('the meters in use: export points and moved-out properties are left out', () => {
  const meters = metersOf(account(), NOW);
  assert.deepEqual(
    meters.map((m) => [m.kind, m.point, m.tariffCode]),
    [
      ['electricity', MPAN, AGILE_TARIFF],
      ['gas', MPRN, 'G-1R-VAR-22-11-01-C'],
    ],
  );
  assert.deepEqual(meters[0].serials, [OLD_SERIAL, SERIAL]);
  assert.equal(
    agreementAt(meters[0].agreements, Date.parse('2026-09-30T22:30:00Z')).tariff_code,
    OLD_TARIFF,
    'before the switch (midnight BST = 23:00Z)',
  );
});

test('the current Agile product skips the outgoing and withdrawn ones', () => {
  assert.equal(pickAgileProduct(PRODUCTS, NOW), 'AGILE-24-10-01');
  assert.equal(pickAgileProduct([], NOW), undefined);
});

test('rates -> slots in pounds, direct debit first, open-ended rates', () => {
  const flat = slotsOf(FLAT_RATES);
  assert.equal(flat.length, 1);
  assert.equal(flat[0].price, 0.0609);
  assert.equal(flat[0].endsAt, null);
  assert.equal(slotAt(flat, NOW).price, 0.0609);
  const agile = slotsOf(AGILE_RATES);
  assert.equal(agile.length, 94);
  assert.ok(agile[0].startsAt < agile[1].startsAt, 'sorted oldest first');
  assert.equal(slotAt(agile, Date.parse('2026-10-16T11:10:00Z')).price, 0.2666);
  assert.equal(slotAt(agile, Date.parse('2026-10-18T11:10:00Z')), undefined);
});

test('the local day, across the end of British Summer Time', () => {
  assert.equal(
    new Date(startOfLocalDay(NOW, LONDON)).toISOString(),
    '2026-10-15T23:00:00.000Z',
    'midnight BST',
  );
  assert.equal(
    new Date(startOfLocalDay(Date.parse('2026-10-25T20:00:00Z'), LONDON)).toISOString(),
    '2026-10-24T23:00:00.000Z',
    'the 25-hour day starts at midnight BST',
  );
  assert.equal(
    new Date(startOfLocalDay(Date.parse('2026-10-26T08:00:00Z'), LONDON)).toISOString(),
    '2026-10-26T00:00:00.000Z',
    'then midnight GMT',
  );
});

test('the Agile price state of a real day', () => {
  const slots = slotsOf(AGILE_RATES);
  const now = priceState(slots, NOW, { timeZone: LONDON, cheapHours: 3 });
  assert.equal(now.slot.startsAt, '2026-10-16T10:30:00.000Z');
  assert.equal(now.next.startsAt, '2026-10-16T11:00:00.000Z');
  assert.equal(now.stats.min, 0.2466);
  assert.equal(now.stats.max, 0.5386);
  assert.equal(now.cheap, false);
  assert.equal(now.negative, false);
  assert.ok(now.tomorrow, "tomorrow's prices are in the answer");
  assert.equal(now.tomorrow.slots.length, 46, 'up to 23:00 tomorrow');
  const later = priceState(slots, Date.parse('2026-10-16T11:10:00Z'), {
    timeZone: LONDON,
    cheapHours: 3,
  });
  assert.equal(later.cheap, true, '11:00Z is one of the 6 cheapest half hours');
  const window = cheapestWindow(
    slots.filter((s) => s.startsAt < '2026-10-16T23:00:00.000Z'),
    3,
  );
  assert.equal(window.start, '2026-10-16T11:00:00.000Z');
  assert.equal(window.end, '2026-10-16T14:00:00.000Z');
  const event = tomorrowEvent('dev', now.tomorrow, 2);
  assert.equal(event.data.negative_slots, 0);
  assert.ok(event.data.cheapest_start < event.data.cheapest_end);
});

test('consumption intervals: elapsed, aligned, gas m³ converted', () => {
  const results = [
    ...readings('2026-10-15T00:00:00Z', '2026-10-15T01:00:00Z', 1),
    {
      consumption: 1,
      interval_start: '2026-10-15T01:10:00Z',
      interval_end: '2026-10-15T01:40:00Z',
    },
    { consumption: null, interval_start: '2026-10-15T02:00:00Z' },
    ...readings('2026-10-16T10:30:00Z', '2026-10-16T11:00:00Z', 1),
  ];
  const electricity = consumptionIntervals(results, { now: NOW });
  assert.deepEqual(electricity, [
    { starts_at: '2026-10-15T00:00:00.000Z', kwh: 1 },
    { starts_at: '2026-10-15T00:30:00.000Z', kwh: 1 },
  ]);
  const gas = consumptionIntervals(results, { now: NOW, gasM3: true, calorificValue: 40 });
  assert.equal(gas[0].kwh, 11.3627);
  assert.equal(Math.round(gasKwh(5, 40) * 1000) / 1000, 56.813, 'BottlecapDave test value');
});

test('delegated pricing follows the tariff in force at each half hour', () => {
  const { agreements } = metersOf(account(), NOW)[0];
  const intervals = [
    { starts_at: '2026-09-30T22:30:00Z', kwh: 1 },
    { starts_at: '2026-10-16T11:00:00Z', kwh: 2 },
  ];
  const ranges = tariffRanges(intervals, agreements);
  assert.deepEqual(
    ranges.map((r) => r.tariffCode),
    [OLD_TARIFF, AGILE_TARIFF],
  );
  const costs = intervalCosts(
    intervals,
    agreements,
    new Map([
      [OLD_TARIFF, slotsOf(OLD_RATES)],
      [AGILE_TARIFF, slotsOf(AGILE_RATES)],
    ]),
  );
  assert.deepEqual(
    costs.map((c) => [c.cost, c.label]),
    [
      [0.2415, 'VAR-22-11-01'],
      [0.5332, 'AGILE-24-10-01'],
    ],
  );
  assert.throws(
    () => intervalCosts([{ starts_at: '2026-10-20T11:00:00Z', kwh: 1 }], agreements, new Map()),
    /No Octopus unit rate/,
  );
  const negative = slotsOf([
    { value_inc_vat: -2, valid_from: '2026-10-16T11:00:00Z', valid_to: '2026-10-16T11:30:00Z' },
  ]);
  assert.equal(
    intervalCosts(
      [{ starts_at: '2026-10-16T11:00:00Z', kwh: 1 }],
      agreements,
      new Map([[AGILE_TARIFF, negative]]),
    )[0].cost,
    0,
    'a credit counts as zero',
  );
});

test('the configuration is normalized', () => {
  const config = normalizeConfig({
    api_key: ' sk_live_x ',
    account_number: 'a-aaaa1111',
    agile_region: 'c',
    cheap_hours: '2.7',
    gas_unit: 'kwh',
    gas_calorific_value: 99,
  });
  assert.deepEqual(config, {
    apiKey: 'sk_live_x',
    accountNumber: 'A-AAAA1111',
    agileRegion: 'C',
    cheapHours: 2.5,
    gasUnit: 'kwh',
    gasCalorificValue: 50,
  });
  assert.equal(normalizeConfig({ agile_region: 'off' }).agileRegion, 'off');
  assert.equal(normalizeConfig({ agile_region: 'I' }).agileRegion, 'auto');
  assert.equal(normalizeConfig({}).cheapHours, 3);
});
