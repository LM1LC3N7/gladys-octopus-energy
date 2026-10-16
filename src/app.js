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
  BACKFILL_HOUR,
  CONSUMPTION_DAYS,
  CONSUMPTION_INTERVAL,
  CONTRACT_TEMPLATES,
  DISCOVER_BACKOFF,
  PRICES_INTERVAL,
  PRODUCTS_INTERVAL,
  RATE_LIMIT_PAUSE,
  REGIONS,
  TIME_ZONE,
  TOMORROW_DAILY,
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
  localTimeOn,
  metersOf,
  nextLocalDay,
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
const MAX_SERIALS = 5;
const defaultTimers = { setTimeout, clearTimeout, setInterval, clearInterval };
/** Account errors that empty the meter list (the account cannot be read as configured). */
const ACCOUNT_REFUSED = new Set(['bad_key', 'no_account', 'account_not_found']);
const minutes = (ms) => Math.max(1, Math.ceil(ms / 60_000));
const sameSerials = (a = [], b = []) => [...a].sort().join('|') === [...b].sort().join('|');

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
    /** `${kind}:${point}` -> { meter, name, external, serial, slots, price, standingCharge, backfilledOn } */
    this.meters = new Map();
    /** { region, product, tariffCode, name, external, slots, price, announced } or null */
    this.agile = null;
    this.products = { list: [], at: 0 };
    /** Devices created since the last connection (gladys.devices is refreshed on reconnection). */
    this.createdIds = new Set();
    this.timerIds = [];
    this.tickTimer = undefined;
    this.tomorrowTimer = undefined;
    this.dailyTimer = undefined;
    this.discoverTimer = undefined;
    this.discoverAttempt = 0;
    this.retryDelay = DISCOVER_BACKOFF[0];
    /** Every call waits until then after a 429. */
    this.pausedUntil = 0;
    this.lastStatus = undefined;
    /** The last account error, shown until the account reads again. */
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
    this.pausedUntil = 0;
    this.discoverAttempt = 0;
    if (!this.config.apiKey && !(this.config.agileRegion in REGIONS)) {
      await this.setStatus(false, T.nothing);
      return;
    }
    await this.allSteps();
    if (generation !== this.generation) {
      return;
    }
    // Always armed, whatever the first run gave: a refused key or an outage
    // never leaves the integration without a next try.
    const every = (fn, ms) =>
      this.timerIds.push(this.timers.setInterval(() => this.run(generation, fn), ms));
    every(() => this.refreshPrices(), PRICES_INTERVAL);
    every(() => this.refreshConsumption(), CONSUMPTION_INTERVAL);
    every(() => this.discover(), ACCOUNT_INTERVAL);
    this.scheduleTick();
    this.scheduleDaily();
  }

  /** Discovery, prices, consumption, each on its own: one failure holds back nothing. */
  async allSteps() {
    for (const step of [
      () => this.discover(),
      () => this.refreshPrices(),
      () => this.refreshConsumption(),
    ]) {
      if (this.paused()) {
        return;
      }
      try {
        await step();
      } catch (err) {
        await this.reportError(err);
      }
    }
  }

  async doStop() {
    this.generation += 1;
    for (const id of this.timerIds) {
      this.timers.clearInterval(id);
    }
    this.timerIds = [];
    for (const name of ['tickTimer', 'tomorrowTimer', 'dailyTimer', 'discoverTimer']) {
      this.timers.clearTimeout(this[name]);
      this[name] = undefined;
    }
  }

  paused() {
    return this.now() < this.pausedUntil;
  }

  /** Throw at once during a 429 pause (calls made on Gladys' demand). */
  assertNotPaused() {
    if (this.paused()) {
      const error = new OctopusError('rate_limited', 'Octopus asked to slow down (429)', 429);
      error.retryAfter = this.pausedUntil - this.now();
      throw error;
    }
  }

  /** Run a timed job of a generation: nothing after a stop, nothing during a 429 pause. */
  async run(generation, job) {
    if (generation !== this.generation || this.paused()) {
      return;
    }
    try {
      await job();
    } catch (err) {
      await this.reportError(err);
    }
  }

  /** A timeout of the current generation (never re-armed after doStop()). */
  later(name, delay, job) {
    const generation = this.generation;
    this.timers.clearTimeout(this[name]);
    this[name] = this.timers.setTimeout(() => {
      this[name] = undefined;
      if (generation !== this.generation) {
        return undefined;
      }
      if (this.paused()) {
        // A 429 pause: the job waits for its end instead of being lost.
        this.later(name, this.pausedUntil - this.now() + 1000, job);
        return undefined;
      }
      return this.run(generation, job);
    }, delay);
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
    const running = this.meters.size > 0 || Boolean(this.agile);
    if (code === 'rate_limited') {
      const pause = err.retryAfter ?? RATE_LIMIT_PAUSE;
      this.pausedUntil = this.now() + pause;
      await this.setStatus(running, T.rateLimited(minutes(pause)));
    } else if (err.account && code === 'bad_key') {
      await this.setStatus(false, T.badKey);
    } else if (code === 'no_account') {
      await this.setStatus(Boolean(this.agile), T.noAccount);
    } else if (code === 'account_not_found') {
      await this.setStatus(Boolean(this.agile), T.accountNotFound);
    } else if (err.account) {
      await this.setStatus(running, T.accountRetry(minutes(this.retryDelay), err.message));
    } else {
      await this.setStatus(running, T.unreachable(err.message));
    }
  }

  async reportOk() {
    if (this.accountProblem) {
      await this.reportError(this.accountProblem);
      return;
    }
    if (this.config.apiKey && this.meters.size === 0) {
      await this.setStatus(Boolean(this.agile), T.noMeter(minutes(this.retryDelay)));
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
        err.account = true;
        accountError = err;
        if (err instanceof OctopusError && ACCOUNT_REFUSED.has(err.code)) {
          this.meters.clear();
        }
      }
    }
    this.accountProblem = accountError ?? null;
    if (!accountError) {
      const known = this.meters;
      this.meters = new Map();
      for (const meter of meters) {
        const key = `${meter.kind}:${meter.point}`;
        const previous = known.get(key);
        // A meter replaced (or added) on the point: find the serial with data again.
        const keepSerial = previous && sameSerials(previous.meter.serials, meter.serials);
        this.meters.set(key, {
          meter,
          name: buildMeterDevice(this.gladys, meter).name,
          external: ids(this.gladys, meter.kind, meter.point),
          serial: keepSerial ? previous.serial : undefined,
          slots: previous?.slots ?? [],
          price: previous?.price,
          standingCharge: previous?.standingCharge,
          backfilledOn: previous?.backfilledOn,
        });
      }
    }
    // Planned first: a 429 on the products list must not cancel the account retry.
    this.planDiscoverRetry(accountError);
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

  /**
   * After a failed account read, or a key without any meter known yet: read
   * the account again after 5, 15, then every 60 minutes, until it works.
   */
  planDiscoverRetry(error) {
    this.timers.clearTimeout(this.discoverTimer);
    this.discoverTimer = undefined;
    if (!this.config.apiKey || (!error && this.meters.size > 0)) {
      this.discoverAttempt = 0;
      return;
    }
    this.retryDelay = DISCOVER_BACKOFF[Math.min(this.discoverAttempt, DISCOVER_BACKOFF.length - 1)];
    this.discoverAttempt += 1;
    this.later('discoverTimer', this.retryDelay, () => this.allSteps());
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
          if (err.code === 'rate_limited') {
            throw err;
          }
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

  /** The window of the prices: from today's local midnight to the real end of tomorrow. */
  priceWindow(now) {
    const from = startOfLocalDay(now, TIME_ZONE);
    return { from, to: nextLocalDay(nextLocalDay(now, TIME_ZONE), TIME_ZONE) };
  }

  /** The Agile prices of today and tomorrow; announces tomorrow once, retries until it is out. */
  async refreshAgile() {
    const now = this.now();
    if (!this.agile && this.agileRegion()) {
      // The products list (or the account giving the region) failed before.
      await this.discoverAgile(now);
    }
    const agile = this.agile;
    if (!agile) {
      return;
    }
    const { from, to } = this.priceWindow(now);
    agile.slots = slotsOf(
      await this.client.unitRates(KIND.ELECTRICITY, agile.tariffCode, from, to),
    );
    const tomorrow = priceState(agile.slots, now, {
      timeZone: TIME_ZONE,
      cheapHours: this.config.cheapHours,
    })?.tomorrow;
    const tomorrowDate = localDate(nextLocalDay(now, TIME_ZONE), TIME_ZONE);
    if (tomorrow) {
      this.timers.clearTimeout(this.tomorrowTimer);
      this.tomorrowTimer = undefined;
      if (!agile.announced.has(tomorrowDate)) {
        agile.announced.add(tomorrowDate);
        if (agile.price) {
          await this.publishEvent(
            tomorrowEvent(agile.external.device, tomorrow, this.config.cheapHours),
          );
        }
      }
    } else if (this.tomorrowDue(now) && !this.tomorrowTimer) {
      // Only the Agile prices are read again, not the meters' tariffs.
      this.later('tomorrowTimer', TOMORROW_RETRY, async () => {
        await this.refreshAgile();
        this.gladys.requestWidgetRefresh(WIDGETS.PRICES);
      });
    }
  }

  async refreshPrices() {
    const now = this.now();
    let failure;
    try {
      await this.refreshAgile();
    } catch (err) {
      if (err.code === 'rate_limited') {
        throw err;
      }
      failure = err;
    }
    const { from, to } = this.priceWindow(now);
    for (const entry of this.meters.values()) {
      const { kind, tariffCode } = entry.meter;
      try {
        const [rates, charges] = await Promise.all([
          this.client.unitRates(kind, tariffCode, from, to),
          this.client.standingCharges(kind, tariffCode, from, nextLocalDay(now, TIME_ZONE)),
        ]);
        entry.slots = slotsOf(rates);
        entry.standingCharge = slotAt(slotsOf(charges), now);
      } catch (err) {
        if (err.code === 'rate_limited') {
          throw err;
        }
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
  }

  /** Every day at 16:02 UK time, when tomorrow's Agile prices come out. */
  scheduleDaily() {
    const now = this.now();
    let at = localTimeOn(now, TOMORROW_DAILY, TIME_ZONE);
    if (at <= now) {
      at = localTimeOn(nextLocalDay(now, TIME_ZONE), TOMORROW_DAILY, TIME_ZONE);
    }
    const generation = this.generation;
    this.later('dailyTimer', at - now, async () => {
      try {
        await this.refreshAgile();
      } finally {
        if (generation === this.generation) {
          this.scheduleDaily();
        }
      }
    });
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
    const generation = this.generation;
    const now = this.now();
    const delay = Math.ceil((now + 1) / HALF_HOUR) * HALF_HOUR - now + 1000;
    this.timers.clearTimeout(this.tickTimer);
    this.tickTimer = this.timers.setTimeout(async () => {
      this.tickTimer = undefined;
      if (generation !== this.generation) {
        return;
      }
      try {
        await this.tick();
      } catch (err) {
        this.logger.warn(`Tick failed: ${err.message}`);
      }
      if (generation === this.generation) {
        this.scheduleTick();
      }
    }, delay);
  }

  async publishEvent(event) {
    await this.gladys
      .publishSceneEvent(event.key, event.data)
      .catch((err) => this.logger.warn(`Scene event ${event.key} failed: ${err.message}`));
  }

  // --- Consumption -------------------------------------------------------------------

  /** Whether the user created the device of a meter (no need to read Octopus otherwise). */
  isCreated(entry) {
    const id = entry.external.device;
    return this.createdIds.has(id) || (this.gladys.devices ?? []).some((d) => d.external_id === id);
  }

  /**
   * The readings of a meter point: the known serial first; when it has none
   * (or is unknown), every meter of the point is asked (their order in the
   * account means nothing) and the one with the latest reading is kept.
   */
  async readConsumption(entry, from, to) {
    const serials = [...new Set(entry.meter.serials)].slice(0, MAX_SERIALS);
    const ordered =
      entry.serial && serials.includes(entry.serial)
        ? [entry.serial, ...serials.filter((s) => s !== entry.serial)]
        : serials;
    let best;
    for (const serial of ordered) {
      let results;
      try {
        results = await this.client.consumption(
          entry.meter.kind,
          entry.meter.point,
          serial,
          from,
          to,
        );
      } catch (err) {
        if (err instanceof OctopusError && err.code === 'not_found') {
          continue;
        }
        throw err;
      }
      if (results.length === 0) {
        continue;
      }
      if (serial === entry.serial) {
        return results;
      }
      const last = Math.max(...results.map((r) => Date.parse(r.interval_end) || 0));
      if (!best || last > best.last) {
        best = { serial, results, last };
      }
    }
    if (best) {
      entry.serial = best.serial;
      return best.results;
    }
    return [];
  }

  /** The day a full 14-day read belongs to: it changes at 04:00 UK time. */
  backfillDay(now) {
    return localClock(now, TIME_ZONE).hour >= BACKFILL_HOUR
      ? localDate(now, TIME_ZONE)
      : localDate(startOfLocalDay(now, TIME_ZONE) - 1, TIME_ZONE);
  }

  async refreshConsumption() {
    for (const entry of this.meters.values()) {
      await this.consume(entry);
    }
  }

  async consume(entry) {
    if (!this.isCreated(entry)) {
      return;
    }
    const now = this.now();
    const day = this.backfillDay(now);
    const days = entry.backfilledOn === day ? CONSUMPTION_DAYS : BACKFILL_DAYS;
    const from = Math.floor((now - days * DAY) / HALF_HOUR) * HALF_HOUR;
    let results;
    try {
      results = await this.readConsumption(entry, from, now);
    } catch (err) {
      if (err.code === 'rate_limited') {
        throw err;
      }
      this.logger.warn(`Consumption of ${entry.name} unavailable: ${err.message}`);
      return;
    }
    const intervals = consumptionIntervals(results, {
      now,
      gasM3: entry.meter.kind === KIND.GAS && this.config.gasUnit === 'm3',
      calorificValue: this.config.gasCalorificValue,
    });
    try {
      for (let i = 0; i < intervals.length; i += MAX_INTERVALS_PER_CALL) {
        await this.gladys.publishEnergyConsumption(
          entry.external.feature(FEATURE.CONSUMPTION),
          intervals.slice(i, i + MAX_INTERVALS_PER_CALL),
        );
      }
      entry.backfilledOn = days === BACKFILL_DAYS ? day : entry.backfilledOn;
    } catch (err) {
      const log = err.status === 404 ? this.logger.debug : this.logger.warn;
      // 404: the device was deleted in the meantime; anything else is a real refusal.
      log?.call(this.logger, `Consumption of ${entry.name} not published: ${err.message}`);
    }
  }

  /** A device was created: a meter starts its 14-day backfill right away. */
  async onDeviceCreated(device) {
    const id = device?.external_id;
    if (!id) {
      return;
    }
    this.createdIds.add(id);
    const entry = [...this.meters.values()].find((e) => e.external.device === id);
    if (entry) {
      entry.backfilledOn = undefined;
      await this.run(this.generation, () => this.consume(entry));
    }
  }

  onDeviceDeleted(device) {
    this.createdIds.delete(device?.external_id);
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
    // During a 429 pause, fail at once: the core retries at its next run.
    this.assertNotPaused();
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
    if (this.paused()) {
      return T.rateLimited(minutes(this.pausedUntil - this.now()));
    }
    const parts = [];
    if (this.config.apiKey) {
      if (!this.config.accountNumber) {
        return T.noAccount;
      }
      try {
        const meters = metersOf(await this.client.account(this.config.accountNumber), this.now());
        parts.push(
          T.test.meters(meters.map((m) => `${m.kind} …${m.point.slice(-4)} (${m.tariffCode})`)),
        );
      } catch (err) {
        if (err.code === 'bad_key') {
          return T.badKey;
        }
        if (err.code === 'account_not_found') {
          return T.accountNotFound;
        }
        return T.unreachable(err.message);
      }
    }
    if (this.agile) {
      try {
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
      } catch (err) {
        return err.code === 'not_found' ? T.publicNotFound : T.unreachable(err.message);
      }
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
