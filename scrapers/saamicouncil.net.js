module.exports = {
    listSelector: 'div.summary-item',

    parse: ($, el) => {
        const titleLink = $(el).find('a.summary-title-link');
        const rawDate = $(el).find('time').attr('datetime') || '';

        return {
            title: titleLink.text().trim(),
            link: titleLink.attr('href'),
            enforcedImage: $(el).find('img').attr('src'),
            content: $(el).find('p').first().text().trim(),
            pubDate: rawDate ? new Date(rawDate).toISOString() : new Date().toISOString(),
            creator: ""
        };
    }
};
