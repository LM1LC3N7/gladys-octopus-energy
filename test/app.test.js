// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and a fake Octopus API.
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { OctopusApp } from '../src/app.js';
import { ACTIONS, SCENE_ACTIONS, SCENE_TRIGGERS, WIDGETS } from '../src/constants.js';
import { inPeriod, installFetch, json, page } from './helpers/fakeFetch.js';
import { createFakeTimers } from './helpers/fakeTimers.js';
import {
  ACCOUNT,
  AGILE_RATES,
  FLAT_RATES,
  GAS_SERIAL,
  MPAN,
  MPRN,
  NOW,
  OLD_RATES,
  OLD_SERIAL,
  PRODUCTS,
  SERIAL,
  STANDING_CHARGES,
  account,
  readings,
} from './fixtures/octopus.js';

const quiet = {
  info() {},
  warn: (...a) => process.env.DEBUG_TEST && console.error(...a),
  error() {},
  debug() {},
};

let fake;
afterEach(() => fake?.restore());

const AGILE = 'ext:octopus-energy:agile:C';
const ELEC = `ext:octopus-energy:electricity:${MPAN}`;
const GAS = `ext:octopus-energy:gas:${MPRN}`;
const CONFIG = { api_key: 'sk_live_test', account_number: ACCOUNT };
const pence = (iso) => AGILE_RATES.find((r) => r.valid_from === iso).value_inc_vat / 100;

function ratesFor(call, agile) {
  if (call.path.includes('AGILE')) return agile;
  if (call.path.includes('gas-tariffs')) return FLAT_RATES;
  return OLD_RATES;
}

function setup({ config = CONFIG, routes = {}, now = NOW, devices = [] } = {}) {
  const state = { agile: AGILE_RATES };
  fake = installFetch({
    account: () => json(account()),
    products: () => page(PRODUCTS),
    rates: (call) => page(inPeriod(ratesFor(call, state.agile), call.query)),
    standing: (call) => page(inPeriod(STANDING_CHARGES, call.query)),
    consumption: (call) => {
      const value = call.path.includes(GAS_SERIAL) ? 0.1 : 0.2;
      if (!call.path.includes(SERIAL) && !call.path.includes(GAS_SERIAL)) return page([]);
      const all = readings('2026-09-01T00:00:00Z', '2026-10-16T00:00:00Z', value);
      return page(
        all.filter(
          (r) =>
            Date.parse(r.interval_start) >= Date.parse(call.query.period_from) &&
            Date.parse(r.interval_end) <= Date.parse(call.query.period_to),
        ),
      );
    },
    ...routes,
  });
  const gladys = createFakeGladys({ selector: 'octopus-energy', config, devices });
  const timers = createFakeTimers();
  const clock = { now };
  const app = new OctopusApp({ gladys, logger: quiet, now: () => clock.now, timers });
  gladys.onScanRequest(() => app.discover());
  gladys.onDeviceCreated((device) => app.onDeviceCreated(device));
  gladys.onSceneAction(SCENE_ACTIONS.GET_PRICE, (f) => app.getPrice(f));
  gladys.onSceneAction(SCENE_ACTIONS.CHEAPEST_WINDOW, (f) => app.getCheapestWindow(f));
  for (const key of Object.values(WIDGETS)) {
    gladys.onWidgetGet(key, (request) => app.getWidget(key, request));
  }
  gladys.onEnergyPrice((request) => app.energyPrice(request));
  gladys.onEnergyCurrent((request) => app.energyCurrent(request));
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());
  return { app, gladys, timers, clock, state };
}

const consumptionDevice = (external) => ({
  external_id: external,
  name: 'meter',
  features: [
    {
      external_id: `${external}:consumption`,
      category: 'energy-sensor',
      type: 'thirty-minutes-consumption',
    },
  ],
});

test('nothing configured: the status says so and nothing is called', async () => {
  const { app, gladys } = setup({ config: {} });
  await app.start({});
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /Rien à lire/);
  assert.equal(fake.calls.length, 0);
});

