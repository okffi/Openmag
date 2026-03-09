module.exports = {
    listSelector: '.new-topics .card-list a',

    parse: ($, el) => {
        const title = $(el).find('h4').first().text().trim();
        const link = $(el).attr('href');

        if (!title || !link) return null;

        // Lazy-load image fallback pattern
        const imgEl = $(el).find('img').first();
        let img = imgEl.attr('src')
                 || imgEl.attr('data-src')
                 || imgEl.attr('data-lazy-src')
                 || imgEl.attr('data-original')
                 || null;

        // Discard base64 placeholder images
        if (img && img.startsWith('data:')) img = null;

        const rawDate = $(el).find('.top span.date').first().text().trim();
        const pubDate = parseFinnishDate(rawDate);

        const creator = $(el).find('span.author').first().text().trim();

        const content = $(el).find('.description, p').first().text().trim();

        return {
            title,
            link,
            enforcedImage: img,
            content,
            pubDate,
            creator
        };
    }
};

/**
 * Muuntaa "21.1.2026" -> ISO Date "2026-01-21T12:00:00.000Z"
 */
function parseFinnishDate(str) {
    if (!str) return new Date().toISOString();
    const match = str.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (match) {
        const day = parseInt(match[1], 10);
        const month = parseInt(match[2], 10) - 1;
        const year = parseInt(match[3], 10);
        return new Date(year, month, day, 12, 0, 0).toISOString();
    }
    return new Date().toISOString();
}
