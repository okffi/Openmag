module.exports = {
    domain: "puistokatu4.fi",
    // Käytetään JSON-datasi tarkempaa valitsinta
    listSelector: ".posts-small-list div.post, article.post", 
    
    parse: ($, el) => {
        const titleAnchor = $(el).find('.title a, h2 a, h3 a').first();
        const title = titleAnchor.text().trim();
        const link = titleAnchor.attr('href');
        
        // Kuva kortista
        const img = $(el).find('img').first().attr('src');
        
        // Päivämäärä (JSON: div.date)
        const dateRaw = $(el).find('div.date, .date').first().text().trim();
        
        // Kirjoittaja (JSON: .post-author__info span)
        // POISTETAAN "Kirjoittanut: " teksti
        let author = $(el).find('.post-author__info span, .author').first().text().trim();
        author = author.replace(/Kirjoittanut:\s*/i, ''); 

        // Kuvaus
        const description = $(el).find('.excerpt p, p').first().text().trim();
        
        let isoDate = new Date().toISOString();
        if (dateRaw) {
            // Suomalainen muoto (esim 21.1.2026) -> ISO
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
            creator: author, // Nyt ilman "Kirjoittanut:" -etuliitettä
            pubDate: isoDate
        };
    }
};
