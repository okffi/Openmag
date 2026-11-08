const test = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');
const axios = require('axios');

const {
    extractArticleContent,
    cleanupSnippet,
    cleanupSourceDescription,
    selectScraperFeeds,
    processScraper
} = require('./fetch_news');
const coeScraper = require('./scrapers/coe.int');
const oecdScraper = require('./scrapers/oecd.org');
const puistokatuScraper = require('./scrapers/puistokatu4.fi');
const ahmScraper = require('./scrapers/ahm.uva.nl');

test('scraper sources are selected even when an RSS URL is also configured', () => {
    const feeds = [
        { rssUrl: 'https://example.com/feed', scrapeUrl: 'https://example.com/news' },
        { rssUrl: '', scrapeUrl: 'https://example.org/news' },
        { rssUrl: 'https://example.net/feed', scrapeUrl: '' }
    ];
    assert.deepEqual(selectScraperFeeds(feeds), feeds.slice(0, 2));
});

test('processScraper publishes parsed articles with source metadata', async t => {
    const get = t.mock.method(axios, 'get', async () => ({ data: { items: [
        {
            title: 'Story', url: '/news/story.html', publicationDate: '2026-10-31 17:00:00',
            lead: 'An excerpt.', image: { jpg_1024x700: { url: 'https://www.uva.nl/story.jpg' } }
        },
        { title: 'Second story', url: '/news/second.html', publicationDate: '2026-10-30 00:00:00' },
        { title: 'No date', url: '/news/no-date.html' }
    ] } }));
    const head = t.mock.method(axios, 'head', async () => ({}));
    const feed = {
        scrapeUrl: 'https://ahm.uva.nl/news-and-events/news/news.html',
        rssUrl: 'https://ahm.uva.nl/feed',
        nameChecked: 'AHM', category: 'Culture', sheetDesc: 'Heritage research',
        lang: 'en', scope: 'Europe', isDarkLogo: false
    };
    const articles = [];
    await processScraper(feed, articles);
    assert.equal(articles.length, 2);
    assert.equal(articles[0].title, 'Story');
    assert.equal(articles[0].link, 'https://ahm.uva.nl/news/story.html');
    assert.equal(articles[0].pubDate, '2026-10-31T00:00:00.000Z');
    assert.equal(articles[0].content, 'An excerpt.');
    assert.equal(articles[0].enforcedImage, 'https://www.uva.nl/story.jpg');
    assert.equal(articles[0].sourceTitle, 'AHM');
    assert.equal(articles[0].sheetCategory, 'Culture');
    assert.equal(articles[0].originalRssUrl, feed.rssUrl);
    assert.equal(articles[0].sourceDescription, 'Heritage research');
    assert.equal(articles[0].lang, 'en');
    assert.equal(articles[0].scope, 'Europe');
    assert.equal(head.mock.callCount(), 1);
    assert.match(get.mock.calls[0].arguments[0], /^https:\/\/www\.uva\.nl\/_restapi\/list-json\?/);
});

