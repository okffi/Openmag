const axios = require('axios');
const cheerio = require('cheerio');

/const parseEITDate = (dateStr) => {
    // Odotettu muoto: "23 January 2026"
    const months = {
        january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
        july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
    };
    
    const parts = dateStr.trim().toLowerCase().split(/\s+/);
    if (parts.length === 3) {
        const day = parseInt(parts[0]);
        const month = months[parts[1]];
        const year = parseInt(parts[2]);
        return new Date(year, month, day).toISOString();
    }
    return new Date().toISOString(); // Fallback
};

module.exports = {
    domain: "eit-culture-creativity.eu",
    listSelector: "div.news-card",
    parse: async ($, el, axios, cheerio) => {
        // ... (linkin haku) ...
        // Deep scraping osiossa:
        const rawDate = $$('span.eit-news-article-date').text();
        const pubDate = parseEITDate(rawDate);
        
        return {
            title,
            link: absoluteLink,
            enforcedImage: img,
            content,
            pubDate
        };
    }
};
