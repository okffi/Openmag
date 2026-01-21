module.exports = {
    domain: "ec.europa.eu",
    // Komissio käyttää .ecl-list-item luokkaa uutislistauksissaan
    listSelector: ".ecl-list-item, .ecl-u-type-paragraph, article", 
    
    parse: ($, el) => {
        const titleElement = $(el).find('.ecl-link--standalone, .ecl-list-item__title a').first();
        const title = titleElement.text().trim();
        const link = titleElement.attr('href');
        
        // Komission uutislistassa ei aina ole kuvia, mutta haetaan jos löytyy
        let img = $(el).find('img').first().attr('src');
        
        // Excerpt / Kuvaus
        const description = $(el).find('.ecl-list-item__description, p').first().text().trim();
        
        // Päivämäärän haku: Komissio käyttää usein muotoa "21 January 2026"
        const dateRaw = $(el).find('.ecl-list-item__detail, .ecl-meta-item').first().text().trim();
        let isoDate = new Date().toISOString();

        if (dateRaw) {
            const d = new Date(dateRaw);
            if (!isNaN(d.getTime())) {
                isoDate = d.toISOString();
            }
        }
        
        return {
            title,
            link,
            enforcedImage: img,
            content: description,
            pubDate: isoDate
        };
    }
};
