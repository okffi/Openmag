const axios = require('axios');
const fs = require('fs');
const path = require('path');
const Parser = require('rss-parser');
const cheerio = require('cheerio');
const https = require('https');
const http = require('http');
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const httpAgent = new http.Agent();

const parser = new Parser({ 
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) OpenMag-Robot-v1' },
    customFields: {
        item: [
            ['media:content', 'mediaContent', {keepArray: true}],
            ['media:thumbnail', 'mediaThumbnail'],
            ['enclosure', 'enclosure'],
            ['content:encoded', 'contentEncoded']
        ] 
    }
});

const SHEET_TSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRUveH7tPtcCI0gLuCL7krtgpLPPo_nasbZqxioFhftwSrAykn3jOoJVwPzsJnnl5XzcO8HhP7jpk2_/pub?gid=0&single=true&output=tsv";
    
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
            console.log(`--- PÄIVÄN ENSIMMÄINEN AJO: Puhdistetaan arkistot ja data.json (${today}) ---`);
            if (fs.existsSync(sourcesDir)) {
                fs.readdirSync(sourcesDir).forEach(file => fs.unlinkSync(path.join(sourcesDir, file)));
            } else {
                fs.mkdirSync(sourcesDir, { recursive: true });
            }
            allArticles = []; 
            if (fs.existsSync('data.json')) fs.unlinkSync('data.json');
            fs.writeFileSync(cleanLogFile, today);
        } else {
            console.log(`--- Jatketaan päivää: ladataan olemassa oleva data ---`);
            if (fs.existsSync('data.json')) {
                allArticles = JSON.parse(fs.readFileSync('data.json', 'utf8'));
            }
        }

        // 2. HAETAAN SYÖTTEET
        console.log("Haetaan syötelistaa Google Sheetsistä (TSV)...");
        const cacheBuster = `&cb=${Date.now()}`;
        const response = await axios.get(SHEET_TSV_URL + cacheBuster);
        
        const rows = response.data.split(/\r?\n/)
            .slice(1)
            .filter(row => row.trim() !== '');

        const feeds = rows.map(row => {
            const c = row.split('\t').map(v => v ? v.trim() : '');
            if (!c[2] && !c[3]) return null;

            return { 
                category: c[0] || "Yleinen",
                feedName: c[1] || "Nimetön",
                rssUrl: c[2], 
                scrapeUrl: c[3] || "",
                nameChecked: c[4] || c[1] || "Lähde",
                sheetDesc: c[5] || "",
                lang: (c[6] || "fi").toLowerCase(),
                scope: c[7] || "World",
                isDarkLogo: (c[8] || "").toUpperCase() === "TRUE" || c[8] === "1"
            };
        }).filter(f => f !== null);

        console.log(`--- Parsittu ${feeds.length} voimassa olevaa syötettä ---`);
        
        // 1. AJO: Varmat ja standardit RSS-syötteet
        for (const feed of feeds.filter(f => f.rssUrl && f.rssUrl.length > 10)) {
            try {
                console.log(`[RSS] ${feed.nameChecked}: ${feed.rssUrl}`);
                await processRSS(feed, allArticles, now);
                await new Promise(r => setTimeout(r, 600));
            } catch (e) {
                console.error(`RSS-virhe [${feed.nameChecked}]: ${e.message}`);
                failedFeeds.push(`RSS ${feed.nameChecked}: ${e.message}`);
            }
        }
        
        // 2. AJO: Kokeelliset skraappaukset (eristetty muusta datasta)
        // Voit ottaa tämän käyttöön tai jättää pois vaikuttamatta RSS-hakuun
        /*
        for (const feed of feeds.filter(f => f.scrapeUrl)) {
            try {
                console.log(`[SCRAPE] ${feed.nameChecked}: ${feed.scrapeUrl}`);
                await processScraper(feed, allArticles, now);
                await new Promise(r => setTimeout(r, 1000));
            } catch (e) {
                console.error(`Scrape-virhe [${feed.nameChecked}]: ${e.message}`);
                failedFeeds.push(`SCRAPE ${feed.nameChecked}: ${e.message}`);
            }
        }
        */

        // 3. DUPLIKAATTIEN POISTO
        const seenPostUrls = new Set();
        allArticles = allArticles.filter(art => {
            if (!art || !art.link) return false;
            const cleanUrl = art.link.split('?')[0].split('#')[0].trim().toLowerCase();
            if (seenPostUrls.has(cleanUrl)) return false;
            seenPostUrls.add(cleanUrl);
            return true;
        });

        // 4. TALLENNUS ARKISTOIHIN
        const sourceStats = {};
        const articlesBySource = {};

        allArticles.forEach(art => {
            const src = art.sourceTitle; 
            const fileKey = src.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            
            if (!articlesBySource[fileKey]) articlesBySource[fileKey] = [];
            articlesBySource[fileKey].push(art);
            
            if (!sourceStats[src]) {
                sourceStats[src] = { 
                    file: `${fileKey}.json`, 
                    count: 0,
                    category: art.sheetCategory || "Yleinen",
                    description: art.sourceDescription || "" 
                };
            }
            sourceStats[src].count++;
        });

        if (!fs.existsSync(sourcesDir)) {
            fs.mkdirSync(sourcesDir, { recursive: true });
        }

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

        let finalSorted = []; 
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

        // 6. TALLENNUS
        fs.writeFileSync('data.json', JSON.stringify(finalSorted.slice(0, 1000), null, 2));
        fs.writeFileSync('stats.json', JSON.stringify(sourceStats, null, 2));

        if (failedFeeds.length > 0) fs.writeFileSync('failed_feeds.txt', failedFeeds.join('\n'));
        console.log(`Success! data.json päivitetty.`);
    } catch (error) {
        console.error("Kriittinen virhe:", error);
        process.exit(1);
    }
}

