const axios = require('axios');
const fs = require('fs');
const path = require('path');
const Parser = require('rss-parser');
const cheerio = require('cheerio');
const parser = new Parser({ 
    headers: { 'User-Agent': 'OpenMag-Robot-v1' },
    customFields: {
        item: [['media:content', 'mediaContent']] // Mahdollistaa media-tagien lukemisen
    }
});

const SHEET_CSV_URL = process.env.SHEET_CSV_URL || 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRUveH7tPtcCI0gLuCL7krtgpLPPo_nasbZqxioFhftwSrAykn3jOoJVwPzsJnnl5XzcO8HhP7jpk2_/pub?gid=0&single=true&output=csv';

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

        console.log(`Found ${feeds.length} unique feeds to process.`);

        let allArticles = [];
        const now = new Date();

        for (const feed of feeds) {
            try {
                if (feed.rssUrl && feed.rssUrl.length > 5) {
                    console.log(`Processing RSS: ${feed.rssUrl}`);
                    await processRSS(feed, allArticles, now);
                } else if (feed.scrapeUrl) {
                    console.log(`Processing Scrape: ${feed.scrapeUrl}`);
                    await processScraper(feed, allArticles, now);
                }
                await new Promise(r => setTimeout(r, 1000));
            } catch (e) {
                const errorMsg = `${feed.category}: ${feed.rssUrl || feed.scrapeUrl} - Virhe: ${e.message}`;
                console.error(errorMsg);
                failedFeeds.push(errorMsg);
            }
        }

        // 1. Lajittelu ajan mukaan
        allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

        // 2. TILASTOJEN LASKENTA
        const stats = {};
        allArticles.forEach(art => {
            const src = art.sourceTitle;
            if (!stats[src]) {
                stats[src] = { 
                    articleCount: 0, 
                    latestPost: art.pubDate,
                    oldestPost: art.pubDate,
                    category: art.sheetCategory
                };
            }
            stats[src].articleCount++;
            
            const artDate = new Date(art.pubDate);
            if (artDate > new Date(stats[src].latestPost)) stats[src].latestPost = art.pubDate;
            if (artDate < new Date(stats[src].oldestPost)) stats[src].oldestPost = art.pubDate;
        });

        // Lasketaan analyyttiset arvot
        Object.keys(stats).forEach(src => {
            const s = stats[src];
            const diffMs = Math.max(1000, new Date(s.latestPost) - new Date(s.oldestPost));
            const diffDays = diffMs / (1000 * 60 * 60 * 24);
            
            s.postsPerDay = diffDays > 0 ? (s.articleCount / diffDays).toFixed(2) : s.articleCount.toFixed(2);
            s.hoursSinceLastPost = Math.floor((new Date() - new Date(s.latestPost)) / (1000 * 60 * 60));
        });

        // 3. TALLENNUS
        fs.writeFileSync('data.json', JSON.stringify(allArticles.slice(0, 500), null, 2));
        fs.writeFileSync('stats.json', JSON.stringify(stats, null, 2));
        
        if (failedFeeds.length > 0) {
            fs.writeFileSync('failed_feeds.txt', failedFeeds.join('\n'));
            console.log(`Huom! ${failedFeeds.length} feediä epäonnistui.`);
        }

        console.log("Success! data.json ja stats.json päivitetty.");
    } catch (error) {
        console.error("Kriittinen virhe:", error);
        process.exit(1);
    }
}

async function processRSS(feed, allArticles, now) {
    const feedContent = await parser.parseURL(feed.rssUrl);
    const items = feedContent.items.map(item => {
        let itemDate = new Date(item.pubDate);
        if (isNaN(itemDate.getTime()) || itemDate > now) itemDate = now;

        const candidates = [
            item['content:encoded'],
            item.content,
            item.contentSnippet,
            item.summary,
            item.description
        ];

        let bestContent = "";
        candidates.forEach(c => {
            if (!c) return;
            const clean = c.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            if (clean.length > bestContent.length && clean !== item.title) {
                bestContent = clean;
            }
        });

        let img = null;
        const logoRegex = /logo|icon|thumb/i;

        if (item.enclosure && item.enclosure.url && !logoRegex.test(item.enclosure.url)) {
            img = item.enclosure.url;
        } else if (item.mediaContent && item.mediaContent.$ && item.mediaContent.$.url) {
            img = item.mediaContent.$.url;
        }
        
        if (!img) img = extractImageFromContent(item);

        return {
            title: item.title,
            link: item.link,
            pubDate: itemDate.toISOString(),
            content: bestContent.substring(0, 400),
            creator: item.creator || item['dc:creator'] || item.author || "",
            sourceTitle: feedContent.title || new URL(feed.rssUrl).hostname,
            sheetCategory: feed.category,
            enforcedImage: img
        };
    });
    allArticles.push(...items);
}

async function processScraper(feed, allArticles, now) {
    const urlObj = new URL(feed.scrapeUrl);
    const domain = urlObj.hostname.replace('www.', '');
    console.log(`Scraping HTML: ${domain}`);

    try {
        const { data } = await axios.get(feed.scrapeUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(data);
        
        let scraperRule;
        try {
            const rulePath = path.join(__dirname, 'scrapers', `${domain}.js`);
            if (fs.existsSync(rulePath)) scraperRule = require(rulePath);
        } catch (e) {
            console.log(`No specific scraper for ${domain}, using generic.`);
        }

        const selector = scraperRule ? scraperRule.listSelector : '.item-card, .news-item, article, .post';
        
        $(selector).each((i, el) => {
            if (i > 15) return;
            let item = scraperRule ? scraperRule.parse($, el) : {
                title: $(el).find('h2, h3, .title').first().text().trim(),
                link: $(el).find('a').first().attr('href'),
                enforcedImage: $(el).find('img').first().attr('src'),
                content: "Lue lisää sivustolta."
            };

            if (item.title && item.link) {
                const fullLink = item.link.startsWith('http') ? item.link : new URL(item.link, feed.scrapeUrl).href;
                allArticles.push({
                    title: item.title,
                    link: fullLink,
                    pubDate: item.pubDate || now.toISOString(),
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
    const searchString = (item['content:encoded'] || "") + (item.content || "") + (item.description || "") + (item.summary || "");
    const imgRegex = /<img[^>]+src=["']([^"'>?]+)/gi;
    let match;
    let images = [];
    
    while ((match = imgRegex.exec(searchString)) !== null) {
        const url = match[1];
        if (!/logo|icon|thumb/i.test(url)) {
            images.push(url);
        }
    }
    return images.length > 0 ? images[0] : null;
}

run().then(() => {
    console.log("Process finished successfully.");
    process.exit(0);
});
