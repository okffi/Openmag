const test = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');

const {
    extractArticleContent,
    cleanupSnippet,
    cleanupSourceDescription
} = require('./fetch_news');
const coeScraper = require('./scrapers/coe.int');
const oecdScraper = require('./scrapers/oecd.org');
const puistokatuScraper = require('./scrapers/puistokatu4.fi');

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

test('custom scrapers keep multiple description paragraphs when available', () => {
    {
        const $ = cheerio.load(`
            <article class="news-item">
                <h3><a href="/coe-story">Council story</a></h3>
                <div class="abstract">
                    <p>First abstract paragraph.</p>
                    <p>Second abstract paragraph.</p>
                </div>
            </article>
        `);
        const item = coeScraper.parse($, $('.news-item').get(0));
        assert.equal(item.content, 'First abstract paragraph.\n\nSecond abstract paragraph.');
    }

    {
        const $ = cheerio.load(`
            <article>
                <a href="/oecd-story">OECD story</a>
                <span class="search-result-list-item__date">9 March 2026</span>
                <p>First OECD paragraph.</p>
                <p>Second OECD paragraph.</p>
            </article>
        `);
        const item = oecdScraper.parse($, $('article').get(0));
        assert.equal(item.content, 'First OECD paragraph.\n\nSecond OECD paragraph.');
    }

    {
        const $ = cheerio.load(`
            <article class="post">
                <h2 class="title"><a href="/puisto-story">Puisto story</a></h2>
                <div class="date">21.1.2026</div>
                <div class="post-author__info"><span>Kirjoittanut: Testaaja</span></div>
                <div class="excerpt">
                    <p>First excerpt paragraph.</p>
                    <p>Second excerpt paragraph.</p>
                </div>
            </article>
        `);
        const item = puistokatuScraper.parse($, $('article.post').get(0));
        assert.equal(item.content, 'First excerpt paragraph.\n\nSecond excerpt paragraph.');
        assert.equal(item.creator, 'Testaaja');
    }
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
