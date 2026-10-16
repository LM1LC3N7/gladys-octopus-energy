# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

It reads **Octopus Energy Great Britain** through the official REST API
(`api.octopus.energy/v1`, HTTP Basic with the account's API key): the meters
of the account, their half-hourly consumption, their tariff, and the public
Agile prices of a region. Unofficial: not affiliated with Octopus Energy.
Sibling of `gladys-tibber` and `gladys-nord-pool` (same price model and scene
vocabulary). France is out of scope (guim31/gladys-octopus-fr).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/model.test.js            # one file
node --test --test-name-pattern "Agile"   # tests whose name matches
npm run audit                             # npm audit --omit=dev
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: handlers registered before connect()
src/app.js                        OctopusApp: discovery, tariffs + Agile + tick, tomorrow,
                                  consumption, scene actions, widget, delegated pricing
src/octopus/api.js                the REST calls (the key only on account + consumption)
src/octopus/model.js              tariff codes, meters, rates -> slots, Agile state, consumption (pure)
src/devices.js                    the devices, feature keys, states (pure)
src/triggers.js                   transitions -> scene events (pure)
src/scenes.js                     scene action outputs (pure)
src/energy.js                     interval costs from the tariff in force (pure)
src/widget.js                     the "prices" widget (pure)
src/config.js                     DEFAULTS (mirror the manifest defaults) + normalization
src/constants.js                  endpoints, pacing, regions, manifest keys
src/i18n.js                       runtime texts (en/fr)
src/http.js                       the only HTTP access (GET JSON, pagination, errors)
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, against the SDK's fake Gladys (integration-sdk/testing)
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **Octopus keys are forever too**: the external ids `agile:<region>`,
  `electricity:<MPAN>`, `gas:<MPRN>`, the `FEATURE` keys of `src/devices.js`,
  the manifest keys of `src/constants.js` and the contract template keys
  `octopus-gb-electricity` / `octopus-gb-gas`.
- **Be polite with Octopus**: account every 6 h, consumption and tariffs every
  hour, tomorrow's Agile prices every 15 min only after 16:00 UK time and only
  until published. Never send the API key to the public endpoints.
- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the unique id the
  platform gives the device (serial, cloud id, MAC), never a label. Gladys keys
  devices, their history, scenes and dashboards on them: changing one creates a
  new device and orphans the old one. The same goes for every key users store:
  manifest `config_schema`, `actions`, widget and scene keys, feature keys.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log tokens, passwords or API keys.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language. A field the
  older cores do not know needs a higher `gladys_version` minimum
  (`categories`: 4.86.0; `widgets`, `scene_triggers`, `scene_actions`,
  `type: "provider"`: 5.1.0). `test/manifest.test.js` ties the manifest to the
  code (defaults, action, scene and widget handlers): change both sides
  together.
- **User-facing text** is bilingual (English and French): action messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
