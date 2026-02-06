module.exports = {
    listSelector: 'div.news-item',

    parse: ($, el) => {
        const titleLink = $(el).find('.ni-title a');
        const rawDate = $(el).find('span.ni-date').text().trim(); // Esim. "06 Feb" tai "19 Dec 25"
        
        return {
            title: titleLink.text().trim(),
            link: titleLink.attr('href'),
            enforcedImage: $(el).find('img').attr('src'),
            content: $(el).find('.ni-desc a').text().trim(),
            pubDate: parseScrapedDate(rawDate),
            creator: ""
        };
    }
};

// APUFUNKTIO PÄIVÄMÄÄRÄLLE
function parseScrapedDate(str) {
    if (!str) return new Date().toISOString();

    const parts = str.split(' '); // [ "06", "Feb" ] tai [ "19", "Dec", "25" ]
    const day = parts[0];
    const monthStr = parts[1];
    let year = new Date().getFullYear(); // Oletuksena kuluva vuosi (2026)

    // Jos osia on kolme, viimeinen on vuosi (esim. "25")
    if (parts.length === 3) {
        year = "20" + parts[2]; // Muutetaan "25" -> "2025"
    }

    const months = {
        'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
        'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
    };

    const month = months[monthStr] || 0;
    
    // Luodaan päivämäärä-olio (huom: kuukaudet alkavat nollasta JS:ssä)
    const dateObj = new Date(year, month, day, 12, 0, 0); 
    
    return dateObj.toISOString();
}
