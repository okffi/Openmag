module.exports = {
    // Käytetään tbody tr -valitsinta jokaiselle riville
    listSelector: 'tbody tr',

    parse: ($, el) => {
        const titleEl = $(el).find('a');
        const dateText = $(el).find('td:nth-of-type(1)').text().trim();
        const desc1 = $(el).find('td:nth-of-type(3)').text().trim();
        const desc2 = $(el).find('.row-fluid span').text().trim();

        // Yhdistetään kuvaukset
        const combinedContent = [desc1, desc2].filter(t => t.length > 0).join(' - ');

        return {
            title: titleEl.text().trim(),
            link: titleEl.attr('href'),
            enforcedImage: null,
            content: combinedContent || "Lausuntopyyntö",
            pubDate: parseFinnishDate(dateText),
            creator: "Lausuntopalvelu.fi"
        };
    }
};

/**
 * Muuntaa "1.2.2026" -> ISO Date "2026-02-01T12:00:00.000Z"
 */
function parseFinnishDate(str) {
    if (!str) return new Date().toISOString();

    // Etsitään numerot pisteellä erotettuna
    const match = str.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (match) {
        const day = parseInt(match[1], 10);
        const month = parseInt(match[2], 10) - 1; // Kuukaudet 0-11
        const year = parseInt(match[3], 10);
        
        // Luodaan pvm klo 12 vakauden vuoksi
        const dateObj = new Date(year, month, day, 12, 0, 0);
        return dateObj.toISOString();
    }
    
    return new Date().toISOString();
}