test('start discovers the meters and the Agile region of the tariff, and publishes', async () => {
  const { app, gladys, timers } = setup();
  await app.start(CONFIG);
  const account = fake.calls.find((c) => c.name === 'account');
  assert.equal(
    account.headers.Authorization,
    `Basic ${Buffer.from('sk_live_test:').toString('base64')}`,
  );
  const publicCalls = fake.calls.filter((c) => c.name === 'rates' || c.name === 'standing');
  assert.ok(
    publicCalls.every((c) => !c.headers.Authorization),
    'the key only goes to the account',
  );
  assert.ok(!fake.calls.some((c) => c.name === 'products'), 'the Agile product of the tariff');
  const devices = gladys.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => d.external_id),
    [ELEC, GAS, AGILE],
  );
  assert.equal(devices[0].name, 'Octopus electricity (MPAN …0001)');
  assert.equal(devices[2].name, 'Octopus Agile London');
  assert.equal(gladys.fake.lastState(`${AGILE}:price`), pence('2026-10-16T10:30:00Z'));
  assert.equal(gladys.fake.lastState(`${AGILE}:next_price`), pence('2026-10-16T11:00:00Z'));
  assert.equal(gladys.fake.lastState(`${AGILE}:min_price`), 0.2466);
  assert.equal(gladys.fake.lastState(`${AGILE}:cheap_period`), 0);
  assert.equal(gladys.fake.lastState(`${ELEC}:unit_rate`), pence('2026-10-16T10:30:00Z'));
  assert.equal(gladys.fake.lastState(`${ELEC}:standing_charge`), 0.4725);
  assert.equal(gladys.fake.lastState(`${GAS}:unit_rate`), 0.0609, 'direct debit rate');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(gladys.fake.connectionStatus.message.en, /2 meters, Agile prices of region C/);
  assert.equal(timers.intervals().length, 3, 'prices, consumption, account');
  assert.deepEqual(
    timers
      .timeouts()
      .map((t) => t.ms)
      .sort((a, b) => a - b),
    [20 * 60_000 + 1000, (4 * 60 + 22) * 60_000],
    'the next tick at 11:00:01Z, the daily Agile read at 16:02 UK time',
  );
  assert.ok(!fake.calls.some((c) => c.name === 'consumption'), 'no device created: no read');
  assert.equal(gladys.fake.sceneEvents.length, 0, 'nothing on the first reading');
  await app.stop();
  assert.equal(timers.pending.size, 0);
});

test('the consumption backfills 14 days once the devices exist, gas m³ in kWh', async () => {
  const { app, gladys } = setup({ devices: [consumptionDevice(ELEC), consumptionDevice(GAS)] });
  await gladys.connect();
  await app.start(CONFIG);
  const reads = fake.calls.filter((c) => c.name === 'consumption');
  assert.ok(
    reads.some((c) => c.path.includes(SERIAL)),
    'the newest meter of the point',
  );
  const elec = gladys.fake.energyConsumption[`${ELEC}:consumption`];
  const gas = gladys.fake.energyConsumption[`${GAS}:consumption`];
  assert.ok(elec.length > 600, `14 days of half hours (${elec.length})`);
  assert.equal(elec[0].kwh, 0.2);
  assert.equal(gas[0].kwh, 1.1363, '0.1 m³ at 40 MJ/m³');
  // The next run only reads 3 days back.
  fake.calls.length = 0;
  await app.refreshConsumption();
  const next = fake.calls.find((c) => c.path.includes(SERIAL));
  assert.equal(next.query.period_from, '2026-10-13T10:30:00Z');
});

test('without the devices Octopus is not read; creating one starts its backfill', async () => {
  const { app, gladys } = setup();
  await gladys.connect();
  await app.start(CONFIG);
  await app.refreshConsumption();
  assert.ok(!fake.calls.some((c) => c.name === 'consumption'));
  const device = consumptionDevice(ELEC);
  gladys.fake.devices.push(device);
  await gladys.fake.deviceCreated(device);
  const read = fake.calls.find((c) => c.path.includes(SERIAL));
  assert.equal(read.query.period_from, '2026-10-02T10:30:00Z', '14 days');
  assert.ok(gladys.fake.energyConsumption[`${ELEC}:consumption`].length > 600);
  assert.ok(
    !fake.calls.some((c) => c.path.includes(GAS_SERIAL)),
    'the gas device is still not created',
  );
});

test('the 14-day read runs again once a day, after 04:00 UK time', async () => {
  const { app, gladys, clock } = setup({ devices: [consumptionDevice(ELEC)] });
  await gladys.connect();
  await app.start(CONFIG);
  const fromOf = async (iso) => {
    clock.now = Date.parse(iso);
    fake.calls.length = 0;
    await app.refreshConsumption();
    return fake.calls.find((c) => c.path.includes(SERIAL)).query.period_from;
  };
  assert.equal(await fromOf('2026-10-17T02:30:00Z'), '2026-10-14T02:30:00Z', '03:30 UK: 3 days');
  assert.equal(await fromOf('2026-10-17T03:30:00Z'), '2026-10-03T03:30:00Z', '04:30 UK: 14 days');
  assert.equal(await fromOf('2026-10-17T04:30:00Z'), '2026-10-14T04:30:00Z', 'then 3 days');
});