async function processRSS(feed, allArticles, now) {
    let feedContent;
    const axiosConfig = {
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/xml,application/xml' },
        httpsAgent
    };

    try {
        feedContent = await parser.parseURL(feed.rssUrl);
    } catch (err) {
        try {
            const response = await axios.get(feed.rssUrl, axiosConfig);
            let xmlData = response.data;
            xmlData = xmlData.replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[a-f\d]+);)/gi, '&amp;');
            feedContent = await parser.parseString(xmlData);
        } catch (retryErr) {
            throw new Error(`RSS luku epäonnistui: ${retryErr.message}`);
        }
    }
    
    const sourceDescription = feed.sheetDesc || (feedContent.description ? feedContent.description.trim() : "");
    let sourceLogo = feedContent.image ? feedContent.image.url : null;
    
    if (!sourceLogo) {
        try {
            const linkToParse = feedContent.link || (feedContent.items[0] && feedContent.items[0].link) || feed.rssUrl;
            if (linkToParse) {
                const domain = new URL(linkToParse).hostname;
                sourceLogo = `https://www.google.com/s2/favicons?sz=128&domain=${domain}`;
            }
        } catch (e) {}
    }

    const items = feedContent.items.map(item => {
        let itemDate = new Date(item.pubDate || item.isoDate);
        if (isNaN(itemDate.getTime()) || itemDate > now) itemDate = now;

        // KUVAN POIMINTA
        let img = null;
        let mContent = item.mediaContent || item['media:content'];
        if (mContent) {
            const mediaArray = Array.isArray(mContent) ? mContent : [mContent];
            let maxW = 0;
            mediaArray.forEach(m => {
                const currentUrl = m.url || m.$?.url;
                const currentWidth = parseInt(m.width || m.$?.width || 0);
                if (currentUrl && (currentWidth >= maxW || !img)) {
                    maxW = currentWidth;
                    img = currentUrl;
                }
            });
        }
        if (!img && item.mediaThumbnail) img = item.mediaThumbnail.$?.url || item.mediaThumbnail.url;
        if (!img && item.enclosure && item.enclosure.url) img = item.enclosure.url;
        if (!img) img = extractImageFromContent(item, feed.rssUrl);

        if (img) {
            if (img.includes('?')) img = img.split('?')[0];
            if (img.startsWith('/') && !img.startsWith('http')) {
                try {
                    const urlObj = new URL(feed.rssUrl);
                    img = `${urlObj.protocol}//${urlObj.hostname}${img}`;
                } catch (e) { img = null; }
            }
            if (img && img.includes('guim.co.uk')) img = img.replace('http://', 'https://');
            img = img.replace(/&amp;/g, '&');
        }

        // TEKSTIN POIMINTA JA PUHDISTUS (Lisätty sanitointi tässä)
        const rawContent = item['content:encoded'] || item.contentEncoded || item.content || item.description || "";
        
        // Luodaan Cheerio-olio, jotta voidaan poistaa roska-tagit
        const $ = cheerio.load(rawContent);
        $('script, style, iframe, form, noscript').remove(); // Poistetaan Gravity Forms, tyylit ja upotukset
        
        let cleanText = $.text() // Otetaan vain puhdas teksti
            .replace(/\s+/g, ' ')
            .trim();

        if (cleanText.length < 10) cleanText = item.title || "";
        const finalSnippet = cleanText.length > 500 ? cleanText.substring(0, 500) + "..." : cleanText;

        return {
            title: item.title,
            link: item.link,
            pubDate: itemDate.toISOString(),
            content: finalSnippet,
            creator: item.creator || item.author || "",
            sourceTitle: feed.nameChecked, 
            sheetCategory: feed.category,
            enforcedImage: img,
            sourceDescription: sourceDescription,
            sourceLogo: sourceLogo,
            lang: feed.lang,
            scope: feed.scope,
            isDarkLogo: feed.isDarkLogo
        };
    });
    allArticles.push(...items);
}

