module.exports = {
    domain: "eit-culture-creativity.eu",
    // Mitä elementtejä etsitään listalta?
    listSelector: "article, .post, .news-item, .et_pb_post", 
    
    // Miten yksittäinen artikkeli puretaan?
    parse: ($, el) => {
        const title = $(el).find('h2, h1, .entry-title').first().text().trim();
        const link = $(el).find('a').first().attr('href');
        const img = $(el).find('img').first().attr('src');
        
        // EIT-spesifi kuvauksen ja päivämäärän haku
        const description = $(el).find('.post-content, .entry-content, p').first().text().trim();
        const dateRaw = $(el).find('.post-meta, .published').first().text().trim();
        
        return {
            title,
            link,
            enforcedImage: img,
            content: description,
            dateRaw: dateRaw
        };
    }
};
