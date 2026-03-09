module.exports = {
    listSelector: 'div.summary-item',

    parse: ($, el) => {
        const titleLink = $(el).find('a.summary-title-link');
        const rawDate = $(el).find('time').attr('datetime') || '';

        // Squarespace lazy-loads images: real URL may be in data-src, not src
        const imgEl = $(el).find('img').first();
        let img = imgEl.attr('src')
                 || imgEl.attr('data-src')
                 || imgEl.attr('data-image') // Squarespace sometimes uses this
                 || null;

        // Discard base64 placeholder images (common in Squarespace)
        if (img && img.startsWith('data:')) img = null;

        return {
            title: titleLink.text().trim(),
            link: titleLink.attr('href'),
            enforcedImage: img,
            content: $(el).find('p').first().text().trim(),
            pubDate: rawDate ? new Date(rawDate).toISOString() : new Date().toISOString(),
            creator: ""
        };
    }
};