async function processScraper(feed, allArticles, now) {
    const urlObj = new URL(feed.scrapeUrl);
    const domain = urlObj.hostname.replace('www.', '');

    try {
        const { data } = await axios.get(feed.scrapeUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 });
        const $ = cheerio.load(data);
        $('script, style, iframe, form').remove(); // Puhdistetaan skraappaus-data
        
        let scraperRule = null;
        const rulePath = path.join(__dirname, 'scrapers', `${domain}.js`);
        if (fs.existsSync(rulePath)) scraperRule = require(rulePath);

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
                allArticles.push({
                    title: item.title,
                    link: fullLink,
                    pubDate: item.pubDate || now.toISOString(),
                    content: item.content || "Lue lisää sivustolta.",
                    sourceTitle: feed.nameChecked || domain,
                    sheetCategory: feed.category,
                    enforcedImage: item.enforcedImage,
                    sourceDescription: feed.sheetDesc || "Verkkosivulta poimittu.",
                    sourceLogo: `https://www.google.com/s2/favicons?sz=128&domain=${domain}`,
                    lang: feed.lang,
                    scope: feed.scope,
                    isDarkLogo: feed.isDarkLogo
                });
            }
        }
    } catch (err) { console.error(`Scraper epäonnistui ${domain}: ${err.message}`); }
}

function extractImageFromContent(item, baseUrl) {
    const searchString = (item.contentEncoded || "") + (item.content || "") + (item.description || "");
    if (!searchString) return null;

    const $ = cheerio.load(searchString);
    $('script, style').remove(); // Varmistetaan, ettei poimita skriptien sisällä olevia URL-osoitteita
    
    let foundImg = null;
    $('img').each((i, el) => {
        if (foundImg) return;
        let src = $(el).attr('src') || $(el).attr('data-src');
        if (src) {
            try {
                const checkUrl = new URL(src, baseUrl);
                if (checkUrl.pathname === "/" || checkUrl.pathname === "") return;
                
                // Poistetaan analytiikka-kuvat
                if (/analytics|doubleclick|pixel|1x1|avatar|count/i.test(src)) return;
                
                foundImg = checkUrl.href;
            } catch (e) {}
        }
    });
    return foundImg;
}

run().then(() => {
    console.log("Ajo suoritettu loppuun.");
    process.exit(0);
}).catch(err => {
    console.error("Ajo epäonnistui:", err);
    process.exit(1);
});
