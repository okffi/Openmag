module.exports = {
    domain: "eit-culture-creativity.eu",
    listSelector: "div.news-card", 
    
    parse: ($, el) => {
        // Otsikko ja Linkki
        const titleAnchor = $(el).find('.title a, h3 a').first();
        const title = titleAnchor.text().trim();
        const link = titleAnchor.attr('href');
        
        // Kuva
        const img = $(el).find('img').first().attr('src');
        
        // Kuvaus / Excerpt
        const description = $(el).find('p, .description, .excerpt').first().text().trim();
        
        // Päivämäärä: Käytetään oletuksena ajohetkeä, jos sitä ei kortista löydy.
        // Tämä pitää uutiset tuoreina OpenMagissa.
        const isoDate = new Date().toISOString();

        return {
            title,
            link,
            enforcedImage: img,
            content: description,
            pubDate: isoDate
        };
    }
};
