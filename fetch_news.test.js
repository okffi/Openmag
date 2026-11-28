const test = require('node:test');
const assert = require('node:assert/strict');

const {
    extractArticleContent,
    cleanupSnippet,
    cleanupSourceDescription,
    parseFeedRows,
    validateFeedBundles
} = require('./fetch_news');

test('sheet website URLs are not used to fetch articles and original IDs remain available', () => {
    const feeds = parseFeedRows([
        ['Topic', 'Original', '', '', 'Original', '', 'fi', 'Europe', '', 'root', ''].join('\t'),
        ['Topic', 'Version', 'https://example.com/feed', 'https://example.com/news', 'Version', '', 'en', 'Europe', '', 'child', 'root'].join('\t')
    ]);
    validateFeedBundles(feeds);
    assert.deepEqual(feeds.map(feed => [feed.rssUrl, feed.bundleId]), [
        ['', 'root'],
        ['https://example.com/feed', 'root']
    ]);
    assert.ok(feeds.every(feed => !('scrapeUrl' in feed)));
});

test('extractArticleContent keeps whole paragraphs when truncating HTML and snippets', () => {
    const html = [
        '<div>',
        '<p>First paragraph has enough words to stand on its own.</p>',
        '<p>Second paragraph stays complete too.</p>',
        '<p>Third paragraph should not fit.</p>',
        '</div>'
    ].join('');

    const result = extractArticleContent(html, {
        maxHtmlLength: 90,
        maxSnippetLength: 90
    });

    assert.match(result.content, /<p>First paragraph has enough words to stand on its own\.<\/p>/);
    assert.match(result.content, /<p>Second paragraph stays complete too\.<\/p>/);
    assert.doesNotMatch(result.content, /Third paragraph should not fit/);
    assert.equal(
        result.snippet,
        'First paragraph has enough words to stand on its own.\n\nSecond paragraph stays complete too.'
    );
});

test('extractArticleContent falls back to safe paragraph HTML when feeds have no paragraph markup', () => {
    const html = `<div>${'Word '.repeat(80)}<strong>tail</strong></div>`;
    const result = extractArticleContent(html, {
        maxHtmlLength: 60,
        maxSnippetLength: 60
    });

    assert.match(result.content, /^<p>Word /);
    assert.match(result.content, /<\/p>$/);
    assert.doesNotMatch(result.content, /<strong>/);
    assert.ok(result.snippet.length <= 60);
});

test('cleanupSnippet removes boilerplate and keeps meaningful excerpt text', () => {
    const result = cleanupSnippet(
        'Meaningful opening paragraph.\n\nThe post Example article appeared first on Example Source.',
        { title: 'Example article', maxLength: 200 }
    );
    assert.equal(result, 'Meaningful opening paragraph.');
});

test('cleanupSnippet drops title-like metadata fragments', () => {
    const result = cleanupSnippet(
        'UNPSF Banner admin Tue, 11/29/2022 - 04:28 UNPSF Banner',
        { title: 'UNPSF Banner', maxLength: 200 }
    );
    assert.equal(result, '');
});

test('cleanupSourceDescription suppresses generic and duplicated source descriptions', () => {
    assert.equal(
        cleanupSourceDescription('Latest news from Example Source', { sourceTitle: 'Example Source' }),
        ''
    );
    assert.equal(
        cleanupSourceDescription('Example Source', { sourceTitle: 'Example Source' }),
        ''
    );
    assert.equal(
        cleanupSourceDescription('Independent journalism from around the world', { sourceTitle: 'Example Source' }),
        'Independent journalism from around the world'
    );
});
