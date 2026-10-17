# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Fixed

- Gas was counted as electricity: its consumption was attached to the main
  electricity meter of the energy monitoring and priced at the electricity
  rate (the Gladys core does not handle gas contracts yet). The gas device
  now stays out of the energy monitoring and shows "Gas used yesterday
  (kWh)" with its unit rate and standing charge. **Existing gas devices
  change only after "Update" in the integration's Discovery tab**, which
  reads the gas at once; if the gas still shows in the energy tab, delete
  the gas device and add it again from Discovery.

### Removed

- The "Octopus Energy gas" contract template: the core refuses gas
  contracts, and a contract made from it priced electricity at the gas rate.

## [0.1.2] - 2026-10-16

### Fixed

- Configuration and docs: the API key and the account number are kept by
  Gladys in its database (masked in the interface, not encrypted), never
  shown again and only sent to Octopus; they no longer claim encrypted
  storage.

## [0.1.1] - 2026-10-16

### Added

- One device per Octopus Energy (Great Britain) electricity and gas meter
  point: the 30-minute consumption fed, dated, to the Gladys energy
  monitoring (14 days filled in as soon as the device is created, and again
  once a day for late readings), the current unit rate and the standing
  charge, VAT included. SMETS2 gas readings in cubic metres are converted to
  kWh.
- Resilience: the account is read again after 5, 15, then every 60 minutes
  when it fails; a CloudFront 403 is not taken for a refused key; a 429
  pauses every call for its Retry-After.
- `THIRD_PARTY_NOTICES.md` with the MIT license of
  BottlecapDave/HomeAssistant-OctopusEnergy, shipped in the image.
- One device per Agile region with the public half-hourly prices (no account
  needed): price now, next, today's average, minimum and maximum, "cheap
  period" and "negative price" sensors. The region can follow the account's
  tariff.
- Scene triggers "cheap period started / ended", "negative price started" and
  "tomorrow's prices published".
- Scene actions "price now" and "cheapest hours".
- Dashboard widget "Octopus prices" (curve of today and tomorrow).
- Delegated energy contract templates for electricity and gas (Gladys 5.2+):
  every half hour priced at the unit rate of the tariff in force then, plus
  the daily standing charge.
- "Test the connection" button.

[Unreleased]: https://github.com/LM1LC3N7/gladys-octopus-energy/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/LM1LC3N7/gladys-octopus-energy/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-octopus-energy/releases/tag/v0.1.1