test('the serial: another meter of the point is tried when the known one has nothing', async () => {
  const state = { serialWithData: SERIAL };
  const routes = {
    consumption: (call) => {
      if (call.path.includes(OLD_SERIAL)) {
        return state.serialWithData === OLD_SERIAL
          ? page(readings('2026-10-14T00:00:00Z', '2026-10-15T00:00:00Z', 0.3))
          : page([]);
      }
      if (call.path.includes(SERIAL)) {
        return state.serialWithData === SERIAL
          ? page(readings('2026-10-14T00:00:00Z', '2026-10-15T00:00:00Z', 0.2))
          : json({ detail: 'Not found.' }, 404);
      }
      return page([]);
    },
  };
  const { app, gladys } = setup({ routes, devices: [consumptionDevice(ELEC)] });
  await gladys.connect();
  await app.start(CONFIG);
  const entry = app.meters.get(`electricity:${MPAN}`);
  assert.equal(entry.serial, SERIAL);
  state.serialWithData = OLD_SERIAL;
  fake.calls.length = 0;
  await app.refreshConsumption();
  assert.equal(entry.serial, OLD_SERIAL, 'the 404 serial is skipped, the other one is kept');
  const last = gladys.fake.energyConsumption[`${ELEC}:consumption`].at(-1);
  assert.equal(last.kwh, 0.3);
});

test('the tick fires the cheap period and negative price transitions', async () => {
  const { app, gladys, timers, clock, state } = setup();
  state.agile = AGILE_RATES.map((r) =>
    r.valid_from === '2026-10-16T11:00:00Z' ? { ...r, value_inc_vat: -1.5 } : r,
  );
  await app.start(CONFIG);
  clock.now = Date.parse('2026-10-16T11:00:01Z');
  await timers.runTimeouts();
  assert.equal(gladys.fake.lastState(`${AGILE}:price`), -0.015);
  assert.equal(gladys.fake.lastState(`${AGILE}:negative_price`), 1);
  const keys = gladys.fake.sceneEvents.map((e) => e.key);
  assert.deepEqual(keys, [SCENE_TRIGGERS.CHEAP_STARTED, SCENE_TRIGGERS.NEGATIVE_STARTED]);
  assert.equal(gladys.fake.sceneEvents[0].data.device, AGILE);
  assert.equal(gladys.fake.sceneEvents[0].data.currency, 'GBP');
  clock.now = Date.parse('2026-10-16T14:00:01Z');
  await timers.runTimeouts();
  assert.equal(gladys.fake.sceneEvents.at(-1).key, SCENE_TRIGGERS.CHEAP_ENDED);
});

test("tomorrow's prices: retried every 15 minutes after 16:00, announced once", async () => {
  const { app, gladys, timers, state } = setup({ now: Date.parse('2026-10-16T15:10:00Z') });
  state.agile = AGILE_RATES.filter((r) => r.valid_from < '2026-10-16T23:00:00Z');
  await app.start(CONFIG);
  const retry = timers.timeouts().find((t) => t.ms === 15 * 60_000);
  assert.ok(retry, 'a retry in 15 minutes');
  state.agile = AGILE_RATES;
  await retry.fn();
  const events = gladys.fake.sceneEvents.filter((e) => e.key === SCENE_TRIGGERS.TOMORROW);
  assert.equal(events.length, 1);
  assert.equal(events[0].data.currency, 'GBP');
  assert.ok(events[0].data.cheapest_start < events[0].data.cheapest_end);
  await app.refreshPrices();
  assert.equal(gladys.fake.sceneEvents.filter((e) => e.key === SCENE_TRIGGERS.TOMORROW).length, 1);
});

test('public Agile prices only: no key sent, the product found in the list', async () => {
  const { app, gladys } = setup({ config: { agile_region: 'C' } });
  await app.start({ agile_region: 'C' });
  assert.ok(fake.calls.some((c) => c.name === 'products'));
  assert.ok(fake.calls.every((c) => !c.headers.Authorization));
  assert.ok(!fake.calls.some((c) => c.name === 'account'));
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.external_id),
    [AGILE],
  );
  assert.match(gladys.fake.connectionStatus.message.en, /0 meter, Agile prices of region C/);
});

