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

// FUNKTIO B: Sivun "kaapiminen" (Esim. Europeana Pro)
async function processScraper(feed, allArticles, now) {
    console.log(`Scraping HTML: ${feed.url}`);
    const { data } = await axios.get(feed.url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const $ = cheerio.load(data);
    
    // TÄSSÄ määritellään mistä uutiset löytyvät (yleiset CSS-valitsimet)
    // Voit muokata näitä sivun rakenteen mukaan
    $('article, .news-item, .post').each((i, el) => {
        if (i > 10) return; // Otetaan vain 10 uusinta per sivu
        
        const title = $(el).find('h1, h2, h3, .title').first().text().trim();
        const link = $(el).find('a').first().attr('href');
        const img = $(el).find('img').first().attr('src');
        
        if (title && link) {
            allArticles.push({
                title: title,
                link: link.startsWith('http') ? link : new URL(link, feed.url).href,
                pubDate: now.toISOString(),
                content: "",
                creator: "",
                sourceTitle: new URL(feed.url).hostname,
                sheetCategory: feed.category,
                enforcedImage: img ? (img.startsWith('http') ? img : new URL(img, feed.url).href) : null
            });
        }
    });
}

function extractImageFromContent(item) {
    const searchString = (item.content || "") + (item.contentSnippet || "") + (item['content:encoded'] || "");
    const imgRegex = /<img[^>]+src=["']([^"'>?]+)/i;
    const match = searchString.match(imgRegex);
    return match ? match[1] : null;
}

run();