test('processScraper reports missing rules, empty listings and request failures', async t => {
    await assert.rejects(processScraper({ scrapeUrl: 'https://example.invalid/news' }, []), /No custom scraper/);
    t.mock.method(axios, 'get', async () => ({ data: '<main>No articles</main>' }));
    const feed = { scrapeUrl: 'https://puistokatu4.fi/news', nameChecked: 'Puistokatu' };
    await assert.rejects(processScraper(feed, []), /No valid articles found \(0 elements matched/);
    axios.get.mock.mockImplementation(async () => { throw new Error('HTTP 403'); });
    await assert.rejects(processScraper(feed, []), /HTTP 403/);
});

test('AHM API scraper validates responses, dates and image fallbacks', async () => {
    await assert.rejects(ahmScraper.fetchItems({ get: async () => ({ data: {} }) }, {}), /invalid response/);
    const items = await ahmScraper.fetchItems({ get: async () => ({ data: { items: [
        { title: 'Invalid date', url: '/story', publicationDate: '2026-02-30 12:00:00', image: { imageUrl: 'https://www.uva.nl/original.jpg' } },
        { title: 'Missing image', url: '/story', publicationDate: '2026-11-01 09:00:00' },
        null
    ] } }) }, {});
    assert.equal(items[0].pubDate, '');
    assert.equal(items[0].enforcedImage, 'https://www.uva.nl/original.jpg');
    assert.equal(items[1].pubDate, '2026-11-01T00:00:00.000Z');
    assert.equal(items[1].enforcedImage, null);
    assert.equal(items[2], null);
});

test('AHM scraper extracts news listing fields and resolves relative URLs', () => {
    const $ = cheerio.load(`
        <article>
            <a href="../article/story.html"><span>Collection in Focus: Practical Magic</span></a>
            <div class="c-listitem__date">31 October 2026</div>
            <div class="c-listitem__content">A remarkable
                digitised heritage item.</div>
            <img class="cc" src="/images/story.jpg">
        </article>
    `);
    const item = ahmScraper.parse($, $(ahmScraper.listSelector).get(0));
    assert.deepEqual(item, {
        title: 'Collection in Focus: Practical Magic',
        link: 'https://ahm.uva.nl/news-and-events/article/story.html',
        enforcedImage: 'https://ahm.uva.nl/images/story.jpg',
        content: 'A remarkable digitised heritage item.',
        pubDate: '2026-10-31T00:00:00.000Z',
        creator: ''
    });
});

test('AHM scraper handles missing fields and lazy-loaded images', () => {
    const $ = cheerio.load(`
        <article>
            <a href="/news/story.html"><span>Story</span></a>
            <div class="c-listitem__date">Not a date</div>
            <img class="cc" src="data:image/gif;base64,abc" data-src="images/story.jpg">
        </article>
        <article><a href="/news/no-title.html"></a></article>
        <article><span>No link</span></article>
        <article><a href="/news/no-date.html"><span>No date</span></a></article>
    `);
    const articles = $(ahmScraper.listSelector).get();
    const item = ahmScraper.parse($, articles[0]);
    assert.equal(item.enforcedImage, 'https://ahm.uva.nl/news-and-events/news/images/story.jpg');
    assert.equal(item.content, '');
    assert.equal(item.pubDate, '');
    assert.equal(ahmScraper.parse($, articles[1]), null);
    assert.equal(ahmScraper.parse($, articles[2]), null);
    const noDate = ahmScraper.parse($, articles[3]);
    assert.equal(noDate.pubDate, '');
    assert.equal(noDate.enforcedImage, null);
});

test('AHM scraper upgrades UvA binary thumbnails without changing other image URLs', () => {
    const $ = cheerio.load(`
        <article>
            <a href="/news/story.html"><span>Story</span></a>
            <img class="cc" src="https://www.uva.nl/binaries/_ht_1793364882740/150x150-jpg/content/gallery/subsites/bibliotheek/nieuwsberichten/2026/collectie-in-beeld/10-esoterie/nl-asduva_ph_355-155.jpeg?version=1">
        </article>
        <article>
            <a href="/news/story.html"><span>Story</span></a>
            <img class="cc" data-src="/binaries/_ht_123/150x150-jpg/content/image.jpg">
        </article>
        <article>
            <a href="/news/story.html"><span>Story</span></a>
            <img class="cc" src="https://example.com/binaries/_ht_123/150x150-jpg/content/image.jpg">
        </article>
    `);
    const articles = $(ahmScraper.listSelector).get();
    assert.equal(
        ahmScraper.parse($, articles[0]).enforcedImage,
        'https://www.uva.nl/binaries/_ht_1793364882740/1024x700-jpg/content/gallery/subsites/bibliotheek/nieuwsberichten/2026/collectie-in-beeld/10-esoterie/nl-asduva_ph_355-155.jpeg?version=1'
    );
    assert.equal(
        ahmScraper.parse($, articles[1]).enforcedImage,
        'https://ahm.uva.nl/binaries/_ht_123/1024x700-jpg/content/image.jpg'
    );
    assert.equal(
        ahmScraper.parse($, articles[2]).enforcedImage,
        'https://example.com/binaries/_ht_123/150x150-jpg/content/image.jpg'
    );
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
