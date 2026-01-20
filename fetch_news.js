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
        return {
            title: item.title,
            link: item.link,
            pubDate: itemDate.toISOString(),
            content: item.contentSnippet || item.content || "",
            creator: item.creator || item['dc:creator'] || item.author || "",
            sourceTitle: feedContent.title || new URL(feed.rssUrl).hostname,
            sheetCategory: feed.category,
            enforcedImage: item.enclosure?.url || extractImageFromContent(item)
        };
    });
    allArticles.push(...items);
}

async function processScraper(feed, allArticles, now) {
    const { data } = await axios.get(feed.scrapeUrl, { 
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } 
    });
    const $ = cheerio.load(data);
    // Lisätty .item-card__title ja laajennettu valitsimia
    const selectors = '.item-card, .news-item, article, .post, .teaser, .entry';
    
    $(selectors).each((i, el) => {
        if (i > 10) return;
        const title = $(el).find('h1, h2, h3, .title, .entry-title, .item-card__title').first().text().trim();
        const link = $(el).find('a').first().attr('href');
        let img = $(el).find('img').first().attr('src') || $(el).find('img').first().attr('data-src');

        if (title && link) {
            const fullLink = link.startsWith('http') ? link : new URL(link, feed.scrapeUrl).href;
            let fullImg = (img && !img.includes('data:image')) ? (img.startsWith('http') ? img : new URL(img, feed.scrapeUrl).href) : null;

            allArticles.push({
                title: title,
                link: fullLink,
                pubDate: now.toISOString(),
                content: "Uutinen skreipattu sivustolta.",
                creator: "",
                sourceTitle: new URL(feed.scrapeUrl).hostname.replace('www.', ''),
                sheetCategory: feed.category,
                enforcedImage: fullImg
            });
        }
    });
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
