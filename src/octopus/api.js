// -----------------------------------------------------------------------------
// The Octopus Energy GB REST API (https://developer.octopus.energy/rest/):
// the account and the meter consumption need the API key; the products and
// their unit rates and standing charges are public.
// -----------------------------------------------------------------------------

import { OCTOPUS_API_URL, PAGE_SIZE } from '../constants.js';
import { OctopusError, getAll, getJson } from '../http.js';
import { productOf } from './model.js';

const iso = (t) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
const KINDS = { electricity: 'electricity', gas: 'gas' };

export class OctopusClient {
  constructor({ apiKey = '', baseUrl = OCTOPUS_API_URL } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  url(path, query = {}) {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  requireKey() {
    if (!this.apiKey) {
      throw new OctopusError('no_key', 'No Octopus API key configured');
    }
  }

  /** The account: properties, electricity and gas meter points, agreements. */
  async account(accountNumber) {
    this.requireKey();
    if (!accountNumber) {
      throw new OctopusError('no_account', 'No Octopus account number configured');
    }
    try {
      return await getJson(this.url(`/accounts/${encodeURIComponent(accountNumber)}/`), {
        apiKey: this.apiKey,
      });
    } catch (err) {
      // An unknown number (or one this key does not own) answers 404: a
      // configuration mistake, retried with a backoff, never the fatal path.
      if (err instanceof OctopusError && err.code === 'not_found') {
        throw new OctopusError(
          'account_not_found',
          'Octopus does not know this account number for this key',
          404,
        );
      }
      throw err;
    }
  }

  /** Half-hourly consumption of one meter, oldest first. */
  async consumption(kind, point, serial, from, to) {
    this.requireKey();
    const path =
      kind === KINDS.gas
        ? `/gas-meter-points/${encodeURIComponent(point)}/meters/${encodeURIComponent(serial)}/consumption/`
        : `/electricity-meter-points/${encodeURIComponent(point)}/meters/${encodeURIComponent(serial)}/consumption/`;
    return getAll(
      this.url(path, {
        period_from: iso(from),
        period_to: iso(to),
        page_size: PAGE_SIZE,
        order_by: 'period',
      }),
      { apiKey: this.apiKey },
    );
  }

  /** Public: the products, to find the current Agile one. */
  async products() {
    return getAll(
      this.url('/products/', { brand: 'OCTOPUS_ENERGY', is_variable: 'true', page_size: 100 }),
    );
  }

  tariffPath(kind, tariffCode) {
    const product = productOf(tariffCode);
    if (!product) {
      throw new OctopusError('tariff', `Unsupported tariff code ${tariffCode}`);
    }
    const family = kind === KINDS.gas ? 'gas-tariffs' : 'electricity-tariffs';
    return `/products/${encodeURIComponent(product)}/${family}/${encodeURIComponent(tariffCode)}`;
  }

  /** Public: the unit rates (pence per kWh) of a tariff over [from, to). */
  async unitRates(kind, tariffCode, from, to) {
    return getAll(
      this.url(`${this.tariffPath(kind, tariffCode)}/standard-unit-rates/`, {
        period_from: iso(from),
        period_to: iso(to),
        page_size: PAGE_SIZE,
      }),
    );
  }

  /** Public: the standing charges (pence per day) of a tariff over [from, to). */
  async standingCharges(kind, tariffCode, from, to) {
    return getAll(
      this.url(`${this.tariffPath(kind, tariffCode)}/standing-charges/`, {
        period_from: iso(from),
        period_to: iso(to),
        page_size: 100,
      }),
    );
  }
}
