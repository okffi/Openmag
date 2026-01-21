module.exports = {
    domain: "puistokatu4.fi",
    // Sivusto käyttää tyypillisesti "post-item" tai "card" -tyyppisiä rakenteita
    listSelector: ".post-item, .card, article", 
    
    parse: ($, el) => {
        const title = $(el).find('h2, h3, .title').first().text().trim();
        const link = $(el).find('a').first().attr('href');
        
        // Kuvat: Puistokatu käyttää usein kuvaa taustana tai img-tagissa
        let img = $(el).find('img').first().attr('src');
        
        // Tekstikuvaus (excerpt)
        const description = $(el).find('.excerpt, p, .description').first().text().trim();
        
        // Päivämäärä (jos saatavilla kortissa)
        const dateRaw = $(el).find('.date, .published, time').first().text().trim();
        let isoDate = new Date().toISOString();

        if (dateRaw) {
            // Suomalainen päivämäärämuoto "20.1.2026" muunnetaan ISO-muotoon
            const parts = dateRaw.split('.');
            if (parts.length === 3) {
                const d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
                if (!isNaN(d.getTime())) isoDate = d.toISOString();
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
