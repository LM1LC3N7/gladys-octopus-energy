// -----------------------------------------------------------------------------
// Constants of the Octopus Energy (Great Britain) integration.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

/** The official REST API of Octopus Energy GB (https://developer.octopus.energy). */
export const OCTOPUS_API_URL = 'https://api.octopus.energy/v1';
// The version follows the release (package.json is in the image).
const VERSION = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;
export const USER_AGENT = `gladys-octopus-energy/${VERSION} (+https://github.com/LM1LC3N7/gladys-octopus-energy)`;
export const HTTP_TIMEOUT = 20_000;
/** At most this many pages are followed for one list (a 31-day period fits in one or two). */
export const MAX_PAGES = 10;
export const PAGE_SIZE = 1500;

/** Prices and tariffs are read at start and every hour. */
export const PRICES_INTERVAL = 60 * 60_000;
/**
 * Tomorrow's Agile prices are out around 16:00 UK time: read at 16:02 every
 * day, then every 15 minutes (the Agile prices only) until published.
 */
export const TOMORROW_FROM = { hour: 16, minute: 0 };
export const TOMORROW_DAILY = { hour: 16, minute: 2 };
export const TOMORROW_RETRY = 15 * 60_000;
/**
 * Consumption: every hour, the last 3 days; 14 days back when a meter is
 * first published, and again once a day (the first run after 04:00 UK time)
 * to pick up the readings Octopus filled in late.
 */
export const CONSUMPTION_INTERVAL = 60 * 60_000;
export const CONSUMPTION_DAYS = 3;
export const BACKFILL_DAYS = 14;
export const BACKFILL_HOUR = 4;
/** After a failed account read (or none yet): retried after 5, 15, then every 60 minutes. */
export const DISCOVER_BACKOFF = [5 * 60_000, 15 * 60_000, 60 * 60_000];
/** A 429 without Retry-After pauses every call for 15 minutes. */
export const RATE_LIMIT_PAUSE = 15 * 60_000;
/** The account (meters, agreements) is read again every 6 hours: tariffs change rarely. */
export const ACCOUNT_INTERVAL = 6 * 60 * 60_000;
/** The Agile product list (to follow a new Agile version) is read once a day. */
export const PRODUCTS_INTERVAL = 24 * 60 * 60_000;

export const TIME_ZONE = 'Europe/London';
export const CURRENCY = 'GBP';

/** m³ -> kWh for SMETS2 gas meters (Ofgem formula: volume correction 1.02264, ÷ 3.6). */
export const GAS_VOLUME_CORRECTION = 1.02264;

/** The 14 GSP groups (electricity regions) of Great Britain; "I" and "O" do not exist. */
export const REGIONS = {
  A: 'Eastern England',
  B: 'East Midlands',
  C: 'London',
  D: 'Merseyside and Northern Wales',
  E: 'West Midlands',
  F: 'North Eastern England',
  G: 'North Western England',
  H: 'Southern England',
  J: 'South Eastern England',
  K: 'Southern Wales',
  L: 'South Western England',
  M: 'Yorkshire',
  N: 'Southern Scotland',
  P: 'Northern Scotland',
};
/** `agile_region` values besides the letters. */
export const REGION_AUTO = 'auto';
export const REGION_OFF = 'off';

/** Manifest keys (forever: stored in user scenes, dashboards and contracts). */
export const ACTIONS = { TEST: 'test_connection' };
export const SCENE_ACTIONS = { GET_PRICE: 'get_price', CHEAPEST_WINDOW: 'cheapest_window' };
export const SCENE_TRIGGERS = {
  CHEAP_STARTED: 'cheap_period_started',
  CHEAP_ENDED: 'cheap_period_ended',
  NEGATIVE_STARTED: 'negative_price_started',
  TOMORROW: 'tomorrow_prices_published',
};
export const WIDGETS = { PRICES: 'prices' };
export const CONTRACT_TEMPLATES = {
  ELECTRICITY: 'octopus-gb-electricity',
  GAS: 'octopus-gb-gas',
};
