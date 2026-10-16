// -----------------------------------------------------------------------------
// Octopus answers for the tests. `agile-c-2026-10-16.json` is a real answer of
// the public endpoint (region C, 16 and 17 October 2026, read once on
// 2026-10-16); the account and the consumption are synthetic, shaped after
// the REST API reference (developer.octopus.energy/rest/reference).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const NOW = Date.parse('2026-10-16T10:40:00Z'); // 11:40 in London (BST)
export const ACCOUNT = 'A-AAAA1111';
export const MPAN = '1900000000001';
export const MPRN = '3000000001';
export const OLD_SERIAL = '19L0000001';
export const SERIAL = '21E0000002';
export const GAS_SERIAL = 'E6S00000000001';
export const AGILE_PRODUCT = 'AGILE-24-10-01';
export const AGILE_TARIFF = 'E-1R-AGILE-24-10-01-C';
export const GAS_TARIFF = 'G-1R-VAR-22-11-01-C';
export const OLD_TARIFF = 'E-1R-VAR-22-11-01-C';

/** The real Agile rates of region C (pence, newest first, like the API). */
export const AGILE_RATES = JSON.parse(
  readFileSync(new URL('./agile-c-2026-10-16.json', import.meta.url), 'utf8'),
).results;

export function account() {
  return {
    number: ACCOUNT,
    properties: [
      {
        id: 1234567,
        moved_in_at: '2020-03-01T00:00:00Z',
        moved_out_at: null,
        address_line_1: '1 Example Street',
        town: 'LONDON',
        postcode: 'SW1A 1AA',
        electricity_meter_points: [
          {
            mpan: MPAN,
            profile_class: 1,
            consumption_standard: 2700,
            meters: [{ serial_number: OLD_SERIAL }, { serial_number: SERIAL }],
            agreements: [
              {
                tariff_code: OLD_TARIFF,
                valid_from: '2024-01-01T00:00:00Z',
                valid_to: '2026-10-01T00:00:00+01:00',
              },
              {
                tariff_code: AGILE_TARIFF,
                valid_from: '2026-10-01T00:00:00+01:00',
                valid_to: null,
              },
            ],
            is_export: false,
          },
          {
            mpan: '1900000000999',
            meters: [{ serial_number: SERIAL }],
            agreements: [
              {
                tariff_code: 'E-1R-OUTGOING-FIX-12M-19-05-13-C',
                valid_from: '2024-01-01T00:00:00Z',
                valid_to: null,
              },
            ],
            is_export: true,
          },
        ],
        gas_meter_points: [
          {
            mprn: MPRN,
            consumption_standard: 11500,
            meters: [{ serial_number: GAS_SERIAL }],
            agreements: [
              { tariff_code: GAS_TARIFF, valid_from: '2024-01-01T00:00:00Z', valid_to: null },
            ],
          },
        ],
      },
      {
        id: 7654321,
        moved_in_at: '2015-01-01T00:00:00Z',
        moved_out_at: '2020-02-28T00:00:00Z',
        address_line_1: 'Old flat',
        postcode: 'E1 6AN',
        electricity_meter_points: [
          {
            mpan: '1100000000000',
            meters: [{ serial_number: 'OLD' }],
            agreements: [
              { tariff_code: OLD_TARIFF, valid_from: '2015-01-01T00:00:00Z', valid_to: null },
            ],
          },
        ],
        gas_meter_points: [],
      },
    ],
  };
}

/** Half-hourly readings over [from, to), `value` each (kWh, or m³ for SMETS2 gas). */
export function readings(from, to, value) {
  const results = [];
  for (let t = Date.parse(from); t < Date.parse(to); t += 30 * 60_000) {
    results.push({
      consumption: value,
      interval_start: new Date(t).toISOString().replace('.000Z', 'Z'),
      interval_end: new Date(t + 30 * 60_000).toISOString().replace('.000Z', 'Z'),
    });
  }
  return results;
}

/** A flexible (variable) tariff: one rate per payment method, still in force. */
export const FLAT_RATES = [
  {
    value_exc_vat: 5.8,
    value_inc_vat: 6.09,
    valid_from: '2026-04-01T00:00:00Z',
    valid_to: null,
    payment_method: 'DIRECT_DEBIT',
  },
  {
    value_exc_vat: 6.1,
    value_inc_vat: 6.405,
    valid_from: '2026-04-01T00:00:00Z',
    valid_to: null,
    payment_method: 'NON_DIRECT_DEBIT',
  },
];

export const OLD_RATES = [
  {
    value_exc_vat: 23.0,
    value_inc_vat: 24.15,
    valid_from: '2026-04-01T00:00:00+01:00',
    valid_to: null,
    payment_method: 'DIRECT_DEBIT',
  },
];

export const STANDING_CHARGES = [
  {
    value_exc_vat: 45.0,
    value_inc_vat: 47.25,
    valid_from: '2026-04-01T00:00:00Z',
    valid_to: null,
    payment_method: 'DIRECT_DEBIT',
  },
];

export const PRODUCTS = [
  {
    code: 'AGILE-OUTGOING-19-05-13',
    direction: 'EXPORT',
    display_name: 'Agile Outgoing Octopus',
    is_business: false,
    available_from: '2018-01-01T00:00:00Z',
    available_to: null,
  },
  {
    code: 'AGILE-23-12-06',
    direction: 'IMPORT',
    display_name: 'Agile Octopus',
    is_business: false,
    available_from: '2023-12-06T00:00:00Z',
    available_to: '2024-10-01T00:00:00+01:00',
  },
  {
    code: AGILE_PRODUCT,
    direction: 'IMPORT',
    display_name: 'Agile Octopus',
    is_business: false,
    available_from: '2024-10-01T00:00:00+01:00',
    available_to: null,
  },
  {
    code: 'VAR-22-11-01',
    direction: 'IMPORT',
    display_name: 'Flexible Octopus',
    is_business: false,
    available_from: '2022-11-01T00:00:00Z',
    available_to: null,
  },
];
