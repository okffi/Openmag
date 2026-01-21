module.exports = {
    domain: "coe.int",
    // Poimitaan uutiset uutisvirran listauksesta
    listSelector: ".news-item, .asset-abstract, .p_p_id_com_liferay_asset_publisher_web_portlet_AssetPublisherPortlet_ .h3", 
    
    parse: ($, el) => {
        // Etsitään otsikko ja linkki
        const titleAnchor = $(el).find('h3 a, h2 a, a').first();
        const title = titleAnchor.text().trim();
        const link = titleAnchor.attr('href');
        
        // Kuva: CoE käyttää usein kuvia, jotka ovat linkin sisällä tai erillisenä divinä
        let img = $(el).find('img').first().attr('src');
        
        // Tekstikuvaus (abstract)
        const description = $(el).find('.abstract, .description, p').first().text().trim();
        
        // Päivämäärä: CoE käyttää usein muotoa "Strasbourg, France - 21/01/2026"
        const metaText = $(el).find('.news-date, .date, .metadata').text().trim();
        let isoDate = new Date().toISOString();

        if (metaText) {
            // Etsitään tekstistä päivämäärämuoto DD/MM/YYYY
            const dateMatch = metaText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (dateMatch) {
                isoDate = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}T12:00:00.000Z`;
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
