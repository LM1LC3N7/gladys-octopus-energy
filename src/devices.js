// -----------------------------------------------------------------------------
// The Gladys devices and their states. Pure.
//
// External ids (forever):
//   agile:<region letter>   the public Agile prices of a GSP region (A..P)
//   electricity:<MPAN>      an import electricity meter point of the account
//   gas:<MPRN>              a gas meter point of the account
// The meter POINT is the stable id: a replaced meter (new serial) keeps the
// same Gladys device and its history.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { REGIONS } from './constants.js';

export const KIND = { AGILE: 'agile', ELECTRICITY: 'electricity', GAS: 'gas' };

export const FEATURE = {
  // Agile
  PRICE: 'price',
  NEXT: 'next_price',
  AVG: 'avg_price',
  MIN: 'min_price',
  MAX: 'max_price',
  CHEAP: 'cheap_period',
  NEGATIVE: 'negative_price',
  // Meters
  CONSUMPTION: 'consumption',
  GAS_YESTERDAY: 'gas_yesterday_kwh',
  UNIT_RATE: 'unit_rate',
  STANDING_CHARGE: 'standing_charge',
};

export const ids = (gladys, kind, id) => gladys.externalIds(kind, String(id));

export function parseExternalId(externalId) {
  const match = /:(agile|electricity|gas):([^:]+)$/.exec(String(externalId ?? ''));
  return match ? { kind: match[1], id: match[2] } : undefined;
}

const feature = (external, key, name, category, type, extra = {}) => ({
  name,
  external_id: external.feature(key),
  category,
  type,
  min: 0,
  max: 1,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...extra,
});

const money = (external, key, name, { min = -10, max = 10 } = {}) =>
  feature(external, key, name, C.CURRENCY, T.CURRENCY.DECIMAL, {
    min,
    max,
    unit: U.POUND_STERLING,
  });

/** The device of the public Agile prices of a region. */
export function buildAgileDevice(gladys, { region, product }) {
  const external = ids(gladys, KIND.AGILE, region);
  return {
    name: `Octopus Agile ${REGIONS[region] ?? region}`,
    external_id: external.device,
    features: [
      money(external, FEATURE.PRICE, 'Price per kWh'),
      money(external, FEATURE.NEXT, 'Next price per kWh'),
      money(external, FEATURE.AVG, "Today's average price"),
      money(external, FEATURE.MIN, "Today's minimum price"),
      money(external, FEATURE.MAX, "Today's maximum price"),
      feature(external, FEATURE.CHEAP, 'Cheap period', C.UNKNOWN, T.SENSOR.BINARY, {
        keep_history: false,
      }),
      feature(external, FEATURE.NEGATIVE, 'Negative price', C.UNKNOWN, T.SENSOR.BINARY, {
        keep_history: false,
      }),
    ],
    params: [
      { name: 'region', value: region },
      { name: 'product', value: product ?? '' },
    ],
  };
}

/**
 * The device of an electricity or gas meter point of the account.
 *
 * Gas stays OUT of the energy monitoring: the core prices every consumption
 * feature (`energy-sensor` consumption or index, `energy` included) as
 * electricity under the main electric meter, and refuses gas contracts in
 * contracts v1. A gas meter only carries yesterday's use in kWh, as a plain
 * sensor (`unknown`: no core category takes kWh without being an energy
 * source), and its tariff.
 */
export function buildMeterDevice(gladys, meter) {
  const external = ids(gladys, meter.kind, meter.point);
  const gas = meter.kind === KIND.GAS;
  return {
    name: `Octopus ${gas ? 'gas' : 'electricity'} (${gas ? 'MPRN' : 'MPAN'} …${meter.point.slice(-4)})`,
    external_id: external.device,
    features: [
      gas
        ? feature(
            external,
            FEATURE.GAS_YESTERDAY,
            'Gas used yesterday (kWh)',
            C.UNKNOWN,
            T.UNKNOWN.UNKNOWN,
            {
              max: 10000,
            },
          )
        : feature(
            external,
            FEATURE.CONSUMPTION,
            'Consumption (30 min)',
            C.ENERGY_SENSOR,
            T.ENERGY_SENSOR.THIRTY_MINUTES_CONSUMPTION,
            { unit: U.KILOWATT_HOUR, max: 1000 },
          ),
      money(external, FEATURE.UNIT_RATE, 'Unit rate per kWh'),
      money(external, FEATURE.STANDING_CHARGE, 'Standing charge per day', { min: 0, max: 100 }),
    ],
    params: [
      { name: gas ? 'mprn' : 'mpan', value: meter.point },
      { name: 'serial_number', value: meter.serial ?? meter.serials.at(-1) ?? '' },
      { name: 'tariff_code', value: meter.tariffCode ?? '' },
    ],
  };
}

const state = (external, key, value) =>
  value === null || value === undefined
    ? []
    : [
        {
          device_feature_external_id: external.feature(key),
          state: Math.round(value * 100000) / 100000,
        },
      ];

/** The states of an Agile price state (src/octopus/model.js `priceState`). */
export function agileStates(external, price) {
  if (!price) {
    return [];
  }
  return [
    ...state(external, FEATURE.PRICE, price.slot.price),
    ...state(external, FEATURE.NEXT, price.next?.price ?? null),
    ...state(external, FEATURE.AVG, price.stats?.avg ?? null),
    ...state(external, FEATURE.MIN, price.stats?.min ?? null),
    ...state(external, FEATURE.MAX, price.stats?.max ?? null),
    ...state(external, FEATURE.CHEAP, price.cheap ? 1 : 0),
    ...state(external, FEATURE.NEGATIVE, price.negative ? 1 : 0),
  ];
}

/** The state of the gas used yesterday (kWh), a plain sensor outside the energy monitoring. */
export const gasYesterdayStates = (external, kwh) => state(external, FEATURE.GAS_YESTERDAY, kwh);

/** The states of a meter's tariff: the unit rate now, the standing charge today. */
export function tariffStates(external, { rate, standingCharge }) {
  return [
    ...state(external, FEATURE.UNIT_RATE, rate?.price ?? null),
    ...state(external, FEATURE.STANDING_CHARGE, standingCharge?.price ?? null),
  ];
}
