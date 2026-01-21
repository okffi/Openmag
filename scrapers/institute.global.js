module.exports = {
    domain: "institute.global",
    // Sivusto käyttää tyypillisesti tällaisia luokkia listoissa
    listSelector: ".content-card, .card, article", 
    
    parse: ($, el) => {
        const title = $(el).find('h3, h2, .title').first().text().trim();
        const link = $(el).find('a').first().attr('href');
        
        // Kuvien haku: He käyttävät usein data-src tai srcset-muotoja
        let img = $(el).find('img').first().attr('src') || $(el).find('img').first().attr('data-src');
        
        // Tekstikuvaus (excerpt)
        const description = $(el).find('.summary, .description, p').first().text().trim();
        
        // Päivämäärän haku
        const dateRaw = $(el).find('.date, time').first().text().trim();
        let isoDate = new Date().toISOString();

        if (dateRaw) {
            // Yritetään muuttaa "20 Jan 2026" tai vastaava muotoon
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
