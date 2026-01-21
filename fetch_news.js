const axios = require('axios');
const fs = require('fs');
const Parser = require('rss-parser');
const cheerio = require('cheerio');
const parser = new Parser({ headers: { 'User-Agent': 'OpenMag-Robot-v1' } });

const SHEET_CSV_URL = process.env.SHEET_CSV_URL || 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRUveH7tPtcCI0gLuCL7krtgpLPPo_nasbZqxioFhftwSrAykn3jOoJVwPzsJnnl5XzcO8HhP7jpk2_/pub?gid=0&single=true&output=csv';

async function run() {
    let failedFeeds = []; 
    try {
        console.log("Fetching Spreadsheet...");
        const response = await axios.get(SHEET_CSV_URL);
        const rows = response.data.split('\n').slice(1);
        
        // 1. Luetaan raakadata
        const rawFeeds = rows.map(row => {
            const cols = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            return { 
                category: cols[0]?.replace(/^"|"$/g, '').trim() || "General",
                rssUrl: cols[2]?.replace(/^"|"$/g, '').trim(), 
                scrapeUrl: cols[3]?.replace(/^"|"$/g, '').trim() 
            };
        });

        // 2. Poistetaan duplikaatit URL-osoitteen perusteella (Estää looppeja)
        const seenUrls = new Set();
        const feeds = rawFeeds.filter(f => {
            const url = (f.rssUrl && f.rssUrl.length > 5) ? f.rssUrl : f.scrapeUrl;
            if (!url || !url.startsWith('http') || seenUrls.has(url)) return false;
            seenUrls.add(url);
            return true;
        });

        console.log(`Found ${feeds.length} unique feeds to process.`);

        let allArticles = [];
        const now = new Date();

        for (const feed of feeds) {
            try {
                // LOGIIKKA: Jos RSS (C) on tyhjä, käytetään Scrapea (D)
                if (feed.rssUrl && feed.rssUrl.length > 5) {
                    console.log(`Processing RSS: ${feed.rssUrl}`);
                    await processRSS(feed, allArticles, now);
                } else if (feed.scrapeUrl) {
                    console.log(`Processing Scrape: ${feed.scrapeUrl}`);
                    await processScraper(feed, allArticles, now);
                }
                
                await new Promise(r => setTimeout(r, 1000)); // Be polite
            } catch (e) {
                const errorMsg = `${feed.category}: ${feed.rssUrl || feed.scrapeUrl} - Virhe: ${e.message}`;
                console.error(errorMsg);
                failedFeeds.push(errorMsg);
            }
        }

        // Lajittelu ja tallennus
        allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
        fs.writeFileSync('data.json', JSON.stringify(allArticles.slice(0, 500), null, 2));
        
        if (failedFeeds.length > 0) {
            fs.writeFileSync('failed_feeds.txt', failedFeeds.join('\n'));
            console.log(`Huom! ${failedFeeds.length} feediä epäonnistui.`);
        }

        console.log("Success! data.json päivitetty.");
    } catch (error) {
        console.error("Kriittinen virhe:", error);
        throw error; // Heitetään virhe eteenpäin .catch-lohkoon
    }
}

async function processRSS(feed, allArticles, now) {
    const feedContent = await parser.parseURL(feed.rssUrl);
    const items = feedContent.items.map(item => {
        let itemDate = new Date(item.pubDate);
        if (isNaN(itemDate.getTime()) || itemDate > now) itemDate = now;

        // VALINTA: Käytetään mieluiten content:encoded -kenttää (täysi teksti),
        // koska 'description' on usein Sitran kaltaisilla sivuilla rikki tai huono.
        const rawContent = item['content:encoded'] || item.content || item.contentSnippet || "";
        
        // PUHDISTUS: Poistetaan HTML-tagit ja turhat välilyönnit/rivinvaihdot
        const cleanContent = rawContent
            .replace(/<[^>]*>/g, ' ') // Poista HTML
            .replace(/\s+/g, ' ')    // Tiivistä välit
            .trim()
            .substring(0, 400);      // Otetaan tarpeeksi pitkä pätkä

        return {
            title: item.title,
            link: item.link,
            pubDate: itemDate.toISOString(),
            content: cleanContent,
            creator: item.creator || item['dc:creator'] || item.author || "",
            sourceTitle: feedContent.title || new URL(feed.rssUrl).hostname,
            sheetCategory: feed.category,
            enforcedImage: item.enclosure?.url || extractImageFromContent(item)
        };
    });
    allArticles.push(...items);
}

const path = require('path');

async function processScraper(feed, allArticles, now) {
    const urlObj = new URL(feed.scrapeUrl);
    const domain = urlObj.hostname.replace('www.', '');
    
    console.log(`Scraping HTML: ${domain}`);

    try {
        const { data } = await axios.get(feed.scrapeUrl, { 
            headers: { 'User-Agent': 'Mozilla/5.0' } 
        });
        const $ = cheerio.load(data);
        
        // Yritetään ladata sivustokohtainen sääntö
        let scraperRule;
        try {
            const rulePath = path.join(__dirname, 'scrapers', `${domain}.js`);
            if (fs.existsSync(rulePath)) {
                scraperRule = require(rulePath);
            }
        } catch (e) {
            console.log(`No specific scraper for ${domain}, using generic.`);
        }

        const selector = scraperRule ? scraperRule.listSelector : '.item-card, .news-item, article, .post';
        
        $(selector).each((i, el) => {
            if (i > 15) return;

            let item;
            if (scraperRule) {
                // Käytetään sivuston omaa logiikkaa
                item = scraperRule.parse($, el);
            } else {
                // Geneerinen logiikka (vanha toteutus)
                item = {
                    title: $(el).find('h2, h3, .title').first().text().trim(),
                    link: $(el).find('a').first().attr('href'),
                    enforcedImage: $(el).find('img').first().attr('src'),
                    content: "Lue lisää sivustolta."
                };
            }

            if (item.title && item.link) {
                const fullLink = item.link.startsWith('http') ? item.link : new URL(item.link, feed.scrapeUrl).href;
                
                allArticles.push({
                    title: item.title,
                    link: fullLink,
                    pubDate: now.toISOString(), // Päivämäärän parsiminen vaatii kirjaston kuten 'dayjs'
                    content: item.content || "",
                    creator: "",
                    sourceTitle: domain,
                    sheetCategory: feed.category,
                    enforcedImage: item.enforcedImage ? (item.enforcedImage.startsWith('http') ? item.enforcedImage : new URL(item.enforcedImage, feed.scrapeUrl).href) : null
                });
            }
        });
    } catch (err) {
        console.error(`Scraper failed for ${domain}: ${err.message}`);
    }
}

function extractImageFromContent(item) {
    const searchString = (item.content || "") + (item['content:encoded'] || "");
    const imgRegex = /<img[^>]+src=["']([^"'>?]+)/i;
    const match = searchString.match(imgRegex);
    return match ? match[1] : null;
}

// Suoritus ja prosessin varma sulkeminen
run().then(() => {
    console.log("Process finished successfully.");
    process.exit(0);
}).catch(err => {
    console.error("Process failed:", err);
    process.exit(1);
});
