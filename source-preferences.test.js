const test = require('node:test');
const assert = require('node:assert/strict');
const createSourcePreferences = require('./source-preferences');

function memoryStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem: key => values.has(key) ? values.get(key) : null,
        setItem: (key, value) => values.set(key, value)
    };
}

test('source choices persist and new sources default to enabled', () => {
    const storage = memoryStorage();
    const preferences = createSourcePreferences(storage);
    preferences.reload();
    preferences.setEnabled(['one', 'two'], false);

    const nextSession = createSourcePreferences(storage);
    nextSession.reload();
    assert.equal(nextSession.isEnabled('one'), false);
    assert.equal(nextSession.isEnabled('new source'), true);
    nextSession.setEnabled(['one', 'two'], true);
    assert.equal(nextSession.isEnabled('one'), true);
    assert.equal(nextSession.isEnabled('two'), true);
});

test('bulk changes preserve choices for other sources', () => {
    const preferences = createSourcePreferences(memoryStorage());
    preferences.reload();
    preferences.setEnabled(['outside'], false);
    preferences.setEnabled(['one', 'two'], false);
    preferences.setEnabled(['one', 'two'], true);
    assert.equal(preferences.isEnabled('outside'), false);
});

test('failed writes do not change in-memory choices', () => {
    const storage = memoryStorage();
    const preferences = createSourcePreferences(storage);
    preferences.reload();
    storage.setItem = () => { throw new Error('storage unavailable'); };
    assert.throws(() => preferences.setEnabled(['one'], false), /storage unavailable/);
    assert.equal(preferences.isEnabled('one'), true);
});

test('malformed preferences are rejected', () => {
    for (const value of ['not json', '{}', '["one", 3]']) {
        const preferences = createSourcePreferences(memoryStorage({ openmag_disabled_sources: value }));
        assert.throws(() => preferences.reload());
    }
});
