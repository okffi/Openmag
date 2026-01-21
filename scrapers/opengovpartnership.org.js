module.exports = {
    domain: "opengovpartnership.org",
    // OGP käyttää .archive-card luokkaa uutisille ja tapahtumille
    listSelector: ".archive-card, .news-item, article", 
    
    parse: ($, el) => {
        // Otsikko ja linkki
        const titleElement = $(el).find('.title a, h3 a').first();
        const title = titleElement.text().trim();
        const link = titleElement.attr('href');
        
        // Kuva: OGP käyttää usein background-imagea tai img-tagia
        let img = $(el).find('img').first().attr('src');
        
        // Tekstikuvaus / Excerpt
        const description = $(el).find('.excerpt, .description, p').first().text().trim();
        
        // Päivämäärä: OGP:n muodossa se on usein "January 21, 2026"
        const dateRaw = $(el).find('.date, .meta-date, .post-date').first().text().trim();
        let isoDate = new Date().toISOString();

        if (dateRaw) {
            const d = new Date(dateRaw);
            if (!isNaN(d.getTime())) {
                isoDate = d.toISOString();
            }
        }
        
        return {
            title: title,
            link: link,
            enforcedImage: img,
            content: description,
            pubDate: isoDate
        };
    }
};
