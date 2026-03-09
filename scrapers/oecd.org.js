module.exports = {
    // JSON: SelectorElement "div.card---theme" (note triple dash in class name)
    listSelector: 'div.card---theme',

    parse: ($, el) => {
        const titleEl = $(el).find('a').first();
        const title = titleEl.text().trim();
        const rawLink = titleEl.attr('href');

        if (!title || !rawLink) return null;

        const link = new URL(rawLink, 'https://www.oecd.org').href;

        // Lazy-load image fallback pattern
        const imgEl = $(el).find('img').first();
        let img = imgEl.attr('src')
                 || imgEl.attr('data-src')
                 || imgEl.attr('data-lazy-src')
                 || imgEl.attr('data-original')
                 || null;

        // Discard base64 placeholder images
        if (img && img.startsWith('data:')) img = null;

        const rawDate = $(el).find('.card__date').first().text().trim();
        const pubDate = parseOecdDate(rawDate);

        return {
            title,
            link,
            enforcedImage: img,
            content: '',
            pubDate,
            creator: 'OECD'
        };
    }
};

function parseOecdDate(str) {
    if (!str) return new Date().toISOString();

    // Try DD/MM/YYYY (European slash format)
    const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
        const day   = parseInt(slashMatch[1], 10);
        const month = parseInt(slashMatch[2], 10) - 1;
        const year  = parseInt(slashMatch[3], 10);
        return new Date(Date.UTC(year, month, day, 12, 0, 0)).toISOString();
    }

    // Fallback: JS Date parse ("9 March 2026", "2026-03-09", etc.)
    const d = new Date(str);
    if (!isNaN(d.getTime())) return d.toISOString();

    return new Date().toISOString();
}
