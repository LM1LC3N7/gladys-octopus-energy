// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACTIONS,
  CONTRACT_TEMPLATES,
  REGIONS,
  SCENE_ACTIONS,
  SCENE_TRIGGERS,
  WIDGETS,
} from '../src/constants.js';
import { DEFAULTS } from '../src/config.js';
import { PERIODS } from '../src/scenes.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const pkg = JSON.parse(read('package.json'));
const index = read('index.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) {
      yield* texts(item, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.match(manifest.gladys_version, />=5\.2\.0/, 'energy contracts need Gladys 5.2');
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-octopus-energy:${manifest.version}`);
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
  }
  assert.match(manifest.description.en, /Unofficial/);
  assert.match(manifest.description.fr, /Non officiel/);
});

test('every text is bilingual', () => {
  for (const [path, text] of texts(manifest)) {
    assert.ok(text.en?.trim() && text.fr?.trim(), `${path} needs en and fr`);
  }
  // A store rule: a widget card description holds at most 100 characters.
  for (const widget of manifest.widgets) {
    for (const [lang, text] of Object.entries(widget.description)) {
      assert.ok(text.length <= 100, `widget ${widget.key} description.${lang}: ${text.length}`);
    }
  }
});

test('the configuration matches the code', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  assert.equal(fields.api_key.type, 'secret');
  assert.equal(fields.account_number.type, 'secret', 'the account number is personal data');
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.equal(fields[key].default, value, `${key} default`);
  }
  assert.deepEqual(
    fields.agile_region.options.map((o) => o.value),
    ['auto', 'off', ...Object.keys(REGIONS)],
  );
  const section = fields.intro;
  assert.equal(section.type, 'section');
  assert.equal(section.default, undefined);
  for (const link of section.links) {
    assert.match(link.url, /^https:\/\//);
  }
});

test('the keys of the manifest are the keys of the code', () => {
  assert.deepEqual(
    manifest.actions.map((a) => a.key),
    Object.values(ACTIONS),
  );
  assert.deepEqual(
    manifest.scene_actions.map((a) => a.key).sort(),
    Object.values(SCENE_ACTIONS).sort(),
  );
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );
  assert.deepEqual(manifest.widgets.map((w) => w.key).sort(), Object.values(WIDGETS).sort());
  for (const name of Object.keys(SCENE_ACTIONS)) {
    assert.ok(index.includes(`onSceneAction(SCENE_ACTIONS.${name}`), name);
  }
  assert.ok(index.includes('onEnergyPrice') && index.includes('onEnergyCurrent'));
  assert.ok(index.includes('onAction(ACTIONS.TEST'));
  const period = manifest.scene_actions
    .find((a) => a.key === SCENE_ACTIONS.CHEAPEST_WINDOW)
    .fields.find((f) => f.key === 'period');
  assert.deepEqual(
    period.options.map((o) => o.value),
    PERIODS,
  );
});

test('the energy contract templates', () => {
  const { templates } = manifest.energy_contracts;
  assert.deepEqual(
    templates.map((t) => t.key),
    Object.values(CONTRACT_TEMPLATES),
  );
  for (const template of templates) {
    assert.equal(template.pricing_mode, 'delegated');
    assert.equal(template.currency, 'GBP');
    assert.deepEqual(
      template.inputs.map((i) => i.key),
      ['meter_point', 'standing_charge'],
    );
    assert.ok(
      template.tariff.components.every((c) => c.kind === 'fixed'),
      'delegated: fixed components only',
    );
  }
});
