// A local stand-in for the GTM template sandbox and its test framework, so the
// ___TESTS___ scenarios in template.tpl run in CI as well as in the GTM editor.
// Every sandboxed API call is checked against ___WEB_PERMISSIONS___ before any
// mock runs, which is stricter than GTM: a permission gap fails here first.

import { isDeepStrictEqual } from 'node:util';

export function parseSections(text) {
  const sections = {};
  let current = null;
  for (const line of text.replace(/^\uFEFF/, '').split('\n')) {
    const header = line.match(/^___([A-Z_]+)___$/);
    if (header) {
      current = header[1];
      sections[current] = [];
    } else if (current) {
      sections[current].push(line);
    }
  }
  for (const name of Object.keys(sections)) {
    sections[name] = sections[name].join('\n').trim();
  }
  return sections;
}

function readValue(value) {
  switch (value.type) {
    case 1:
      return value.string;
    case 2:
      return value.listItem.map(readValue);
    case 3:
      return Object.fromEntries(value.mapKey.map((k, i) => [readValue(k), readValue(value.mapValue[i])]));
    case 8:
      return value.boolean;
    default:
      throw new Error(`unsupported permission value type ${value.type}`);
  }
}

export function parsePermissions(json) {
  const perms = {};
  for (const entry of JSON.parse(json)) {
    const params = Object.fromEntries((entry.instance.param || []).map((p) => [p.key, readValue(p.value)]));
    perms[entry.instance.key.publicId] = params;
  }
  return perms;
}

export function urlMatches(pattern, url) {
  const re = new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return re.test(url);
}

function consentReadable(perms, type) {
  return (perms.access_consent?.consentTypes || []).some((c) => c.consentType === type && c.read === true);
}

// name -> [permission check returning an error string or null, default behavior]
export const APIS = {
  addConsentListener: [
    (perms, [type]) => (consentReadable(perms, type) ? null : `access_consent read not declared for ${type}`),
    () => undefined,
  ],
  callInWindow: [
    (perms, [path]) =>
      (perms.access_globals?.keys || []).some((k) => k.key === path && k.execute === true)
        ? null
        : `access_globals execute not declared for ${path}`,
    () => undefined,
  ],
  encodeUriComponent: [() => null, (value) => encodeURIComponent(value)],
  injectScript: [
    (perms, [url]) =>
      (perms.inject_script?.urls || []).some((p) => urlMatches(p, url)) ? null : `inject_script not declared for ${url}`,
    () => undefined,
  ],
  // An unset consent type reads as granted in GTM.
  isConsentGranted: [
    (perms, [type]) => (consentReadable(perms, type) ? null : `access_consent read not declared for ${type}`),
    () => true,
  ],
  logToConsole: [(perms) => (perms.logging ? null : 'logging not declared'), () => undefined],
  setInWindow: [
    (perms, [key]) =>
      (perms.access_globals?.keys || []).some((k) => k.key === key && k.write === true)
        ? null
        : `access_globals write not declared for ${key}`,
    () => true,
  ],
  // An object rather than a function; runScenario hands out one per page.
  templateStorage: [() => null, () => undefined],
};

export const API_PERMISSION = {
  addConsentListener: 'access_consent',
  callInWindow: 'access_globals',
  encodeUriComponent: null,
  injectScript: 'inject_script',
  isConsentGranted: 'access_consent',
  logToConsole: 'logging',
  setInWindow: 'access_globals',
  templateStorage: null,
};

class AssertionFailure extends Error {}

export function runScenario({ code, permissions, scenarioCode, setupCode = '' }) {
  const mocks = new Map();
  const calls = new Map();

  const record = (name, args) => {
    if (!calls.has(name)) calls.set(name, []);
    calls.get(name).push(args);
  };

  const sandboxed = (name) => (...args) => {
    const [check, fallback] = APIS[name];
    const denied = check(permissions, args);
    if (denied) throw new Error(`permission denied: ${denied}`);
    record(name, args);
    if (mocks.has(name)) {
      const mocked = mocks.get(name);
      return typeof mocked === 'function' ? mocked(...args) : mocked;
    }
    return fallback(...args);
  };

  // One storage per scenario: every runCode in it is a tag on the same page.
  const stored = new Map();
  const templateStorage = {
    getItem: (key) => stored.get(key),
    setItem: (key, value) => void stored.set(key, value),
    removeItem: (key) => void stored.delete(key),
    clear: () => stored.clear(),
  };

  const requireApi = (name) => {
    if (!(name in APIS)) throw new Error(`require of unsupported API ${name}`);
    return name === 'templateStorage' ? templateStorage : sandboxed(name);
  };

  const callback = (name) => (...args) => record(name, args);

  const runCode = (data) => {
    const input = { ...data, gtmOnSuccess: callback('gtmOnSuccess'), gtmOnFailure: callback('gtmOnFailure') };
    new Function('require', 'data', code)(requireApi, input);
  };

  const fail = (message) => {
    throw new AssertionFailure(message || 'fail() called');
  };

  const assertApi = (name) => {
    const made = () => calls.get(name) || [];
    return {
      wasCalled: () => made().length > 0 || fail(`expected ${name} to be called`),
      wasNotCalled: () => made().length === 0 || fail(`expected ${name} not to be called, got ${JSON.stringify(made())}`),
      wasCalledWith: (...args) =>
        made().some((c) => isDeepStrictEqual(c, args)) ||
        fail(`expected ${name} called with ${JSON.stringify(args)}, got ${JSON.stringify(made())}`),
      wasNotCalledWith: (...args) =>
        !made().some((c) => isDeepStrictEqual(c, args)) || fail(`expected ${name} not called with ${JSON.stringify(args)}`),
    };
  };

  const assertThat = (actual) => ({
    isEqualTo: (expected) =>
      isDeepStrictEqual(actual, expected) || fail(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`),
    isNotEqualTo: (expected) => !isDeepStrictEqual(actual, expected) || fail(`expected not ${JSON.stringify(expected)}`),
    isTrue: () => actual === true || fail(`expected true, got ${JSON.stringify(actual)}`),
    isFalse: () => actual === false || fail(`expected false, got ${JSON.stringify(actual)}`),
    isUndefined: () => actual === undefined || fail(`expected undefined, got ${JSON.stringify(actual)}`),
    isDefined: () => actual !== undefined || fail('expected a defined value'),
  });

  const mock = (name, value) => {
    if (!(name in APIS)) throw new Error(`mock of unsupported API ${name}`);
    mocks.set(name, value);
  };

  new Function('mock', 'runCode', 'assertApi', 'assertThat', 'fail', 'require', `${setupCode}\n${scenarioCode}`)(
    mock,
    runCode,
    assertApi,
    assertThat,
    fail,
    requireApi,
  );
}
