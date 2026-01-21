module.exports = {
    domain: "eit-culture-creativity.eu",
    listSelector: "article.et_pb_post, .et_pb_blog_grid .entry-container", 
    
    parse: ($, el) => {
        const title = $(el).find('.entry-title, h2').first().text().trim();
        const link = $(el).find('a').first().attr('href');
        const img = $(el).find('img').first().attr('src');
        
        // BETTER EXCERPT SEARCH: 
        // 1. Try Divi's specific post content
        // 2. Try the general entry-content
        // 3. Fallback to the first p tag found
        let description = $(el).find('.post-content p, .entry-content p, .post-excerpt, p').first().text().trim();
        
        // If the description is still empty, grab the first div that looks like a summary
        if (!description) {
            description = $(el).find('.post-content, .entry-content').first().text().trim().substring(0, 200);
        }

        // DATE HANDLING (Remains the same as before)
        const dateRaw = $(el).find('.post-meta, .published').first().text().trim();
        let isoDate = new Date().toISOString();

        if (dateRaw) {
            const months = {
                january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
                july: '07', august: '08', september: '09', october: '10', november: '11', december: '12'
            };
            
            const parts = dateRaw.toLowerCase().replace(',', '').split(' ');
            if (parts.length >= 3) {
                const month = months[parts[0]];
                const day = parts[1].padStart(2, '0');
                const year = parts[2];
                if (month && day && year) {
                    isoDate = `${year}-${month}-${day}T12:00:00.000Z`;
                }
            }
        }
        
        return {
            title,
            link,
            enforcedImage: img,
            content: description, // This is now more robust!
            pubDate: isoDate
        };
    }
};
