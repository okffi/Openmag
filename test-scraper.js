const axios = require('axios');
const cheerio = require('cheerio');
const scraper = require('./scrapers/ec.europa.eu.js'); // Vaihda testattava tiedosto tästä

async function test() {
    const url = "https://ec.europa.eu/commission/presscorner/home/en"; // Vaihda testattava URL
    console.log(`Testataan: ${url}...`);

    try {
        const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(data);
        const results = [];

        $(scraper.listSelector).each((i, el) => {
            if (i < 3) { // Testataan vain kolmella ensimmäisellä
                results.push(scraper.parse($, el));
            }
        });

        console.log(JSON.stringify(results, null, 2));
    } catch (e) {
        console.error("Virhe:", e.message);
    }
}

test();
