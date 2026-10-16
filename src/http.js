// -----------------------------------------------------------------------------
// The only place that talks to the network: GET a JSON document of the Octopus
// REST API, with a timeout, an identifiable User-Agent and, for the account
// endpoints, HTTP Basic authentication (the API key as user name, no
// password). The tests replace `fetch` with `setFetch()`.
// -----------------------------------------------------------------------------

import { HTTP_TIMEOUT, MAX_PAGES, USER_AGENT } from './constants.js';

let fetchImpl = (...args) => globalThis.fetch(...args);

/** Replace the fetch implementation (tests only). Returns the previous one. */
export function setFetch(impl) {
  const previous = fetchImpl;
  fetchImpl = impl;
  return previous;
}

export class OctopusError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'OctopusError';
    this.code = code;
    this.status = status;
  }
}

export const isCloudFrontError = (text = '') =>
  text.includes('The request could not be satisfied') && /cloudfront/i.test(text);

/** Retry-After (seconds or an HTTP date) -> milliseconds, undefined when absent or invalid. */
export function retryAfterMs(value, now = Date.now()) {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

/** GET a URL; resolves the parsed JSON body, throws an OctopusError otherwise. */
export async function getJson(url, { apiKey } = {}) {
  const headers = { 'User-Agent': USER_AGENT, Accept: 'application/json' };
  if (apiKey) {
    headers.Authorization = `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`;
  }
  let response;
  try {
    response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(HTTP_TIMEOUT) });
  } catch (err) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    throw new OctopusError(timeout ? 'timeout' : 'network', err?.message ?? String(err));
  }
  const text = await response.text();
  if (response.status === 401 || response.status === 403) {
    // CloudFront (in front of the API) answers its own 403 when it is
    // overloaded: a passing error, not a refused key (as BottlecapDave does).
    if (isCloudFrontError(text)) {
      throw new OctopusError('transient', 'Octopus is busy (CloudFront 403)', response.status);
    }
    // Only a key that was actually sent can be refused.
    throw apiKey
      ? new OctopusError('bad_key', 'Octopus refused the API key', response.status)
      : new OctopusError('http', `Octopus answered ${response.status}`, response.status);
  }
  if (response.status === 404) {
    // Never echo the URL: it holds the account number or a meter point.
    throw new OctopusError('not_found', 'Octopus answered 404 (not found)', 404);
  }
  if (response.status === 429) {
    const error = new OctopusError('rate_limited', 'Octopus asked to slow down (429)', 429);
    error.retryAfter = retryAfterMs(response.headers?.get?.('retry-after'));
    throw error;
  }
  if (!response.ok) {
    throw new OctopusError('http', `Octopus answered ${response.status}`, response.status);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new OctopusError('http', 'Octopus answered something that is not JSON');
  }
}

/** GET a paginated list (`{ results, next }`), following `next` up to MAX_PAGES. */
export async function getAll(url, options = {}) {
  const results = [];
  let next = url;
  for (let page = 0; next && page < MAX_PAGES; page += 1) {
    const body = await getJson(next, options);
    results.push(...(Array.isArray(body?.results) ? body.results : []));
    // Only follow links to the same API host (the key is sent along).
    next =
      typeof body?.next === 'string' && new URL(body.next).host === new URL(url).host
        ? body.next
        : null;
  }
  return results;
}
