const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function test(url) {
    try {
        const urlObj = new URL(url);
        // Poistetaan 'www.' ja varmistetaan pienet kirjaimet
        const domain = urlObj.hostname.replace('www.', '').toLowerCase();
        
        console.log(`\n--- [ DEBUG ] ---`);
        console.log(`Target URL: ${url}`);
        console.log(`Target Domain: ${domain}`);

        // Määritetään polku sääntötiedostoon
        const ruleFilename = `${domain}.js`;
        const rulePath = path.resolve(__dirname, 'scrapers', ruleFilename);
        
        console.log(`Looking for rule at: ${rulePath}`);

        const { data } = await axios.get(url, { 
            headers: { 'User-Agent': 'Mozilla/5.0' } 
        });
        const $ = cheerio.load(data);
        
        let scraperRule = null;

        if (fs.existsSync(rulePath)) {
            console.log(`✅ FOUND rule file. Clearing cache and loading fresh...`);
            
            // PAKOTETTU VÄLIMUISTIN TYHJENNYS
            delete require.cache[require.resolve(rulePath)];
            scraperRule = require(rulePath);
        } else {
            console.log(`⚠️  NOT FOUND: No file named "${ruleFilename}" in scrapers/ folder.`);
            console.log(`Available files in scrapers/: ${fs.readdirSync(path.join(__dirname, 'scrapers')).join(', ')}`);
        }

        const selector = scraperRule ? scraperRule.listSelector : '.item-card, .news-item, article, .post';
        console.log(`🔍 Using selector: "${selector}"`);

        const results = [];
        $(selector).each((i, el) => {
            if (i < 3) {
                if (scraperRule) {
                    results.push(scraperRule.parse($, el));
                } else {
                    results.push({
                        title: $(el).find('h1, h2, h3').first().text().trim(),
                        link: $(el).find('a').first().attr('href'),
                        note: "Using generic parser"
                    });
                }
            }
        });

        console.log(`\n--- [ RESULTS ] ---`);
        if (results.length === 0) {
            console.log("❌ No items found. Check the listSelector!");
        } else {
            console.log(JSON.stringify(results, null, 2));
        }

    } catch (e) {
        console.error("❌ Error:", e.message);
    } finally {
        askUrl();
    }
}

function askUrl() {
    rl.question('\nPaste URL to test (or type "exit"): ', (answer) => {
        if (!answer || answer.toLowerCase() === 'exit') {
            rl.close();
        } else {
            test(answer.trim());
        }
    });
}

console.log("Scraper Test Tool Started.");
askUrl();
