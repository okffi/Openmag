const listingUrl = 'https://ahm.uva.nl/news-and-events/news/news.html';
const apiUrl = 'https://www.uva.nl/_restapi/list-json?uuid=0feb95bc-939c-4703-bd2f-499dc48e4caf&mount=8e9742a1-7d3d-4c7a-9254-a66f4298befa';

module.exports = {
    listSelector: 'article',

    fetchItems: async (axios, requestConfig) => {
        const { data } = await axios.get(apiUrl, requestConfig);
        if (!data || !Array.isArray(data.items)) {
            throw new Error('AHM news API returned an invalid response');
        }
        return data.items.slice(0, 10).map(item => {
            if (!item || typeof item.title !== 'string' || typeof item.url !== 'string') return null;
            const dateMatch = typeof item.publicationDate === 'string'
                ? item.publicationDate.match(/^(\d{4}-\d{2}-\d{2})(?:\s|T|$)/)
                : null;
            const date = dateMatch ? new Date(`${dateMatch[1]}T00:00:00.000Z`) : null;
            const pubDate = date && !isNaN(date.getTime()) && date.toISOString().startsWith(dateMatch[1])
                ? date.toISOString() : '';
            return {
                title: item.title.trim(),
                link: item.url.trim(),
                content: typeof item.lead === 'string' ? item.lead : '',
                enforcedImage: item.image?.jpg_1024x700?.url || item.image?.imageUrl || null,
                pubDate,
                creator: ''
            };
        });
    },

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
