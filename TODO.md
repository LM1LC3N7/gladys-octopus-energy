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
- [ ] A key that does not own the account answers 404 (treated as a refused
      key) rather than 403.
- [ ] A gas consumption feature (`energy-sensor` / `thirty-minutes-consumption`)
      becomes its own root meter once a gas contract is attached, and is not
      shown under the main electricity meter before that.
- [ ] SMETS1 / SMETS2 detection: the REST API does not say which unit a gas
      meter reports, hence the `gas_unit` option (BottlecapDave reads it from
      GraphQL).
- [ ] `publishEnergyConsumption` accepts the 14-day backfill in one call (≤ 2,000
      intervals: 672 per meter).

## Decisions

- **Great Britain only.** Octopus France is covered by guim31/gladys-octopus-fr.
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
