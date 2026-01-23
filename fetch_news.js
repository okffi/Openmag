const axios = require('axios');
const fs = require('fs');
const path = require('path');
const Parser = require('rss-parser');
const cheerio = require('cheerio');
const parser = new Parser({ 
    headers: { 'User-Agent': 'OpenMag-Robot-v1' },
    customFields: {
        item: [
            ['media:content', 'mediaContent'],
            ['enclosure', 'enclosure']
        ] 
    }
});

const SHEET_CSV_URL = process.env.SHEET_CSV_URL || 'YOUR_PUBLIC_CSV_URL_HERE';

async function run() {
    let failedFeeds = []; 
    try {
        console.log("Fetching Spreadsheet...");
        const response = await axios.get(SHEET_CSV_URL);
        const rows = response.data.split('\n').slice(1);
        
        const rawFeeds = rows.map(row => {
            const cols = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            return { 
                category: cols[0]?.replace(/^"|"$/g, '').trim() || "General",
                rssUrl: cols[2]?.replace(/^"|"$/g, '').trim(), 
                scrapeUrl: cols[3]?.replace(/^"|"$/g, '').trim() 
            };
        });

        const seenUrls = new Set();
        const feeds = rawFeeds.filter(f => {
            const url = (f.rssUrl && f.rssUrl.length > 5) ? f.rssUrl : f.scrapeUrl;
            if (!url || !url.startsWith('http') || seenUrls.has(url)) return false;
            seenUrls.add(url);
            return true;
        });

        let allArticles = [];
        const now = new Date();

        for (const feed of feeds) {
            try {
                if (feed.rssUrl && feed.rssUrl.length > 5) {
                    await processRSS(feed, allArticles, now);
                } else if (feed.scrapeUrl) {
                    await processScraper(feed, allArticles, now);
                }
                await new Promise(r => setTimeout(r, 500));
            } catch (e) {
                failedFeeds.push(`${feed.category}: ${feed.rssUrl || feed.scrapeUrl} - ${e.message}`);
            }
        }

        allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

        // 1. TALLENNUS: Päävirta (500 uusinta)
        fs.writeFileSync('data.json', JSON.stringify(allArticles.slice(0, 500), null, 2));

        // 2. TALLENNUS: Lähteet omiin tiedostoihinsa
        const sourcesDir = path.join(__dirname, 'sources');
        if (!fs.existsSync(sourcesDir)) fs.mkdirSync(sourcesDir);

        const sourceStats = {};
        const articlesBySource = {};

        allArticles.forEach(art => {
            const src = art.sourceTitle || "Muu";
            const fileKey = src.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            if (!articlesBySource[fileKey]) articlesBySource[fileKey] = [];
            articlesBySource[fileKey].push(art);
            
            if (!sourceStats[src]) sourceStats[src] = { file: `${fileKey}.json`, count: 0 };
            sourceStats[src].count++;
        });

        Object.keys(articlesBySource).forEach(key => {
            fs.writeFileSync(path.join(sourcesDir, `${key}.json`), JSON.stringify(articlesBySource[key].slice(0, 100), null, 2));
        });

        fs.writeFileSync('stats.json', JSON.stringify(sourceStats, null, 2));
        if (failedFeeds.length > 0) fs.writeFileSync('failed_feeds.txt', failedFeeds.join('\n'));

        console.log(`Valmis! ${allArticles.length} artikkelia prosessoitu.`);
    } catch (error) {
        console.error("Kriittinen virhe:", error);
        process.exit(1);
    }
}

async function processRSS(feed, allArticles, now) {
    const feedContent = await parser.parseURL(feed.rssUrl);
    const items = feedContent.items.map(item => {
        let itemDate = new Date(item.pubDate || item.isoDate);
        if (isNaN(itemDate.getTime()) || itemDate > now) itemDate = now;

        let img = null;
        if (item.enclosure && item.enclosure.url) img = item.enclosure.url;
        else if (item.mediaContent && item.mediaContent.$) img = item.mediaContent.$.url;
        if (!img) img = extractImageFromContent(item);

        return {
            title: item.title,
            link: item.link,
            pubDate: itemDate.toISOString(),
            content: (item.contentSnippet || item.summary || "").substring(0, 400),
            creator: item.creator || item.author || "",
            sourceTitle: feedContent.title || new URL(feed.rssUrl).hostname,
            sheetCategory: feed.category,
            enforcedImage: img
        };
    });
    allArticles.push(...items);
}

async function processScraper(feed, allArticles, now) {
    // Scraper logiikka pysyy samana kuin versiossasi
}

function extractImageFromContent(item) {
    const searchString = (item['content:encoded'] || "") + (item.content || "") + (item.description || "");
    const imgRegex = /<img[^>]+src=["']([^"'>?]+)/gi;
    let match = imgRegex.exec(searchString);
    return match ? match[1] : null;
}

run();
