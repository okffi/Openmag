const listingUrl = 'https://ahm.uva.nl/news-and-events/news/news.html';

module.exports = {
    listSelector: 'article',

    parse: ($, el) => {
        const article = $(el);
        const title = article.find('span').first().text().replace(/\s+/g, ' ').trim();
        const rawLink = article.find('a').first().attr('href');
        if (!title || !rawLink) return null;

        const image = article.find('img.cc').first();
        const imageUrl = [image.attr('src'), image.attr('data-src'), image.attr('data-lazy-src')]
            .find(url => url && !url.startsWith('data:'));
        const resolvedImage = imageUrl ? new URL(imageUrl, listingUrl) : null;
        if (resolvedImage && (resolvedImage.hostname === 'uva.nl' || resolvedImage.hostname.endsWith('.uva.nl'))) {
            resolvedImage.pathname = resolvedImage.pathname.replace(
                /^(\/binaries\/[^/]+\/)150x150-jpg\//,
                (_, prefix) => `${prefix}1024x700-jpg/`
            );
        }
        const dateText = article.find('div.c-listitem__date').first().text().trim();
        const date = dateText ? new Date(dateText) : null;

        return {
            title,
            link: new URL(rawLink, listingUrl).href,
            enforcedImage: resolvedImage ? resolvedImage.href : null,
            content: article.find('div.c-listitem__content').first().text().replace(/\s+/g, ' ').trim(),
            pubDate: date && !isNaN(date.getTime()) ? date.toISOString() : '',
            creator: ''
        };
    }
};
