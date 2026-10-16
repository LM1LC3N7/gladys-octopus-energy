# TODO

## Before announcing

- [ ] Test on a real Gladys 5.2+ with a real Octopus UK account: discovery,
      the consumption backfill once the devices are created, the tariff
      features, the Agile device and its triggers over a day (tomorrow at
      16:00), an electricity and a gas contract priced, the widget.
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic to publish in the store
      (after the first release: the store validator needs the GHCR image).

## To confirm on a real instance (built without an Octopus account)

- [ ] The account JSON (`/v1/accounts/<number>/`) and the consumption JSON
      follow the REST reference the fixtures are shaped after; only the
      public Agile rates were checked live (region C, 2026-10-16).
- [ ] A key that does not own the account answers 404 (shown as an unknown
      account number and retried) or 403 (shown as a refused key).
- [ ] The CloudFront 403 page still contains "The request could not be
      satisfied" and "CloudFront" (the test for a passing error).
- [ ] `gladys.devices` holds the created devices at start (refreshed on each
      connection), so a created meter is read without waiting for
      `onDeviceCreated`.
- [ ] A gas consumption feature (`energy-sensor` / `thirty-minutes-consumption`)
      becomes its own root meter once a gas contract is attached, and is not
      shown under the main electricity meter before that.
- [ ] SMETS1 / SMETS2 detection: the REST API does not say which unit a gas
      meter reports, hence the `gas_unit` option (BottlecapDave reads it from
      GraphQL).
- [ ] `publishEnergyConsumption` accepts the 14-day backfill in one call (≤ 2,000
      intervals: 672 per meter).

## Decisions

- **Great Britain only: Germany and Italy are not covered in this version.**
  Octopus France is covered by guim31/gladys-octopus-fr.
  Germany (`api.oeg-kraken.energy`) and Italy (`api.oeit-kraken.energy`) run
  Kraken GraphQL with an e-mail + password token (`obtainKrakenToken`), not
  an API key, and their schemas could not be checked without an account:
  left out of milestone 1 rather than shipped unverified. Candidate for a
  later milestone if a user can test.
- **No cumulative index**: Octopus readings arrive late (often the next day).
  A late index would collapse a day into one half hour (SDK doctrine), so the
  energy monitoring is fed with dated 30-minute consumption
  (`publishEnergyConsumption`) instead. A live index needs an Octopus Home
  Mini (GraphQL `smartMeterTelemetry`): see Ideas.
- **External ids**: `agile:<region>`, `electricity:<MPAN>`, `gas:<MPRN>`. The
  meter point, not the serial, so a replaced meter keeps its Gladys device.
- **Prices in pounds, VAT included** (`value_inc_vat` ÷ 100); the direct debit
  rate wins when a tariff lists both payment methods.
- **Cheap period and triggers on the Agile device only**: a flat tariff has
  no cheap hours. The scene actions and the widget also accept a meter (its
  own tariff slots, useful on Agile, Go…).
- **"Cheap period" and "negative price" stay `unknown` / `binary`**, as in
  gladys-tibber: the core categories with a `binary` type (switch, lock,
  energy-sensor, teleinformation, input…) all describe a device state, none
  a computed price flag; an `energy-sensor` binary could also be picked up by
  the energy monitoring.
- **Errors**: only a 401/403 of the account endpoint with the key sent is a
  refused key (the fatal path, which still keeps every timer); a CloudFront
  403 is a passing error (as BottlecapDave does); an account 404 is an
  unknown account number. Every account failure (or a key without any meter
  yet) is retried after 5, 15, then every 60 minutes. A 429 stops the cycle
  and pauses every call for Retry-After, 15 minutes otherwise.
- **Consumption only for the created meter devices**: nothing is asked of
  Octopus for a meter nobody added; `onDeviceCreated` starts the 14-day
  backfill at once, and the 14 days are read again once a day after 04:00 UK
  time (late readings).
- **Serial**: the known one first; when it gives nothing (or a 404), every
  meter of the point is asked and the one with the latest reading is kept
  (the order of `meters[]` means nothing); the choice is reset when the list
  of serials changes.
- **The account number is a `secret` field** (personal data), like the key.
- **Negative Agile prices** cost zero in the delegated contracts (core costs
  are ≥ 0); the "negative price" trigger and sensor show them.
- **The key goes only to the account and consumption endpoints**; tariffs,
  standing charges, products and Agile prices are fetched without it.
- **Versions**: 0.1.0 set once by hand when leaving the template (package,
  manifest, image tag), as for the sibling integrations; the Release workflow
  owns them from now on.
- **Reused project**: no maintained JavaScript Octopus client exists; the
  logic of BottlecapDave/HomeAssistant-OctopusEnergy (MIT) is ported and
  credited (src/octopus/model.js, README, docs).

## Ideas

- Two-rate tariffs (Economy 7, `E-2R-…`): `day-unit-rates` / `night-unit-rates`
  with the night window of the meter.
- Export meters (Outgoing Agile, Flux): `energy-production-sensor` /
  `thirty-minutes-production`.
- Octopus Home Mini live power and index through the GraphQL API
  (`obtainKrakenToken` with the API key).
- Intelligent Octopus dispatches and saving sessions (GraphQL).
- Germany and Italy (Kraken GraphQL), see Decisions.
