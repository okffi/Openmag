const axios = require('axios');
const fs = require('fs');
const Parser = require('rss-parser');
const cheerio = require('cheerio'); // Uusi työkalu
const parser = new Parser({ headers: { 'User-Agent': 'OpenMag-Robot-v1' } });

const SHEET_CSV_URL = process.env.SHEET_CSV_URL || 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRUveH7tPtcCI0gLuCL7krtgpLPPo_nasbZqxioFhftwSrAykn3jOoJVwPzsJnnl5XzcO8HhP7jpk2_/pub?gid=0&single=true&output=csv';

async function run() {
    try {
        const response = await axios.get(SHEET_CSV_URL);
        const rows = response.data.split('\n').slice(1);
        const feeds = rows.map(row => {
            const cols = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            return { 
                category: cols[0]?.replace(/^"|"$/g, '').trim() || "General",
                url: cols[2]?.replace(/^"|"$/g, '').trim() 
            };
        }).filter(f => f.url && f.url.startsWith('http'));

        let allArticles = [];
        const now = new Date();

        for (const feed of feeds) {
            try {
                // TARKISTUS: Onko kyseessä RSS vai tavallinen sivu?
                const isRSS = feed.url.includes('rss') || feed.url.includes('.xml') || feed.url.includes('feed');
                
                if (isRSS) {
                    await processRSS(feed, allArticles, now);
                } else {
                    await processScraper(feed, allArticles, now);
                }
                
                await new Promise(r => setTimeout(r, 1000));
            } catch (e) {
                console.error(`Skipped ${feed.url}: ${e.message}`);
            }
        }

        allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
        fs.writeFileSync('data.json', JSON.stringify(allArticles.slice(0, 500), null, 2));
        console.log("Success!");
    } catch (error) {
        console.error("Critical Failure:", error);
    }
}

// FUNKTIO A: Tavallinen RSS-luku
async function processRSS(feed, allArticles, now) {
    const feedContent = await parser.parseURL(feed.url);
    const items = feedContent.items.map(item => {
        let itemDate = new Date(item.pubDate);
        if (isNaN(itemDate.getTime()) || itemDate > now) itemDate = now;
        return {
            title: item.title,
            link: item.link,
            pubDate: itemDate.toISOString(),
            content: item.contentSnippet || item.content || "",
            creator: item.creator || item['dc:creator'] || item.author || "",
            sourceTitle: feedContent.title,
            sheetCategory: feed.category,
            enforcedImage: item.enclosure?.url || extractImageFromContent(item)
        };
    });
    allArticles.push(...items);
}

async function processScraper(feed, allArticles, now) {
    console.log(`Scraping HTML: ${feed.url}`);
    try {
        const { data } = await axios.get(feed.url, { 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
            } 
        });
        const $ = cheerio.load(data);
        
        // Luodaan lista mahdollisista "uutislaatikoista" eri sivustoilla
        // Europeana käyttää: .item-card tai .news-item
        const selectors = '.item-card, .news-item, article, .post, .teaser';
        
        $(selectors).each((i, el) => {
            if (i > 15) return; // Rajoitetaan määrää

            // Europeana Pro spesifit haut
            const title = $(el).find('h2, h3, .title, .item-card__title').first().text().trim();
            const link = $(el).find('a').first().attr('href');
            
            // Kuvan haku: etsitään src tai data-src (lazy loading)
            let img = $(el).find('img').first().attr('src') || $(el).find('img').first().attr('data-src');

            if (title && link) {
                // Siivotaan linkki (muutetaan suhteellinen linkki täydeksi osoitteeksi)
                const fullLink = link.startsWith('http') ? link : new URL(link, feed.url).href;
                
                // Siivotaan kuva
                let fullImg = null;
                if (img && !img.includes('data:image')) {
                    fullImg = img.startsWith('http') ? img : new URL(img, feed.url).href;
                }

                allArticles.push({
                    title: title,
                    link: fullLink,
                    pubDate: now.toISOString(),
                    content: "Lue lisää alkuperäisestä lähteestä.",
                    creator: "",
                    sourceTitle: new URL(feed.url).hostname.replace('www.', ''),
                    sheetCategory: feed.category,
                    enforcedImage: fullImg
                });
            }
        });
    } catch (err) {
        console.error(`Scraper failed for ${feed.url}: ${err.message}`);
    }
}

function extractImageFromContent(item) {
    const searchString = (item.content || "") + (item.contentSnippet || "") + (item['content:encoded'] || "");
    const imgRegex = /<img[^>]+src=["']([^"'>?]+)/i;
    const match = searchString.match(imgRegex);
    return match ? match[1] : null;
}

run();
