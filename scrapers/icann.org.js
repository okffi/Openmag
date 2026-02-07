module.exports = {
    // JSON: SelectorElement "li.card"
    listSelector: 'li.card',

    // Funktio, joka purkaa yksittäisen uutisen tiedot
    parse: ($, el) => {
        const titleEl = $(el).find('h3');
        const linkEl = $(el).find('a');
        const rawDate = $(el).find('iti-date-tag').text().trim(); // Esim. "22 December 2025"
        
        return {
            title: titleEl.text().trim(),
            link: linkEl.attr('href'),
            // ICANNin listauksessa ei yleensä ole kuvaa korteissa, jätetään nulliksi
            enforcedImage: null,
            content: "ICANN Announcement", // Tai voit jättää tyhjäksi
            pubDate: parseIcannDate(rawDate),
            creator: "ICANN"
        };
    }
};

/**
 * Muuntaa "22 December 2025" -> ISO Date
 */
function parseIcannDate(str) {
    if (!str) return new Date().toISOString();

    // Paloillaan merkkijono välilyöntien kohdalta: ["22", "December", "2025"]
    const parts = str.split(' ');
    if (parts.length < 3) return new Date().toISOString();

    const day = parseInt(parts[0]);
    const monthStr = parts[1];
    const year = parseInt(parts[2]);

    const months = {
        'January': 0, 'February': 1, 'March': 2, 'April': 3, 'May': 4, 'June': 5,
        'July': 6, 'August': 7, 'September': 8, 'October': 9, 'November': 10, 'December': 11
    };

    const month = months[monthStr] !== undefined ? months[monthStr] : 0;
    
    // Luodaan päivämäärä (klo 12:00 vakauden vuoksi)
    const dateObj = new Date(year, month, day, 12, 0, 0);
    
    return dateObj.toISOString();
}
