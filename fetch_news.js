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
// PÄIVITYS: Lisää tähän käännösvälilehtesi GID (esim. gid=12345678)
const TRANSLATIONS_SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRUveH7tPtcCI0gLuCL7krtgpLPPo_nasbZqxioFhftwSrAykn3jOoJVwPzsJnnl5XzcO8HhP7jpk2_/pub?gid=1293197638&single=true&output=tsv";

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
        console.log("Haetaan syötelistaa Google Sheetsistä...");
        const cacheBuster = `&cb=${Date.now()}`;
        const response = await axios.get(SHEET_TSV_URL + cacheBuster);
        
        const rows = response.data.split(/\r?\n/).slice(1).filter(row => row.trim() !== '');
        
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

        // 2.3 HAETAAN KÄÄNNÖKSET JA TALLENNETAAN JSONINA
        console.log("Päivitetään käännökset...");
        try {
            const transRes = await axios.get(TRANSLATIONS_SHEET_URL + cacheBuster);
            const transRows = transRes.data.split(/\r?\n/).slice(1).filter(r => r.trim() !== '');
            const transObj = { fi: {}, en: {}, sv: {}, de: {}, fr: {} };

            transRows.forEach(row => {
                const [group, key, en, fi, sv, de, fr] = row.split('\t').map(v => v ? v.trim() : '');
                if (key) {
                    transObj.en[key] = en;
                    transObj.fi[key] = fi;
                    transObj.sv[key] = sv;
                    transObj.de[key] = de;
                    transObj.fr[key] = fr;
                }
            });
            fs.writeFileSync('translations.json', JSON.stringify(transObj, null, 2));
            console.log("translations.json päivitetty.");
        } catch (e) {
            console.error("Käännösten haku epäonnistui:", e.message);
        }

        // 2.1. RSS-SYÖTTEET
        const rssFeeds = feeds.filter(f => f.rssUrl && f.rssUrl.length > 10);
        for (const feed of rssFeeds) {
            try {
                console.log(`[RSS] ${feed.nameChecked}`);
                await processRSS(feed, allArticles, now);
                await new Promise(r => setTimeout(r, 600));
            } catch (e) {
                console.error(`RSS-virhe: ${feed.nameChecked}: ${e.message}`);
                failedFeeds.push(`RSS: ${feed.nameChecked}: ${e.message}`);
            }
        }

        // 2.2. SCRAPERIT
        const scrapeFeeds = feeds.filter(f => f.scrapeUrl && !f.rssUrl);
        for (const feed of scrapeFeeds) {
            try {
                console.log(`[SCRAPE] ${feed.nameChecked}`);
                await processScraper(feed, allArticles, now);
                await new Promise(r => setTimeout(r, 1000));
            } catch (e) {
                console.error(`Scraper-virhe: ${feed.nameChecked}: ${e.message}`);
                failedFeeds.push(`SCRAPE: ${feed.nameChecked}: ${e.message}`);
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

        // 3.1. SUODATUS: TULEVAISUUS JA PÄIVÄMÄÄRÄTTÖMÄT
        const maxFutureTime = now.getTime() + 10 * 60000;
        allArticles = allArticles.filter(art => {
            if (!art.pubDate) return false;
            const artTime = new Date(art.pubDate).getTime();
            if (isNaN(artTime) || artTime > maxFutureTime) return false;
            return true;
        });

        // 4. TALLENNUS ARKISTOIHIN JA TILASTOIHIN
        const sourceStats = {
            "__meta": {
                "last_updated": now.toLocaleString('fi-FI', { timeZone: 'Europe/Helsinki' })
            }
        };
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
                    category: art.sheetCategory || "General",
                    description: art.sourceDescription || "",
                    lang: art.lang || "en",
                    scope: art.scope || "World"
                };
            }
            sourceStats[src].count++;
        });

        if (!fs.existsSync(sourcesDir)) fs.mkdirSync(sourcesDir, { recursive: true });

        Object.keys(articlesBySource).forEach(key => {
            fs.writeFileSync(path.join(sourcesDir, `${key}.json`), JSON.stringify(articlesBySource[key], null, 2));
        });

        // 5. ETUSIVUN JÄRJESTELY
        const days = {};
        allArticles.forEach(art => {
            const d = art.pubDate.split('T')[0];
            if (!days[d]) days[d] = [];
            days[d].push(art);
        });
        
        let finalSorted = []; 
        Object.keys(days).sort().reverse().forEach(day => {
            const bySource = {};
            days[day].forEach(art => {
                const src = art.sourceTitle || "Muu";
                if (!bySource[src]) bySource[src] = [];
                if (bySource[src].length < 5) bySource[src].push(art);
            });
        
            const daySources = Object.keys(bySource);
            let i = 0;
            let hasItems = true;
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
        console.log(`Ajo valmis. data.json ja stats.json päivitetty.`);
    } catch (error) {
        console.error("Kriittinen virhe:", error);
        process.exit(1);
    }
}

