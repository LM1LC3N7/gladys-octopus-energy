// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized.
// -----------------------------------------------------------------------------

import { REGIONS, REGION_AUTO, REGION_OFF } from './constants.js';

// Defaults: they MUST match the `default` values of the manifest.
export const DEFAULTS = {
  agile_region: REGION_AUTO,
  cheap_hours: 3,
  gas_unit: 'm3',
  gas_calorific_value: 40,
};

const number = (value, fallback, min, max) => {
  const n = Number(value);
  return value !== '' && value !== null && value !== undefined && Number.isFinite(n)
    ? Math.min(max, Math.max(min, n))
    : fallback;
};

const text = (value) => (typeof value === 'string' ? value.trim() : '');

export function normalizeConfig(raw = {}) {
  const region = text(raw.agile_region);
  return {
    apiKey: text(raw.api_key),
    // Account numbers look like A-1B2C3D4E; the user may paste them in lower case.
    accountNumber: text(raw.account_number).toUpperCase(),
    agileRegion:
      region.toUpperCase() in REGIONS
        ? region.toUpperCase()
        : region === REGION_OFF
          ? REGION_OFF
          : REGION_AUTO,
    // Half-hour steps: Agile slots last 30 minutes.
    cheapHours: Math.round(number(raw.cheap_hours, DEFAULTS.cheap_hours, 0.5, 12) * 2) / 2,
    gasUnit: raw.gas_unit === 'kwh' ? 'kwh' : DEFAULTS.gas_unit,
    gasCalorificValue: number(raw.gas_calorific_value, DEFAULTS.gas_calorific_value, 30, 50),
  };
}
