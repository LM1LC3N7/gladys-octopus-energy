// -----------------------------------------------------------------------------
// The integration itself: the meters of the account, their half-hourly
// consumption fed to the Gladys energy monitoring, their current tariff, the
// public Agile prices of a region with the cheap-hours triggers, the scene
// actions, the widget and the delegated contracts. index.js only wires the
// SDK handlers to it.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import {
  ACCOUNT_INTERVAL,
  BACKFILL_DAYS,
  CONSUMPTION_DAYS,
  CONSUMPTION_INTERVAL,
  CONTRACT_TEMPLATES,
  PRICES_INTERVAL,
  PRODUCTS_INTERVAL,
  REGIONS,
  TIME_ZONE,
  TOMORROW_FROM,
  TOMORROW_RETRY,
  WIDGETS,
} from './constants.js';
import {
  FEATURE,
  KIND,
  agileStates,
  buildAgileDevice,
  buildMeterDevice,
  ids,
  parseExternalId,
  tariffStates,
} from './devices.js';
import { intervalCosts, tariffRanges } from './energy.js';
import { OctopusError } from './http.js';
import { T } from './i18n.js';
import { OctopusClient } from './octopus/api.js';
import {
  agileTariffCode,
  consumptionIntervals,
  localClock,
  localDate,
  metersOf,
  parseTariff,
  pickAgileProduct,
  priceState,
  slotAt,
  slotsOf,
  startOfLocalDay,
} from './octopus/model.js';
import { PERIODS, cheapestWindowOutputs, priceOutputs } from './scenes.js';
import { priceEvents, tomorrowEvent } from './triggers.js';
import { pricesWidget } from './widget.js';

const DAY = 24 * 60 * 60_000;
const HALF_HOUR = 30 * 60_000;
const MAX_INTERVALS_PER_CALL = 2000;
const defaultTimers = { setTimeout, clearTimeout, setInterval, clearInterval };
const FATAL = new Set(['bad_key', 'no_key', 'no_account']);

