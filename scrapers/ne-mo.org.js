module.exports = {
    // Haetaan uutiskortit listasivulta
    listSelector: 'div.news-list-block-item',

    parse: async ($, el, axios, cheerio) => {
        // 1. POIMITAAN LINKKI LISTASTA
        const titleLink = $(el).find('a.darklink').first();
        const relativeLink = titleLink.attr('href');
        if (!relativeLink) return null;
        
        const fullLink = new URL(relativeLink, 'https://www.ne-mo.org/').href;

        try {
            // 2. DEEP SCRAPE: Vieraillaan uutissivulla
            // Lisätään pieni viive (300ms), jotta emme vaikuta hyökkäykseltä
            await new Promise(r => setTimeout(r, 300));
            
            const response = await axios.get(fullLink, { timeout: 10000 });
            const s = cheerio.load(response.data); // 's' viittaa uutissivuun (single page)

            // 3. POIMITAAN TIEDOT UUTISSIVULTA
            const title = s('h1').first().text().trim();
            const description = s('.lead strong').first().text().trim();
            const dateRaw = s('.medium-align-self-bottom p').first().text().trim();
            
            // Haetaan kuva lightbox-linkistä, kuten JSON-ehdotuksessasi oli
            let img = s('a.lightbox').first().attr('href');
            if (img && !img.startsWith('http')) {
                img = new URL(img, 'https://www.ne-mo.org/').href;
            }

            return {
                title: title,
                link: fullLink,
                pubDate: dateRaw ? new Date(dateRaw).toISOString() : new Date().toISOString(),
                content: description || "Lue lisää NEMO:n sivustolta.",
                enforcedImage: img
            };
        } catch (error) {
            console.error(`Deep scrape epäonnistui linkille ${fullLink}:`, error.message);
            return null; // Jos yksittäinen uutinen epäonnistuu, hypätään yli
        }
    }
};
