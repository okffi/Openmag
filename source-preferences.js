(function (root) {
    const STORAGE_KEY = 'openmag_disabled_sources';

    function createSourcePreferences(storage) {
        let disabled = new Set();

        function reload() {
            const value = storage.getItem(STORAGE_KEY);
            const names = value === null ? [] : JSON.parse(value);
            if (!Array.isArray(names) || names.some(name => typeof name !== 'string')) {
                throw new Error('Invalid source preferences');
            }
            disabled = new Set(names);
        }

        function setEnabled(names, enabled) {
            const next = new Set(disabled);
            names.forEach(name => enabled ? next.delete(name) : next.add(name));
            storage.setItem(STORAGE_KEY, JSON.stringify([...next]));
            disabled = next;
        }

        return {
            reload,
            setEnabled,
            isEnabled: name => !disabled.has(name),
            storageKey: STORAGE_KEY
        };
    }

    if (typeof module !== 'undefined' && module.exports) module.exports = createSourcePreferences;
    else root.createSourcePreferences = createSourcePreferences;
})(typeof window !== 'undefined' ? window : globalThis);
