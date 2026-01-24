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

const SHEET_CSV_URL = process.env.SHEET_CSV_URL || 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRUveH7tPtcCI0gLuCL7krtgpLPPo_nasbZqxioFhftwSrAykn3jOoJVwPzsJnnl5XzcO8HhP7jpk2_/pub?gid=0&single=true&output=csv';

async function run() {
    let failedFeeds = []; 
    let allArticles = [];
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const cleanLogFile = path.join(__dirname, 'last_clean.txt');
    const sourcesDir = path.join(__dirname, 'sources');

    try {
        // 1. PÄIVITTÄINEN PUHDISTUSLOGIIKKA
        let lastCleanDate = "";
        if (fs.existsSync(cleanLogFile)) {
            lastCleanDate = fs.readFileSync(cleanLogFile, 'utf8').trim();
        }

        if (lastCleanDate !== today) {
            console.log(`--- PÄIVÄN ENSIMMÄINEN AJO: Puhdistetaan arkistot (${today}) ---`);
            if (fs.existsSync(sourcesDir)) {
                fs.readdirSync(sourcesDir).forEach(file => fs.unlinkSync(path.join(sourcesDir, file)));
            } else {
                fs.mkdirSync(sourcesDir);
            }
            allArticles = [];
            fs.writeFileSync(cleanLogFile, today);
        } else {
            console.log(`--- Jatketaan päivää: ladataan olemassa oleva data ---`);
            if (fs.existsSync('data.json')) {
                allArticles = JSON.parse(fs.readFileSync('data.json', 'utf8'));
            }
        }

        // 2. HAETAAN SYÖTTEET
        console.log("Haetaan syötelistaa Google Sheetsistä...");
        const response = await axios.get(SHEET_CSV_URL);
        const rows = response.data.split('\n').slice(1);

        const feeds = rows.map(row => {
            if (!row || row.trim() === '') return null;
            const cols = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            if (cols.length < 3) return null; 
            return { 
                category: cols[0]?.replace(/^"|"$/g, '').trim() || "General",
                rssUrl: cols[2]?.replace(/^"|"$/g, '').trim(), 
                scrapeUrl: cols[3]?.replace(/^"|"$/g, '').trim() 
            };
        }).filter(f => f !== null);

        console.log(`Käsitellään ${feeds.length} lähdettä...`);

        for (const feed of feeds) {
            try {
                if (feed.rssUrl && feed.rssUrl.length > 10) {
                    console.log(`[RSS] ${feed.rssUrl}`);
                    await processRSS(feed, allArticles, now);
                } else if (feed.scrapeUrl) {
                    console.log(`[SCRAPE] ${feed.scrapeUrl}`);
                    await processScraper(feed, allArticles, now);
                }
                await new Promise(r => setTimeout(r, 600));
            } catch (e) {
                console.error(`Virhe: ${e.message}`);
                failedFeeds.push(`${feed.category}: ${e.message}`);
            }
        }

        // 3. DUPLIKAATTIEN POISTO
        const seenPostUrls = new Set();
        allArticles = allArticles.filter(art => {
            if (!art || !art.link) return false;
            const cleanUrl = art.link.split('?')[0].split('#')[0].trim().toLowerCase();
            if (seenPostUrls.has(cleanUrl)) return false;
            seenPostUrls.add(cleanUrl);
            return true;
        });

        // 4. TALLENNUS ARKISTOIHIN (Täydelliset tiedostot)
        const sourceStats = {};
        const articlesBySource = {};
        allArticles.forEach(art => {
            const src = art.sourceTitle || "Muu";
            const fileKey = src.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            if (!articlesBySource[fileKey]) articlesBySource[fileKey] = [];
            articlesBySource[fileKey].push(art);
            if (!sourceStats[src]) {
                sourceStats[src] = { file: `${fileKey}.json`, count: 0 };
            }
            sourceStats[src].count++;
        });

        Object.keys(articlesBySource).forEach(key => {
            fs.writeFileSync(path.join(sourcesDir, `${key}.json`), JSON.stringify(articlesBySource[key], null, 2));
        });

        // 5. ETUSIVUN JÄRJESTELY (ROUND ROBIN)
        const days = {};
        allArticles.forEach(art => {
            const d = art.pubDate.split('T')[0];
            if (!days[d]) days[d] = [];
            days[d].push(art);
        });

        let finalSorted = []; // TÄMÄ OLI AIEMMIN PUUTTUVA MÄÄRITTELY
        Object.keys(days).sort().reverse().forEach(day => {
            const dayArticles = days[day];
            const bySource = {};
            dayArticles.forEach(art => {
                const src = art.sourceTitle || "Muu";
                if (!bySource[src]) bySource[src] = [];
                bySource[src].push(art);
            });
            const daySources = Object.keys(bySource);
            let hasItems = true;
            let i = 0;
            while (hasItems) {
                hasItems = false;
                daySources.forEach(src => {
                    if (bySource[src][i]) {
                        finalSorted.push(bySource[src][i]);
                        hasItems = true;
                    }
                });
                i++;
            }
        });

        // 6. TALLENNUS DATA JA STATS
        fs.writeFileSync('data.json', JSON.stringify(finalSorted.slice(0, 500), null, 2));
        fs.writeFileSync('stats.json', JSON.stringify(sourceStats, null, 2));

        if (failedFeeds.length > 0) fs.writeFileSync('failed_feeds.txt', failedFeeds.join('\n'));
        console.log(`Success! data.json ja ${Object.keys(articlesBySource).length} arkistoa päivitetty.`);
    } catch (error) {
        console.error("Kriittinen virhe:", error);
        process.exit(1);
    }
}

async function processRSS(feed, allArticles, now) {
    const feedContent = await parser.parseURL(feed.rssUrl);
    // POISTETTU .slice(0, 15) jotta arkistot ovat täydellisiä
    const items = feedContent.items.map(item => {
        let itemDate = new Date(item.pubDate || item.isoDate);
        if (isNaN(itemDate.getTime()) || itemDate > now) itemDate = now;

        if (itemDate.getHours() === 0 && itemDate.getMinutes() === 0) {
            const randomMinutes = Math.floor(Math.random() * 720);
            itemDate.setMinutes(itemDate.getMinutes() - randomMinutes);
        }

        let img = null;

        // GUARDIAN RESOLUUTIO KORJAUS
        const mContent = item.mediaContent || item['media:content'];
        if (mContent) {
            const mediaArray = Array.isArray(mContent) ? mContent : [mContent];
            let bestWidth = 0;
            mediaArray.forEach(m => {
                // Tarkistetaan leveys eri mahdollisista paikoista
                const w = parseInt(m.$?.width || m.width || 0);
                if (w > bestWidth) {
                    bestWidth = w;
                    img = m.$?.url || m.url;
                }
            });
        }

        if (!img && item.enclosure && item.enclosure.url) img = item.enclosure.url;
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
    // Access Now ja muut "vaikeat" syötteet upottavat kuvat näihin
    const searchString = (item['content:encoded'] || "") + 
                         (item.content || "") + 
                         (item.description || "") +
                         (item.summary || "");
    
    const imgRegex = /<img[^>]+src=["']([^"'>?]+)/gi;
    let match;
    
    while ((match = imgRegex.exec(searchString)) !== null) {
        const url = match[1];
        // Ohitetaan seuranta- ja pikkukuvakkeet
        if (!/analytics|doubleclick|pixel|stat|share|icon|avatar/i.test(url)) {
            return url; 
        }
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
