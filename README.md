# gladys-octopus-energy

[Gladys Assistant](https://gladysassistant.com) external integration for
**Octopus Energy (Great Britain)**: electricity and gas meters, half-hourly
electricity consumption for the energy monitoring, yesterday's gas use (kept
out of the energy monitoring until the core handles gas contracts), current
unit rates and standing charges, public Agile prices with cheap-hours and
negative-price scene triggers, a dashboard widget and a delegated electricity
contract. **Unofficial, not affiliated
with Octopus Energy.** Octopus Energy France is out of scope (see the Octopus
Energy France integration). **Germany and Italy are not covered in this
version** (Kraken GraphQL with an e-mail and password login, see TODO.md).

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/app.js (OctopusApp)
                 ├─ src/octopus/api.js    REST calls (api.octopus.energy/v1)
                 ├─ src/octopus/model.js  tariffs, meters, rates -> slots, Agile state, consumption (pure)
                 ├─ src/devices.js        the devices and their states (pure)
                 ├─ src/triggers.js       transitions -> scene events (pure)
                 ├─ src/scenes.js         scene action outputs (pure)
                 ├─ src/energy.js         delegated pricing of 30-minute intervals (pure)
                 └─ src/widget.js         the prices widget (pure)
```

- **Account** (`/accounts/<number>/`, HTTP Basic with the API key) at start
  and every 6 hours: import electricity points and gas points with an
  agreement in force; export points and moved-out properties are skipped.
  A failed read (or a key without any meter yet) is retried after 5, 15,
  then every 60 minutes. Only a 401/403 of this endpoint is a refused key; a
  CloudFront 403 is a passing error.
- **Consumption** (`/…-meter-points/<point>/meters/<serial>/consumption/`)
  every hour for the created devices only, 3 days back; 14 days at the
  creation of the device and once a day after 04:00 UK time. Electricity is
  published dated with `publishEnergyConsumption`; gas never is (the core
  would count it as electricity): only yesterday's total, once complete, as a
  plain `unknown` sensor. The meter of the point with the latest reading is
  used; another one is tried when it has nothing.
- **Tariffs and Agile prices** (public `standard-unit-rates` and
  `standing-charges` of the tariff code) every hour, up to the real end of
  tomorrow (23- and 25-hour days included); the Agile prices again at 16:02 UK
  time and every 15 minutes until tomorrow's are out. A 429 stops the cycle
  and pauses every call for its Retry-After (15 minutes otherwise). A tick every half hour moves
  the sensors and fires the transitions.
- **Contracts**: `pricing_mode: delegated`; `onEnergyPrice` finds the
  agreement in force at each interval and prices it with that tariff's unit
  rate; the standing charge is a `fixed` per-day component the core adds.

## Credits

The tariff and meter logic (tariff codes, product of a tariff, direct-debit
rates, meter selection, m³ → kWh) follows
[BottlecapDave/HomeAssistant-OctopusEnergy](https://github.com/BottlecapDave/HomeAssistant-OctopusEnergy),
MIT License, Copyright (c) 2021 David Kendall. Modelled on the sibling
integrations [gladys-tibber](https://github.com/LM1LC3N7/gladys-tibber) and
[gladys-nord-pool](https://github.com/LM1LC3N7/gladys-nord-pool).

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit                                   # npm audit --omit=dev
npx github:GladysAssistant/integration-store .  # store admission checks
```

Tests never touch the network: `test/fixtures/agile-c-2026-10-16.json` is a
real answer of the public Agile endpoint (read once), the account and the
consumption are synthetic, shaped after the REST reference. Gladys is the
SDK's fake.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0 (`LICENSE`). The logic ported from BottlecapDave/HomeAssistant-OctopusEnergy
remains under its MIT license, reproduced in full in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) (also shipped in the Docker image).
