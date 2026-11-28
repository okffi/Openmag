(function (root) {
    function chooseLanguages(variants, primary, matchesLanguage, matchesLocation, previous, random = Math.random) {
        const eligible = variants.filter(variant =>
            variant.count > 0 && matchesLanguage(variant.lang) && matchesLocation(variant.scope)
        );
        if (!eligible.length) return { language: null, choice: previous };
        const languages = [...new Set(eligible.map(variant => variant.lang))];
        if (languages.includes(primary)) return { language: primary, choice: previous };
        if (languages.includes('en')) return { language: 'en', choice: previous };
        const original = variants.find(variant => variant.original);
        if (original && languages.includes(original.lang)) return { language: original.lang, choice: previous };

        const candidates = languages.slice().sort();
        const signature = JSON.stringify(candidates);
        const language = previous && previous.signature === signature && candidates.includes(previous.language)
            ? previous.language : candidates[Math.floor(random() * candidates.length)];
        return { language, choice: { signature, language } };
    }

    if (typeof module !== 'undefined' && module.exports) module.exports = chooseLanguages;
    else root.chooseBundleLanguage = chooseLanguages;
})(typeof window !== 'undefined' ? window : globalThis);
