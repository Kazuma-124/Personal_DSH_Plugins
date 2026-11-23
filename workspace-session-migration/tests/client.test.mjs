import assert from 'node:assert/strict';
import test from 'node:test';

test('the browser module registers the panel, navigation entry, and dictionaries', async () => {
  let loaded;
  globalThis.window = {
    __ModuleLoader__: {
      load(value) {
        loaded = value;
      },
    },
  };
  await import('../client.js');
  assert.equal(loaded.id, '@kazuma-124/dsh-workspace-session-migration');

  const react = {
    createElement: () => null,
    useState: value => [value, () => {}],
    useEffect: () => {},
    useCallback: callback => callback,
  };
  const browserModule = loaded.factory(() => react);
  assert.deepEqual(browserModule.inject, ['slots', 'layout', 'locale']);

  const events = [];
  const ctx = {
    effect(callback) {
      return callback();
    },
    locale: {
      register(namespace, dictionaries) {
        events.push(['locale', namespace, Object.keys(dictionaries).sort()]);
        return () => {};
      },
      bind(namespace) {
        return key => `${namespace}:${key}`;
      },
    },
    slots: {
      inject(name, callback) {
        events.push(['inject', name]);
        return callback();
      },
      register(options) {
        events.push(['register', options.name, options.key ?? options.id]);
        return () => {};
      },
    },
  };
  browserModule.apply(ctx);

  assert.ok(events.some(event => event[0] === 'register' && event[1] === 'main' && event[2] === 'workspace-session-migration'));
  assert.ok(events.some(event => event[0] === 'register' && event[1] === 'sidebar.panellist' && event[2] === 'workspace-session-migration'));
  assert.ok(events.some(event => event[0] === 'locale' && event[1] === '@kazuma-124/dsh-workspace-session-migration' && event[2].join(',') === 'en,zh'));
});