test('a refused key says so, and the public Agile prices still run', async () => {
  const routes = { account: () => json({ detail: 'Authentication failed.' }, 401) };
  const config = { ...CONFIG, agile_region: 'C' };
  const { app, gladys, timers } = setup({ routes, config });
  await app.start(config);
  assert.match(gladys.fake.connectionStatus.message.en, /refused the API key/);
  assert.equal(gladys.fake.lastState(`${AGILE}:price`), pence('2026-10-16T10:30:00Z'));
  assert.equal(timers.intervals().length, 3);
  const ack = await gladys.fake.action(ACTIONS.TEST);
  assert.match(ack.data.message.fr, /a refusé la clé/);
  assert.ok(!JSON.stringify(gladys.fake.connectionStatuses).includes('sk_live_test'));
});

test('an unknown account number without Agile: said, and retried after 5, 15, 60 min', async () => {
  const state = { found: false };
  const routes = {
    account: () => (state.found ? json(account()) : json({ detail: 'Not found.' }, 404)),
  };
  const config = { ...CONFIG, agile_region: 'off' };
  const { app, gladys, timers } = setup({ routes, config });
  await app.start(config);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /does not know this account number/);
  assert.equal(timers.intervals().length, 3, 'never left without a timer');
  const retry = () =>
    timers.timeouts().find((t) => [5, 15, 60].map((m) => m * 60_000).includes(t.ms));
  assert.equal(retry().ms, 5 * 60_000);
  const fire = async () => {
    const t = retry();
    timers.pending.delete(t.id);
    await t.fn();
  };
  await fire();
  assert.equal(retry().ms, 15 * 60_000);
  await fire();
  assert.equal(retry().ms, 60 * 60_000);
  state.found = true;
  await fire();
  assert.equal(app.meters.size, 2);
  assert.match(gladys.fake.connectionStatus.message.en, /Connected: 2 meters/);
  assert.equal(retry(), undefined, 'no more retry once the account is read');
});

test('a transient account failure keeps a clear status and Agile appears on the retry', async () => {
  const state = { up: false };
  const routes = {
    account: () =>
      state.up
        ? json(account())
        : new Response('<html>The request could not be satisfied. CloudFront</html>', {
            status: 403,
          }),
  };
  const { app, gladys, timers } = setup({ routes });
  await app.start(CONFIG);
  assert.notEqual(gladys.fake.connectionStatus.message.en.includes('refused'), true);
  assert.match(gladys.fake.connectionStatus.message.en, /could not be read.*new try in 5 min/);
  assert.equal(app.agile, null, 'the region comes from the tariff, not known yet');
  state.up = true;
  const retry = timers.timeouts().find((t) => t.ms === 5 * 60_000);
  await retry.fn();
  assert.equal(app.agile.region, 'C');
  assert.equal(gladys.fake.lastState(`${AGILE}:price`), pence('2026-10-16T10:30:00Z'));
});

test('a 403 on a public endpoint is not a refused key', async () => {
  const routes = { rates: () => json({ detail: 'Forbidden' }, 403) };
  const { app, gladys } = setup({ routes, config: { agile_region: 'C' } });
  await app.start({ agile_region: 'C' });
  assert.doesNotMatch(gladys.fake.connectionStatus.message.en, /refused the API key/);
  assert.match(gladys.fake.connectionStatus.message.en, /unreachable/);
});

test('a 429 interrupts the cycle and pauses every call for Retry-After', async () => {
  const routes = {
    rates: () => new Response('{}', { status: 429, headers: { 'retry-after': '1200' } }),
  };
  const { app, gladys, clock } = setup({ routes, devices: [consumptionDevice(ELEC)] });
  await gladys.connect();
  await app.start(CONFIG);
  assert.match(gladys.fake.connectionStatus.message.en, /slow down: every call paused for 20 min/);
  assert.equal(fake.calls.filter((c) => c.name === 'rates').length, 1, 'the cycle stopped');
  assert.ok(!fake.calls.some((c) => c.name === 'consumption'), 'consumption not read');
  fake.calls.length = 0;
  await app.run(app.generation, () => app.refreshPrices());
  assert.equal(fake.calls.length, 0, 'still paused');
  clock.now = NOW + 21 * 60_000;
  await app.run(app.generation, () => app.refreshPrices());
  assert.ok(fake.calls.length > 0, 'calls again after the pause');
});

test('no timer is re-armed after a stop', async () => {
  const { app, timers } = setup();
  await app.start(CONFIG);
  const pending = [...timers.pending.values()].filter((t) => t.kind === 'timeout');
  await app.stop();
  for (const t of pending) {
    await t.fn();
  }
  assert.equal(timers.pending.size, 0);
});