async function processRSS(feed, allArticles, now) {
    let feedContent;
    const axiosConfig = {
        timeout: 15000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
        },
        httpsAgent: typeof httpsAgent !== 'undefined' ? httpsAgent : undefined
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
            throw new Error(`Haku epäonnistui: ${retryErr.message}`);
        }
    }
    
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

        const rawContent = item['content:encoded'] || item.contentEncoded || item.content || item.description || "";
        const $c = cheerio.load(rawContent);
        if (!img) {
            const firstImg = $c('img').first();
            if (firstImg.length) img = firstImg.attr('src');
        }
        
        $c('img, script, style, iframe, form, figure, figcaption, video, audio').remove();
        $c('*').removeAttr('style').removeAttr('srcset').removeAttr('sizes').removeAttr('fetchpriority').removeAttr('decoding');
        
        let safeHTML = $c('body').html() || $c.html() || "";
        if (safeHTML.length > 800) {
            safeHTML = safeHTML.substring(0, 800);
            safeHTML = cheerio.load(safeHTML).html(); 
        }
        
        let articleLink = item.link;
        if (articleLink) {
            if (articleLink.startsWith('https:/') && !articleLink.startsWith('https://')) articleLink = articleLink.replace('https:/', 'https://');
            if (!articleLink.startsWith('http')) {
                try { articleLink = new URL(articleLink, feed.rssUrl).href; } catch (e) {}
            }
        }

        let finalImg = img;
        if (finalImg && typeof finalImg === 'string') finalImg = finalImg.replace(/&amp;/g, '&');
        
        return {
            title: item.title,
            link: articleLink,
            pubDate: itemDate.toISOString(),
            content: safeHTML.trim() || item.title || "",
            creator: item.creator || item.author || "",
            sourceTitle: feed.nameChecked, 
            sheetCategory: feed.category,
            enforcedImage: finalImg,
            sourceDescription: feed.sheetDesc || (feedContent.description ? feedContent.description.trim() : ""),
            sourceLogo: sourceLogo,
            lang: feed.lang,
            scope: feed.scope,
            isDarkLogo: feed.isDarkLogo,
            originalRssUrl: feed.rssUrl
        };
    });
    allArticles.push(...items);
}

async function processScraper(feed, allArticles, now) {
    const urlObj = new URL(feed.scrapeUrl);
    const domain = urlObj.hostname.replace('www.', '');
    const scraperPath = path.join(__dirname, 'scrapers', `${domain}.js`);

    try {
        if (!fs.existsSync(scraperPath)) return;
        const scraperRule = require(scraperPath);
        const { data } = await axios.get(feed.scrapeUrl, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 15000 
        });

        const $ = cheerio.load(data);
        $('script, style, iframe, form').remove();

        const selector = scraperRule.listSelector || 'article';
        const elements = $(selector).get().slice(0, 10);

        for (const el of elements) {
            let item = await scraperRule.parse($, el, axios, cheerio);
            if (item && item.title && item.link) {
                const fullLink = item.link.startsWith('http') ? item.link : new URL(item.link, feed.scrapeUrl).href;
                allArticles.push({
                    title: item.title,
                    link: fullLink,
                    pubDate: item.pubDate || now.toISOString(),
                    content: item.content || "Lue lisää sivustolta.",
                    creator: item.creator || "",
                    sourceTitle: feed.nameChecked || domain,
                    sheetCategory: feed.category,
                    enforcedImage: item.enforcedImage,
                    sourceDescription: feed.sheetDesc || "Verkkosivulta poimittu uutinen.",
                    sourceLogo: `https://www.google.com/s2/favicons?sz=128&domain=${domain}`,
                    lang: feed.lang,
                    scope: feed.scope,
                    isDarkLogo: feed.isDarkLogo,
                    originalRssUrl: feed.rssUrl || "" 
                });
            }
        }
    } catch (err) {
        console.error(`Scraper epäonnistui: ${domain}: ${err.message}`);
    }
}

run().then(() => {
    console.log("Ajo suoritettu.");
    process.exit(0);
}).catch(err => {
    console.error("Ajo epäonnistui:", err);
    process.exit(1);
});
