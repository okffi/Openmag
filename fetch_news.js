const axios = require('axios');
const fs = require('fs');
const path = require('path');
const Parser = require('rss-parser');
const cheerio = require('cheerio');

// Määritetään RSS-parseri tukemaan kuvia (media:content ja enclosure)
const parser = new Parser({ 
    headers: { 'User-Agent': 'OpenMag-Robot-v1' },
    customFields: {
        item: [
            ['media:content', 'mediaContent'],
            ['enclosure', 'enclosure']
        ] 
    }
});

const SHEET_CSV_URL = process.env.SHEET_CSV_URL || 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRUveH7tPtcCI0gLuCL7krtgpLPPo_nasbZqxioFhftwSrAykn3jOoJVwPzsJnnl5XzcO8HhP7jpk2_/pub?gid=0&single=true&output=csv';

async function run() {
    let failedFeeds = []; 
    try {
        console.log("Haetaan syötelistaa...");
        const response = await axios.get(SHEET_CSV_URL);
        const rows = response.data.split('\n').slice(1);

        // fetch_news.js (rivit n. 25-35)
        const rawFeeds = rows.map(row => {
            if (!row || row.trim() === '') return null; // Ohita tyhjät rivit
            const cols = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            
            // Tarkistetaan, että rivillä on vähintään tarvittavat sarakkeet
            if (cols.length < 3) return null; 
        
            return { 
                category: cols[0]?.replace(/^"|"$/g, '').trim() || "General",
                rssUrl: cols[2]?.replace(/^"|"$/g, '').trim(), 
                scrapeUrl: cols[3]?.replace(/^"|"$/g, '').trim() 
            };
        }).filter(f => f !== null); // Poistetaan epäonnistuneet rivit

        // Suodatetaan duplikaattisyötteet ja tyhjät rivit
        const seenUrls = new Set();
        const feeds = rawFeeds.filter(f => {
            const url = (f.rssUrl && f.rssUrl.length > 5) ? f.rssUrl : f.scrapeUrl;
            if (!url || !url.startsWith('http') || seenUrls.has(url)) return false;
            seenUrls.add(url);
            return true;
        });

        console.log(`Löydetty ${feeds.length} uniikkia syötettä.`);

        let allArticles = [];
        const now = new Date();

        // Käydään syötteet läpi
        for (const feed of feeds) {
            try {
                if (feed.rssUrl && feed.rssUrl.length > 5) {
                    console.log(`Käsitellään RSS: ${feed.rssUrl}`);
                    await processRSS(feed, allArticles, now);
                } else if (feed.scrapeUrl) {
                    console.log(`Käsitellään Scrape: ${feed.scrapeUrl}`);
                    await processScraper(feed, allArticles, now);
                }
                // Pieni viive estää palvelimien ylikuormituksen
                await new Promise(r => setTimeout(r, 500));
            } catch (e) {
                const errorMsg = `${feed.category}: ${feed.rssUrl || feed.scrapeUrl} - Virhe: ${e.message}`;
                console.error(errorMsg);
                failedFeeds.push(errorMsg);
            }
        }

        // Lajittelu ajan mukaan (uusimmat ensin)
        allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

        // Duplikaattien poisto URL-osoitteen perusteella
        const uniqueArticles = [];
        const seenPostUrls = new Set();
        allArticles.forEach(art => {
            const cleanUrl = art.link.split('?')[0].split('#')[0].trim().toLowerCase();
            if (!seenPostUrls.has(cleanUrl)) {
                seenPostUrls.add(cleanUrl);
                uniqueArticles.push(art);
            }
        });
        allArticles = uniqueArticles;

        // 1. TALLENNUS: Päävirta (data.json)
        fs.writeFileSync('data.json', JSON.stringify(allArticles.slice(0, 500), null, 2));

        // 2. TALLENNUS: Lähteet omiin tiedostoihinsa
        const sourcesDir = path.join(__dirname, 'sources');
        if (!fs.existsSync(sourcesDir)) fs.mkdirSync(sourcesDir);

        const sourceStats = {};
        const articlesBySource = {};

        allArticles.forEach(art => {
            const src = art.sourceTitle || "Muu lähde";
            const fileKey = src.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            
            if (!articlesBySource[fileKey]) articlesBySource[fileKey] = [];
            articlesBySource[fileKey].push(art);
            
            if (!sourceStats[src]) {
                sourceStats[src] = { file: `${fileKey}.json`, count: 0 };
            }
            sourceStats[src].count++;
        });

        // Kirjoitetaan tiedosto jokaiselle lähteelle
        Object.keys(articlesBySource).forEach(key => {
            fs.writeFileSync(path.join(sourcesDir, `${key}.json`), JSON.stringify(articlesBySource[key].slice(0, 100), null, 2));
        });

        // 3. TALLENNUS: stats.json sivupalkkia varten
        fs.writeFileSync('stats.json', JSON.stringify(sourceStats, null, 2));

        if (failedFeeds.length > 0) {
            fs.writeFileSync('failed_feeds.txt', failedFeeds.join('\n'));
        }

        console.log(`Success! data.json ja sources/ päivitetty.`);
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

        // Parannettu kuvan haku (Atom ja RSS)
        let img = null;
        if (item.enclosure && item.enclosure.url) {
            img = item.enclosure.url;
        } else if (item.mediaContent && item.mediaContent.$) {
            img = item.mediaContent.$.url;
        }
        
        if (!img) img = extractImageFromContent(item);

        return {
            title: item.title,
            link: item.link,
            pubDate: itemDate.toISOString(),
            content: (item.contentSnippet || item.summary || "").replace(/<[^>]*>/g, '').trim().substring(0, 400),
            creator: item.creator || item.author || "",
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

    try {
        const { data } = await axios.get(feed.scrapeUrl, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 15000 // 15 sekuntia on turvallinen yläraja
        });
        const $ = cheerio.load(data);
        
        let scraperRule = null;
        const rulePath = path.join(__dirname, 'scrapers', `${domain}.js`);
        if (fs.existsSync(rulePath)) {
            scraperRule = require(rulePath);
        }

        const selector = scraperRule ? scraperRule.listSelector : 'article';
        const elements = $(selector).get().slice(0, 10);

        for (const el of elements) {
            let item;
            if (scraperRule) {
                item = await scraperRule.parse($, el, axios, cheerio);
            } else {
                item = {
                    title: $(el).find('h2, h3, .title').first().text().trim(),
                    link: $(el).find('a').first().attr('href'),
                    enforcedImage: $(el).find('img').first().attr('src'),
                    content: ""
                };
            }

            if (item && item.title && item.link) {
                const fullLink = item.link.startsWith('http') ? item.link : new URL(item.link, feed.scrapeUrl).href;
                
                // Varmistetaan, että kuva on täysi URL
                let finalImg = item.enforcedImage;
                if (finalImg && !finalImg.startsWith('http')) {
                    finalImg = new URL(finalImg, fullLink).href;
                }
            
                allArticles.push({
                    title: item.title,
                    link: fullLink,
                    pubDate: item.pubDate || now.toISOString(),
                    content: item.content || "Lue lisää sivustolta.",
                    creator: item.creator || "",
                    sourceTitle: domain,
                    sheetCategory: feed.category,
                    enforcedImage: finalImg // Käytetään puhdistettua URL-osoitetta
                });
            }
        }
    } catch (err) {
        console.error(`Scraper epäonnistui kohteelle ${domain}: ${err.message}`);
    }
}

function extractImageFromContent(item) {
    const searchString = (item['content:encoded'] || "") + (item.content || "") + (item.description || "");
    const imgRegex = /<img[^>]+src=["']([^"'>?]+)/gi;
    let match;
    while ((match = imgRegex.exec(searchString)) !== null) {
        const url = match[1];
        if (!/logo|icon|thumb|pixel|stat|avatar/i.test(url)) return url;
    }
    return null;
}

run().then(() => {
    console.log("Ajo suoritettu loppuun.");
    process.exit(0); // Pakottaa Node.js:n lopettamaan
}).catch(err => {
    console.error("Ajo epäonnistui:", err);
    process.exit(1);
});