test('scene actions and the widget', async () => {
  const { app, gladys } = setup();
  await app.start(CONFIG);
  const price = await gladys.fake.sceneAction(SCENE_ACTIONS.GET_PRICE, { device: AGILE });
  assert.equal(price.data.outputs.price, pence('2026-10-16T10:30:00Z'));
  assert.equal(price.data.outputs.tomorrow_published, true);
  assert.equal(price.data.outputs.ends_time, '12:00', 'UK time');
  const gas = await gladys.fake.sceneAction(SCENE_ACTIONS.GET_PRICE, { device: GAS });
  assert.equal(gas.data.outputs.price, 0.0609);
  assert.equal(gas.data.outputs.standing_charge, 0.4725);
  const window = await gladys.fake.sceneAction(SCENE_ACTIONS.CHEAPEST_WINDOW, {
    device: AGILE,
    hours: 3,
    period: 'today',
  });
  assert.equal(window.data.outputs.found, true);
  assert.equal(window.data.outputs.start_time, '12:00');
  assert.equal(window.data.outputs.end_time, '15:00');
  assert.equal(window.data.outputs.minutes_until_start, 20);
  const flat = await gladys.fake.sceneAction(SCENE_ACTIONS.CHEAPEST_WINDOW, { device: GAS });
  assert.equal(flat.data.outputs.found, false, 'a flat tariff has no window');
  const widget = (
    await gladys.fake.widgetGet(WIDGETS.PRICES, { settings: { device: AGILE }, language: 'fr' })
  ).data.content;
  assert.equal(widget.components[0].text, 'Octopus Agile London');
  assert.equal(widget.components.find((c) => c.type === 'chart').series[0].points.length, 94);
  const none = (await gladys.fake.widgetGet(WIDGETS.PRICES, { settings: {} })).data.content;
  assert.match(none.components[0].text.fr, /Choisissez un appareil/);
  const bad = await gladys.fake.sceneAction(SCENE_ACTIONS.GET_PRICE, {
    device: 'ext:octopus-energy:agile:Z',
  });
  assert.equal(bad.success, false);
});

test('the delegated contracts price each half hour at the tariff in force', async () => {
  const { app, gladys } = setup();
  await app.start(CONFIG);
  const contract = {
    id: 'c1',
    template_key: 'octopus-gb-electricity',
    inputs: { meter_point: '', standing_charge: 0.47 },
    currency: 'GBP',
    timezone: 'Europe/London',
    billing_period_start_day: 1,
  };
  const ack = await gladys.fake.energyPrice({
    contract,
    billing_period: { starts_at: '2026-09-30T23:00:00Z', ends_at: '2026-10-31T00:00:00Z' },
    cumulative_before: { day: 0, month: 0, billing_period: 0 },
    intervals: [
      { starts_at: '2026-09-30T22:30:00Z', kwh: 1, max_power_kw: 2 },
      { starts_at: '2026-10-16T10:00:00Z', kwh: 0.5, max_power_kw: 1 },
    ],
  });
  assert.equal(ack.success, true, JSON.stringify(ack));
  assert.deepEqual(
    ack.data.costs.map((c) => c.cost),
    [0.2415, 0.5 * pence('2026-10-16T10:00:00Z')],
  );
  const current = await gladys.fake.energyCurrent({
    contract,
    billing_period: {},
    cumulative: {},
    max_power_kw: 0,
  });
  assert.equal(current.data.price, pence('2026-10-16T10:30:00Z'));
  assert.equal(current.data.valid_until, '2026-10-16T11:00:00.000Z');
  const gas = await gladys.fake.energyCurrent({
    contract: { ...contract, template_key: 'octopus-gb-gas', inputs: { meter_point: MPRN } },
    billing_period: {},
    cumulative: {},
    max_power_kw: 0,
  });
  assert.equal(gas.data.price, 0.0609);
  assert.equal(gas.data.valid_until, undefined, 'a rate still in force');
});

test('the test button lists the meters and the Agile price', async () => {
  const { app, gladys } = setup();
  await app.start(CONFIG);
  const ack = await gladys.fake.action(ACTIONS.TEST);
  assert.match(ack.data.message.en, /electricity …0001 \(E-1R-AGILE-24-10-01-C\)/);
  assert.match(ack.data.message.en, /Agile C: 0\.\d{4} GBP\/kWh now/);
});
