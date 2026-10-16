// -----------------------------------------------------------------------------
// Fake `fetch` for the Octopus REST calls: routes by URL path, records every
// call, fails loudly on an unexpected one. No test touches the network.
// -----------------------------------------------------------------------------

import { setFetch } from '../../src/http.js';

setFetch(async (url) => {
  throw new Error(`Network call without a fake fetch in a test: ${url}`);
});

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const page = (results, next = null) => json({ count: results.length, next, results });

/** The name of a call: account | consumption | products | rates | standing. */
export function routeName(pathname) {
  if (/^\/v1\/accounts\//.test(pathname)) return 'account';
  if (/\/consumption\/$/.test(pathname)) return 'consumption';
  if (/\/standard-unit-rates\/$/.test(pathname)) return 'rates';
  if (/\/standing-charges\/$/.test(pathname)) return 'standing';
  if (/^\/v1\/products\/$/.test(pathname)) return 'products';
  return 'unknown';
}

/** Keep the rates overlapping [period_from, period_to) of the query, like the API. */
export function inPeriod(rates, query) {
  const from = query.period_from ? Date.parse(query.period_from) : -Infinity;
  const to = query.period_to ? Date.parse(query.period_to) : Infinity;
  return rates.filter((r) => {
    const start = Date.parse(r.valid_from);
    const end = r.valid_to ? Date.parse(r.valid_to) : Infinity;
    return start < to && end > from;
  });
}

/** `routes` maps a call name to handler(call) -> Response. */
export function installFetch(routes) {
  const calls = [];
  const previous = setFetch(async (url, init = {}) => {
    const parsed = new URL(url);
    const call = {
      url,
      name: routeName(parsed.pathname),
      path: parsed.pathname,
      query: Object.fromEntries(parsed.searchParams),
      headers: init.headers ?? {},
    };
    calls.push(call);
    const handler = routes[call.name];
    if (!handler) {
      throw new Error(`Unexpected Octopus call in a test: ${call.name} ${parsed.pathname}`);
    }
    return handler(call);
  });
  return { calls, restore: () => setFetch(previous) };
}
