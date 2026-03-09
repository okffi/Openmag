/**
 * SCRAPER RECIPE / TEMPLATE
 * ─────────────────────────
 * Copy this file and rename it to match the domain exactly, e.g. example.com.js
 * The filename MUST match the hostname of the scrapeUrl column in the Google Sheet
 * (minus "www."), because fetch_news.js loads it by domain name.
 *
 * fetch_news.js passes these arguments to parse():
 *   $       – Cheerio instance loaded with the listing page HTML
 *   el      – A single DOM element matching listSelector
 *   axios   – axios instance (only needed for deep-scrape)
 *   cheerio – cheerio module (only needed for deep-scrape)
 *
 * Return object properties (all optional except title + link):
 *   title          {string}  – Article headline. REQUIRED.
 *   link           {string}  – Article URL (absolute or relative). REQUIRED.
 *   enforcedImage  {string|null} – Image URL. null = no image card.
 *   content        {string}  – Short excerpt / description.
 *   pubDate        {string}  – ISO 8601 date string. Falls back to now if missing.
 *   creator        {string}  – Author name (optional).
 *
 * Return null to skip a broken/empty item.
 */

module.exports = {
    // ── 1. LIST SELECTOR ────────────────────────────────────────────────────
    // CSS selector that matches ONE news card/row on the listing page.
    // Inspect the page and find the repeating wrapper element.
    listSelector: 'article.news-card',

    // ── 2. PARSE FUNCTION ───────────────────────────────────────────────────
    // For simple sites: synchronous, no deep-scrape needed.
    // For sites where images/content only exist on the article page: use async + deep-scrape (see below).
    parse: ($, el) => {

        // ── TITLE & LINK ──────────────────────────────────────────────────
        const titleLink = $(el).find('a.article-title, h2 a, h3 a').first();
        const title = titleLink.text().trim();
        const rawLink = titleLink.attr('href') || $(el).find('a').first().attr('href');

        if (!title || !rawLink) return null; // skip empty cards

        // fetch_news.js resolves relative links automatically, but it's safer to
        // make it absolute here if the base domain is known:
        // const link = rawLink.startsWith('http') ? rawLink : new URL(rawLink, 'https://example.com').href;
        const link = rawLink;

        // ── IMAGE ─────────────────────────────────────────────────────────
        // Strategy 1: standard <img src="...">
        // Strategy 2: lazy-loaded <img data-src="..."> (Squarespace, Lazyload.js, etc.)
        // Strategy 3: <img srcset="..."> — pick the first/largest candidate
        // Strategy 4: CSS background-image on a <div> (needs regex, see note below)
        // Strategy 5: null — site has no images in list view → do a deep-scrape

        const imgEl = $(el).find('img').first();
        let img = imgEl.attr('src')           // standard
                 || imgEl.attr('data-src')    // lazy-load (most common fallback!)
                 || imgEl.attr('data-lazy-src') // WP Rocket / LazyLoad plugin
                 || imgEl.attr('data-original') // lazysizes
                 || null;

        // If img is a data: URI (placeholder), discard it
        if (img && img.startsWith('data:')) img = null;

        // If only srcset is available, take the first entry
        if (!img) {
            const srcset = imgEl.attr('srcset') || imgEl.attr('data-srcset');
            if (srcset) {
                img = srcset.trim().split(',')[0].trim().split(/\s+/)[0] || null;
            }
        }

        // NOTE – CSS background-image: if the site uses style="background-image:url(...)"
        // you can extract it like this:
        //   const style = $(el).find('.thumbnail').attr('style') || '';
        //   const match = style.match(/url\(['"]?([^'")\s]+)['"]?\)/);
        //   if (match) img = match[1];

        // ── CONTENT / EXCERPT ─────────────────────────────────────────────
        const content = $(el).find('.excerpt, .summary, .description, p').first().text().trim()
                        || ""; // never undefined

        // ── DATE ──────────────────────────────────────────────────────────
        // Option A: <time datetime="2026-01-21T..."> — already ISO, just use it
        const isoAttr = $(el).find('time').attr('datetime');
        if (isoAttr) {
            return { title, link, enforcedImage: img, content, pubDate: isoAttr, creator: "" };
        }

        // Option B: visible date text — parse it
        const dateRaw = $(el).find('.date, .post-date, .meta-date, time').first().text().trim();
        let pubDate = new Date().toISOString(); // fallback: now

        if (dateRaw) {
            // Works for English formats: "21 January 2026", "Jan 21, 2026", "2026-01-21"
            const parsed = new Date(dateRaw);
            if (!isNaN(parsed.getTime())) {
                pubDate = parsed.toISOString();
            }
            // Finnish DD.MM.YYYY format:
            // const m = dateRaw.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
            // if (m) pubDate = new Date(+m[3], +m[2]-1, +m[1], 12).toISOString();

            // DD/MM/YYYY format (e.g. CoE):
            // const m = dateRaw.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            // if (m) pubDate = `${m[3]}-${m[2]}-${m[1]}T12:00:00.000Z`;
        }

        return {
            title,
            link,
            enforcedImage: img,   // null is fine — article will show without image
            content,
            pubDate,
            creator: ""           // fill in if the site shows an author name
        };
    }

    // ── DEEP-SCRAPE VARIANT ────────────────────────────────────────────────
    // Use this when the listing page doesn't have images or full content.
    // Uncomment and replace the parse above. See ne-mo.org.js for a real example.
    //
    // parse: async ($, el, axios, cheerio) => {
    //     const relativeLink = $(el).find('a').first().attr('href');
    //     if (!relativeLink) return null;
    //     const fullLink = new URL(relativeLink, 'https://example.com').href;
    //
    //     try {
    //         await new Promise(r => setTimeout(r, 300)); // be polite
    //         const { data } = await axios.get(fullLink, { timeout: 10000 });
    //         const $$ = cheerio.load(data);
    //
    //         const title   = $$('h1').first().text().trim();
    //         const img     = $$('article img').first().attr('src')
    //                       || $$('article img').first().attr('data-src')
    //                       || null;
    //         const content = $$('.article-body p').first().text().trim();
    //         const dateRaw = $$('time').attr('datetime') || $$('.publish-date').text().trim();
    //         const pubDate = dateRaw ? new Date(dateRaw).toISOString() : new Date().toISOString();
    //
    //         return { title, link: fullLink, enforcedImage: img, content, pubDate, creator: "" };
    //     } catch (err) {
    //         console.error(`Deep scrape failed for ${fullLink}: ${err.message}`);
    //         return null;
    //     }
    // }
};
