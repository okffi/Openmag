const test = require('node:test');
const assert = require('node:assert/strict');
const chooseLanguage = require('./language-bundles');
const { validateFeedBundles, attachFeedMetadata, buildSourceData } = require('./fetch_news');

const variants = [
    { lang: 'fi', scope: 'Europe', original: true, count: 1 },
    { lang: 'en', scope: 'Europe', count: 1 },
    { lang: 'sv', scope: 'Europe', count: 1 },
    { lang: 'de', scope: 'Europe', count: 1 }
];
const all = () => true;

test('chooses primary, English, original, then an eligible random language', () => {
    const choose = (primary, allowed, items = variants) =>
        chooseLanguage(items, primary, lang => allowed.includes(lang), all, null, () => 0.9).language;
    assert.equal(choose('sv', ['fi', 'en', 'sv', 'de']), 'sv');
    assert.equal(choose('fr', ['fi', 'en', 'sv', 'de']), 'en');
    assert.equal(choose('fr', ['fi', 'sv', 'de']), 'fi');
    assert.equal(choose('fr', ['sv', 'de']), 'sv');
    assert.equal(choose('fi', ['fi', 'en'], [{ ...variants[0], count: 0 }, variants[1]]), 'en');
    assert.equal(choose('fr', ['fi', 'sv'], [
        { ...variants[0], count: 0 }, { ...variants[0], original: false }, variants[2]
    ]), 'fi');
    assert.equal(choose('fr', []), null);
});

test('random language persists until its eligible language set changes', () => {
    const allowed = lang => ['sv', 'de'].includes(lang);
    const first = chooseLanguage(variants, 'fr', allowed, all, null, () => 0);
    assert.equal(first.language, 'de');
    const second = chooseLanguage(variants, 'fr', allowed, all, first.choice, () => 0.99);
    assert.equal(second.language, 'de');
    const third = chooseLanguage(variants, 'fr', lang => lang === 'sv', all, second.choice, () => 0);
    assert.equal(third.language, 'sv');
});

test('invalid bundle references and duplicate IDs are reported and not linked', t => {
    const warn = t.mock.method(console, 'warn', () => {});
    const feeds = [
        { nameChecked: 'original', feedId: 'root', parentId: '' },
        { nameChecked: 'version', feedId: 'child', parentId: 'root' },
        { nameChecked: 'orphan', feedId: 'orphan', parentId: 'missing' },
        { nameChecked: 'duplicate one', feedId: 'dup', parentId: '' },
        { nameChecked: 'duplicate two', feedId: 'dup', parentId: '' },
        { nameChecked: 'missing', feedId: '', parentId: '' }
    ];
    validateFeedBundles(feeds);
    assert.deepEqual(feeds.map(feed => feed.bundleId), ['root', 'root', 'orphan', '', '', '']);
    assert.equal(warn.mock.callCount(), 4);
});

test('generated bundle data keeps same-named language feeds distinct and restores retained articles', () => {
    const feeds = [
        { feedId: 'original', parentId: '', nameChecked: 'Source', lang: 'fi', scope: 'Europe', category: 'Topic', rssUrl: 'https://example.test/fi' },
        { feedId: 'english', parentId: 'original', nameChecked: 'Source', lang: 'en', scope: 'Europe', category: 'Topic', rssUrl: 'https://example.test/en' },
        { feedId: 'swedish', parentId: 'original', nameChecked: 'Källa', lang: 'sv', scope: 'Europe', category: 'Topic', rssUrl: 'https://example.test/sv' }
    ];
    validateFeedBundles(feeds);
    const articles = [
        { sourceTitle: 'Source', lang: 'fi', originalRssUrl: feeds[0].rssUrl },
        { sourceTitle: 'Source', lang: 'en', originalRssUrl: feeds[1].rssUrl }
    ];
    attachFeedMetadata(articles, feeds);
    assert.deepEqual(articles.map(article => [article.feedId, article.bundleId]),
        [['original', 'original'], ['english', 'original']]);
    const { sourceStats, articlesBySource } = buildSourceData(articles, feeds, new Date('2026-01-01T00:00:00Z'));
    const bundle = sourceStats['bundle:original'];
    assert.equal(bundle.count, 2);
    assert.deepEqual(bundle.variants.map(variant => [variant.id, variant.count, variant.original]),
        [['original', 1, true], ['english', 1, false], ['swedish', 0, false]]);
    assert.deepEqual(articlesBySource[bundle.file.replace('.json', '')], articles);
});
