module.exports = {
    // JSON: SelectorElement "article" on the search/listing page
    // NOTE: oecd.org robots.txt disallows /search/ — consider using a permitted listing URL instead.
    listSelector: 'article',

    parse: ($, el) => {
        // Title & link — the <a> inside the article card
        const titleLink = $(el).find('a').first();
        const title = titleLink.text().trim();
        const rawLink = titleLink.attr('href');

        if (!title || !rawLink) return null;

        // Resolve relative URLs to absolute
        const link = rawLink.startsWith('http')
            ? rawLink
            : new URL(rawLink, 'https://www.oecd.org').href;

        // Image — OECD search cards rarely have images in list view; keep null
        const imgEl = $(el).find('img').first();
        let img = imgEl.attr('src')
                 || imgEl.attr('data-src')
                 || imgEl.attr('data-lazy-src')
                 || imgEl.attr('data-original')
                 || null;
        if (img && img.startsWith('data:')) img = null;

        // Date — JSON: span.search-result-list-item__date
        // OECD typically uses formats like "9 March 2026" or "09/03/2026"
        const rawDate = $(el).find('span.search-result-list-item__date').first().text().trim();
        const pubDate = parseOecdDate(rawDate);

        // Description — JSON: p
        const content = $(el).find('p').first().text().trim();

        return {
            title,
            link,
            enforcedImage: img,
            content,
            pubDate,
            creator: 'OECD'
        };
    }
};

/**
 * Parse OECD date strings into ISO 8601.
 * Handles:
 *   "9 March 2026"  → standard JS Date parse
 *   "09/03/2026"    → DD/MM/YYYY
 *   "2026-03-09"    → already ISO-like
 */
function parseOecdDate(str) {
    if (!str) return new Date().toISOString();

    // Try DD/MM/YYYY first (European slash format)
    const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
        const day   = parseInt(slashMatch[1], 10);
        const month = parseInt(slashMatch[2], 10) - 1;
        const year  = parseInt(slashMatch[3], 10);
        return new Date(year, month, day, 12, 0, 0).toISOString();
    }

    // Fallback: let JS Date parse it ("9 March 2026", "2026-03-09", etc.)
    const d = new Date(str);
    if (!isNaN(d.getTime())) return d.toISOString();

    return new Date().toISOString();
}