export class OctopusApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'octopus-energy' }),
    now = Date.now,
    timers = defaultTimers,
    clientFactory = (apiKey) => new OctopusClient({ apiKey }),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.clientFactory = clientFactory;
    this.config = normalizeConfig();
    this.client = undefined;
    /** `${kind}:${point}` -> { meter, name, external, serial, slots, price, standingCharge, backfilled } */
    this.meters = new Map();
    /** { region, product, tariffCode, name, external, slots, price, announced } or null */
    this.agile = null;
    this.products = { list: [], at: 0 };
    this.timerIds = [];
    this.tickTimer = undefined;
    this.tomorrowTimer = undefined;
    this.lastStatus = undefined;
    /** The refused key / missing account number, shown until the account reads again. */
    this.accountProblem = null;
    this.generation = 0;
    this.lifecycle = Promise.resolve();
  }

  // --- Lifecycle -------------------------------------------------------------

  start(raw = {}) {
    return this.serialize(() => this.doStart(raw));
  }

  stop() {
    return this.serialize(() => this.doStop());
  }

  serialize(job) {
    const run = this.lifecycle.then(job, job);
    this.lifecycle = run.catch(() => {});
    return run;
  }

  async doStart(raw) {
    await this.doStop();
    const generation = ++this.generation;
    this.config = normalizeConfig(raw);
    this.client = this.clientFactory(this.config.apiKey);
    this.accountProblem = null;
    if (!this.config.apiKey && !(this.config.agileRegion in REGIONS)) {
      await this.setStatus(false, T.nothing);
      return;
    }
    // Each step on its own: a refused key must not hold back the public Agile prices.
    for (const step of [
      () => this.discover(),
      () => this.refreshPrices(),
      () => this.refreshConsumption(),
    ]) {
      try {
        await step();
      } catch (err) {
        await this.reportError(err);
      }
    }
    if (generation !== this.generation || (this.accountProblem && !this.agile)) {
      return;
    }
    const every = (fn, ms) =>
      this.timerIds.push(
        this.timers.setInterval(() => fn().catch((err) => this.reportError(err)), ms),
      );
    every(() => this.refreshPrices(), PRICES_INTERVAL);
    every(() => this.refreshConsumption(), CONSUMPTION_INTERVAL);
    every(() => this.discover(), ACCOUNT_INTERVAL);
    this.scheduleTick();
  }

  async doStop() {
    this.generation += 1;
    for (const id of this.timerIds) {
      this.timers.clearInterval(id);
    }
    this.timerIds = [];
    this.timers.clearTimeout(this.tickTimer);
    this.timers.clearTimeout(this.tomorrowTimer);
    this.tickTimer = undefined;
    this.tomorrowTimer = undefined;
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  async reportError(err) {
    // OctopusError messages never hold the key, the account number nor a URL.
    this.logger.warn(`Octopus: ${err.message}`);
    const code = err instanceof OctopusError ? err.code : undefined;
    if (code === 'bad_key' || code === 'no_key') {
      await this.setStatus(false, T.badKey);
    } else if (code === 'no_account') {
      await this.setStatus(Boolean(this.agile), T.noAccount);
    } else {
      await this.setStatus(this.meters.size > 0 || Boolean(this.agile), T.unreachable(err.message));
    }
  }

  async reportOk() {
    if (this.accountProblem) {
      await this.reportError(this.accountProblem);
      return;
    }
    if (this.meters.size === 0 && !this.agile) {
      await this.setStatus(false, T.noRegion);
      return;
    }
    await this.setStatus(true, T.ok(this.meters.size, this.agile?.region));
  }

  // --- Discovery -------------------------------------------------------------------

  async discover() {
    const now = this.now();
    let meters = [];
    let accountError;
    if (this.config.apiKey) {
      try {
        if (!this.config.accountNumber) {
          throw new OctopusError('no_account', 'No Octopus account number configured');
        }
        meters = metersOf(await this.client.account(this.config.accountNumber), now);
      } catch (err) {
        // The public Agile prices run whatever happens to the account.
        accountError = err;
        if (err instanceof OctopusError && FATAL.has(err.code)) {
          this.meters.clear();
          this.accountProblem = err;
        }
      }
    }
    if (!accountError) {
      this.accountProblem = null;
    }
    if (!accountError) {
      const known = this.meters;
      this.meters = new Map();
      for (const meter of meters) {
        const key = `${meter.kind}:${meter.point}`;
        const previous = known.get(key);
        this.meters.set(key, {
          meter,
          name: buildMeterDevice(this.gladys, meter).name,
          external: ids(this.gladys, meter.kind, meter.point),
          serial: previous?.serial,
          slots: previous?.slots ?? [],
          price: previous?.price,
          standingCharge: previous?.standingCharge,
          backfilled: previous?.backfilled ?? false,
        });
      }
    }
    await this.discoverAgile(now);
    await this.gladys.publishDiscoveredDevices([
      ...[...this.meters.values()].map((e) =>
        buildMeterDevice(this.gladys, { ...e.meter, serial: e.serial }),
      ),
      ...(this.agile ? [buildAgileDevice(this.gladys, this.agile)] : []),
    ]);
    if (accountError) {
      throw accountError;
    }
  }

  /** The Agile region: the configured one, else the region of the account's electricity tariff. */
  agileRegion() {
    if (this.config.agileRegion in REGIONS) {
      return this.config.agileRegion;
    }
    if (this.config.agileRegion !== 'auto') {
      return undefined;
    }
    const electricity = [...this.meters.values()].find((e) => e.meter.kind === KIND.ELECTRICITY);
    return parseTariff(electricity?.meter.tariffCode)?.region;
  }

  async discoverAgile(now) {
    const region = this.agileRegion();
    if (!region) {
      this.agile = null;
      return;
    }
    // An Agile customer follows the product of their own tariff.
    const own = [...this.meters.values()]
      .map((e) => parseTariff(e.meter.tariffCode))
      .find((t) => t?.fuel === 'electricity' && t.region === region && /^AGILE-\d/.test(t.product));
    let product = own?.product;
    if (!product) {
      if (this.products.list.length === 0 || now - this.products.at > PRODUCTS_INTERVAL) {
        try {
          this.products = { list: await this.client.products(), at: now };
        } catch (err) {
          this.logger.warn(`Octopus products unavailable: ${err.message}`);
        }
      }
      product = pickAgileProduct(this.products.list, now) ?? this.agile?.product;
    }
    if (!product) {
      this.agile = null;
      return;
    }
    const previous = this.agile?.region === region ? this.agile : null;
    this.agile = {
      region,
      product,
      tariffCode: agileTariffCode(product, region),
      name: buildAgileDevice(this.gladys, { region, product }).name,
      external: ids(this.gladys, KIND.AGILE, region),
      slots: previous?.product === product ? previous.slots : [],
      price: previous?.price,
      announced: previous?.announced ?? new Set(),
    };
  }

  // --- Prices and tariffs ---------------------------------------------------------

  tomorrowDue(t = this.now()) {
    const { hour, minute } = localClock(t, TIME_ZONE);
    return (
      hour > TOMORROW_FROM.hour || (hour === TOMORROW_FROM.hour && minute >= TOMORROW_FROM.minute)
    );
  }

  async refreshPrices() {
    const now = this.now();
    const dayStart = startOfLocalDay(now, TIME_ZONE);
    let failure;
    let tomorrowMissing = false;
    if (this.agile) {
      const agile = this.agile;
      try {
        agile.slots = slotsOf(
          await this.client.unitRates(
            KIND.ELECTRICITY,
            agile.tariffCode,
            dayStart,
            dayStart + 2 * DAY,
          ),
        );
        const tomorrow = priceState(agile.slots, now, {
          timeZone: TIME_ZONE,
          cheapHours: this.config.cheapHours,
        })?.tomorrow;
        const tomorrowDate = localDate(now + DAY, TIME_ZONE);
        if (tomorrow) {
          if (!agile.announced.has(tomorrowDate)) {
            agile.announced.add(tomorrowDate);
            if (agile.price) {
              await this.publishEvent(
                tomorrowEvent(agile.external.device, tomorrow, this.config.cheapHours),
              );
            }
          }
        } else if (this.tomorrowDue(now)) {
          tomorrowMissing = true;
        }
      } catch (err) {
        failure = err;
      }
    }
    for (const entry of this.meters.values()) {
      const { kind, tariffCode } = entry.meter;
      try {
        const [rates, charges] = await Promise.all([
          this.client.unitRates(kind, tariffCode, dayStart, dayStart + 2 * DAY),
          this.client.standingCharges(kind, tariffCode, dayStart, dayStart + DAY),
        ]);
        entry.slots = slotsOf(rates);
        entry.standingCharge = slotAt(slotsOf(charges), now);
      } catch (err) {
        // A two-rate (Economy 7) tariff has no standard unit rates: see TODO.md.
        this.logger.warn(`Tariff ${tariffCode} unavailable: ${err.message}`);
        failure ??= err.code === 'not_found' ? undefined : err;
      }
    }
    await this.tick();
    if (failure) {
      throw failure;
    }
    await this.reportOk();
    if (tomorrowMissing && !this.tomorrowTimer) {
      this.tomorrowTimer = this.timers.setTimeout(() => {
        this.tomorrowTimer = undefined;
        return this.refreshPrices().catch((err) => this.reportError(err));
      }, TOMORROW_RETRY);
    }
  }

  /** Move the sensors to the current half hour, fire the Agile transitions. */
  async tick() {
    const now = this.now();
    if (this.agile) {
      const agile = this.agile;
      const price = priceState(agile.slots, now, {
        timeZone: TIME_ZONE,
        cheapHours: this.config.cheapHours,
      });
      if (price) {
        const previous = agile.price;
        agile.price = price;
        await this.gladys
          .publishChangedStates(agileStates(agile.external, price), { heartbeat: 60 * 60_000 })
          .catch((err) => this.logger.warn(`Agile states failed: ${err.message}`));
        for (const event of priceEvents(agile.external.device, previous, price)) {
          await this.publishEvent(event);
        }
      }
    }
    for (const entry of this.meters.values()) {
      const slot = slotAt(entry.slots, now);
      entry.price = slot
        ? { slot, next: slot.endsAt ? slotAt(entry.slots, Date.parse(slot.endsAt)) : undefined }
        : undefined;
      await this.gladys
        .publishChangedStates(
          tariffStates(entry.external, { rate: slot, standingCharge: entry.standingCharge }),
          { heartbeat: 6 * 60 * 60_000 },
        )
        .catch((err) => this.logger.warn(`Tariff states of ${entry.name} failed: ${err.message}`));
    }
    this.gladys.requestWidgetRefresh(WIDGETS.PRICES);
  }

  /** Every half hour (+1 s), when Agile and time-of-use tariffs move. */
  scheduleTick() {
    this.timers.clearTimeout(this.tickTimer);
    const now = this.now();
    const delay = Math.ceil((now + 1) / HALF_HOUR) * HALF_HOUR - now + 1000;
    this.tickTimer = this.timers.setTimeout(async () => {
      try {
        await this.tick();
      } catch (err) {
        this.logger.warn(`Tick failed: ${err.message}`);
      }
      this.scheduleTick();
    }, delay);
  }

  async publishEvent(event) {
    await this.gladys
      .publishSceneEvent(event.key, event.data)
      .catch((err) => this.logger.warn(`Scene event ${event.key} failed: ${err.message}`));
  }

  // --- Consumption -------------------------------------------------------------------

  /** The serial to read: the known one, else the newest meter of the point that has data. */
  async readConsumption(entry, from, to) {
    const serials = entry.serial ? [entry.serial] : [...entry.meter.serials].reverse().slice(0, 3);
    for (const serial of serials) {
      const results = await this.client.consumption(
        entry.meter.kind,
        entry.meter.point,
        serial,
        from,
        to,
      );
      if (results.length > 0 || serial === serials.at(-1)) {
        if (results.length > 0) {
          entry.serial = serial;
        }
        return results;
      }
    }
    return [];
  }

  async refreshConsumption() {
    const now = this.now();
    for (const entry of this.meters.values()) {
      const days = entry.backfilled ? CONSUMPTION_DAYS : BACKFILL_DAYS;
      const from = Math.floor((now - days * DAY) / HALF_HOUR) * HALF_HOUR;
      let results;
      try {
        results = await this.readConsumption(entry, from, now);
      } catch (err) {
        if (err instanceof OctopusError && err.code === 'bad_key') {
          throw err;
        }
        this.logger.warn(`Consumption of ${entry.name} unavailable: ${err.message}`);
        continue;
      }
      const intervals = consumptionIntervals(results, {
        now,
        gasM3: entry.meter.kind === KIND.GAS && this.config.gasUnit === 'm3',
        calorificValue: this.config.gasCalorificValue,
      });
      if (intervals.length === 0) {
        continue;
      }
      try {
        for (let i = 0; i < intervals.length; i += MAX_INTERVALS_PER_CALL) {
          await this.gladys.publishEnergyConsumption(
            entry.external.feature(FEATURE.CONSUMPTION),
            intervals.slice(i, i + MAX_INTERVALS_PER_CALL),
          );
        }
        entry.backfilled = true;
      } catch (err) {
        // 404: the user has not created the device yet; the backfill waits for it.
        this.logger.debug?.(`Consumption of ${entry.name} not published: ${err.message}`);
      }
    }
  }

  // --- Scene actions -------------------------------------------------------------------

  /** The Agile region or meter entry of a device external id. */
  entryOf(externalId) {
    const parsed = parseExternalId(externalId);
    const entry =
      parsed?.kind === KIND.AGILE
        ? this.agile?.region === parsed.id
          ? this.agile
          : undefined
        : parsed && this.meters.get(`${parsed.kind}:${parsed.id}`);
    if (!entry) {
      throw new Error(`Unknown Octopus device ${externalId}`);
    }
    return entry;
  }

  async getPrice(fields = {}) {
    const entry = this.entryOf(fields.device);
    return priceOutputs(entry, {
      now: this.now(),
      timeZone: TIME_ZONE,
      cheapHours: this.config.cheapHours,
    });
  }

  async getCheapestWindow(fields = {}) {
    const entry = this.entryOf(fields.device);
    const period = PERIODS.includes(fields.period) ? fields.period : PERIODS[0];
    const asked = Number(fields.hours);
    const hours =
      Number.isFinite(asked) && asked > 0
        ? Math.min(12, Math.max(0.5, Math.round(asked * 2) / 2))
        : this.config.cheapHours;
    return cheapestWindowOutputs(entry.slots, {
      period,
      hours,
      now: this.now(),
      timeZone: TIME_ZONE,
    });
  }

  // --- Widget ----------------------------------------------------------------------------

  async getWidget(_key, { settings = {}, language } = {}) {
    let entry;
    try {
      entry = this.entryOf(settings.device);
    } catch {
      return {
        ttl_seconds: 300,
        components: [{ type: 'text', text: T.widget.noDevice, variant: 'body' }],
      };
    }
    return pricesWidget({
      entry,
      cheapHours: this.config.cheapHours,
      now: this.now(),
      timeZone: TIME_ZONE,
      language,
    });
  }

  // --- Energy contracts (delegated pricing) ---------------------------------------------

  /** The meter a contract refers to: its `meter_point` input, else the first of its fuel. */
  contractMeter(contract) {
    const kind = contract?.template_key === CONTRACT_TEMPLATES.GAS ? KIND.GAS : KIND.ELECTRICITY;
    const wanted = String(contract?.inputs?.meter_point ?? '').replace(/\s+/g, '');
    const entry = wanted
      ? this.meters.get(`${kind}:${wanted}`)
      : [...this.meters.values()].find((e) => e.meter.kind === kind);
    if (!entry) {
      throw new Error(`No Octopus ${kind} meter${wanted ? ` ${wanted}` : ''} in the account`);
    }
    return entry;
  }

  async energyPrice({ contract, intervals = [] }) {
    if (intervals.length === 0) {
      return [];
    }
    const entry = this.contractMeter(contract);
    const slotsByTariff = new Map();
    for (const range of tariffRanges(intervals, entry.meter.agreements)) {
      const rates = await this.client.unitRates(
        entry.meter.kind,
        range.tariffCode,
        range.from,
        range.to,
      );
      slotsByTariff.set(range.tariffCode, slotsOf(rates));
    }
    return intervalCosts(intervals, entry.meter.agreements, slotsByTariff);
  }

  async energyCurrent({ contract }) {
    const entry = this.contractMeter(contract);
    const slot = entry.price?.slot;
    if (!slot) {
      return { price: null };
    }
    return {
      price: slot.price,
      ...(slot.endsAt ? { valid_until: slot.endsAt } : {}),
      next_price: entry.price.next?.price ?? null,
      label: (parseTariff(entry.meter.tariffCode)?.product ?? 'Octopus').slice(0, 64),
    };
  }

  // --- Configuration screen button --------------------------------------------------------

  async testConnection() {
    const parts = [];
    try {
      if (this.config.apiKey) {
        if (!this.config.accountNumber) {
          return T.noAccount;
        }
        const meters = metersOf(await this.client.account(this.config.accountNumber), this.now());
        parts.push(
          T.test.meters(meters.map((m) => `${m.kind} …${m.point.slice(-4)} (${m.tariffCode})`)),
        );
      }
      if (this.agile) {
        const now = this.now();
        const slots = slotsOf(
          await this.client.unitRates(
            KIND.ELECTRICITY,
            this.agile.tariffCode,
            now,
            now + HALF_HOUR,
          ),
        );
        parts.push(T.test.agile(this.agile.region, slotAt(slots, now)?.price ?? null));
      }
    } catch (err) {
      const code = err instanceof OctopusError ? err.code : undefined;
      if (code === 'bad_key' || code === 'not_found') {
        return T.badKey;
      }
      return T.unreachable(err.message);
    }
    if (parts.length === 0) {
      return T.nothing;
    }
    return {
      en: parts
        .map((p) => p.en)
        .join('')
        .trim(),
      fr: parts
        .map((p) => p.fr)
        .join('')
        .trim(),
    };
  }
}
