const axios = require('axios');
const fs = require('fs');
const path = require('path');
const Parser = require('rss-parser');
const cheerio = require('cheerio');
const https = require('https');

// 1. SSL-AGENTTI: Ohitetaan sertifikaattivirheet (esim. CNRS)
const agent = new https.Agent({  
  rejectUnauthorized: false
});

const parser = new Parser({ 
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) OpenMag-Robot-v1' },
    requestOptions: {
        agent: agent // Käytetään SSL-agenttia kaikissa RSS-hauissa
    },
    customFields: {
        item: [
            ['media:content', 'mediaContent', {keepArray: true}],
            ['media:thumbnail', 'mediaThumbnail'],
            ['enclosure', 'enclosure'],
            ['content:encoded', 'contentEncoded']
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
            }
            allArticles = []; 
            fs.writeFileSync(cleanLogFile, today);
        } else {
            if (fs.existsSync('data.json')) {
                allArticles = JSON.parse(fs.readFileSync('data.json', 'utf8'));
            }
        }

        // 2. HAETAAN SYÖTTEET
        console.log("Haetaan syötelistaa Google Sheetsistä...");
        const response = await axios.get(SHEET_CSV_URL + `&cb=${Date.now()}`);
        
        // Parempi tapa jakaa rivit: huomioidaan mahdolliset rivinvaihdot solujen sisällä
        const rows = response.data.replace(/\r/g, '').split('\n').slice(1);

const feeds = rows.map(row => {
            if (!row || row.trim() === '') return null;
            const cols = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            
            // Siivotaan sarakkeet lainausmerkeistä
            const c = cols.map(val => (val || "").replace(/^"|"$/g, '').trim());

            // 1. Määritetään nimi (Priorisoidaan Name_FI [7], fallback Feed name [1])
            const nameFI = c[7]; 
            const feedName = c[1];
            const finalName = (nameFI && nameFI !== "-" && nameFI !== "") ? nameFI : feedName;

            // 2. Määritetään RSS (Käytetään saraketta 2)
            const rssUrl = c[2]; 
            const scrapeUrl = c[3];

            // 3. Negative logo logiikka (sarake 11)
            const negativeLogoVal = (c[11] || "").toUpperCase();
            const isDarkLogo = negativeLogoVal === "TRUE" || negativeLogoVal === "1";

            // Hylätään jos ei nimeä tai osoitteita
            if (!finalName || finalName === "-" || (!rssUrl && !scrapeUrl)) return null;

            return { 
                category: c[0] || "Yleinen",
                rssUrl: rssUrl, 
                scrapeUrl: scrapeUrl,
                nameFI: finalName,
                isDarkLogo: isDarkLogo
            };
        }).filter(f => f !== null);

        // 3. DUPLIKAATTIEN POISTO JA LAJITTELU (Uusin ensin)
        const seenIds = new Set();
        allArticles = allArticles
            .filter(art => {
                if (!art) return false;
                
                const cleanTitle = String(art.title || "").trim().toLowerCase();
                const source = String(art.sourceTitle || "").toLowerCase();
                const datePart = art.pubDate ? art.pubDate.split('T')[0] : "";
                
                // Tunniste: Otsikko + Lähde + Päivä
                // Tämä sallii saman linkin eri uutisille, mutta estää oikeat tuplat
                const uniqueId = `${cleanTitle}|${source}|${datePart}`;

                if (seenIds.has(uniqueId)) return false;
                seenIds.add(uniqueId);
                return true;
            })
            .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

        // 4. TALLENNUS ARKISTOIHIN JA TILASTOT
        const sourceStats = {
            "__meta": {
                "last_run": now.toISOString(),
                "article_count": allArticles.length
            }
        };
        const articlesBySource = {};

        allArticles.forEach(art => {
            const src = art.sourceTitle || "Muu";
            const fileKey = src.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            if (!articlesBySource[fileKey]) articlesBySource[fileKey] = [];
            articlesBySource[fileKey].push(art);
            
            if (!sourceStats[src]) {
                sourceStats[src] = { 
                    file: `${fileKey}.json`, 
                    count: 0,
                    category: art.sheetCategory || "Yleinen" 
                };
            }
            sourceStats[src].count++;
        });

        if (!fs.existsSync(sourcesDir)) fs.mkdirSync(sourcesDir, { recursive: true });

        Object.keys(articlesBySource).forEach(key => {
            fs.writeFileSync(path.join(sourcesDir, `${key}.json`), JSON.stringify(articlesBySource[key], null, 2));
        });

        // 5. ETUSIVUN JÄRJESTELY (ROUND ROBIN PÄIVÄN SISÄLLÄ)
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
                bySource[src].push(art);
            });
            const daySources = Object.keys(bySource);
            let hasItems = true; let i = 0;
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
        console.log(`Success! data.json päivitetty. ${allArticles.length} artikkelia.`);
    } catch (error) {
        console.error("Kriittinen virhe:", error);
        process.exit(1);
    }
}

async function processRSS(feed, allArticles, now) {
    const feedContent = await parser.parseURL(feed.rssUrl);
    const sourceDescription = feedContent.description ? String(feedContent.description).trim() : "";
    let sourceLogo = feedContent.image ? feedContent.image.url : null;
    
    if (!sourceLogo && feedContent.link) {
        try {
            const domain = new URL(feedContent.link).hostname;
            sourceLogo = `https://www.google.com/s2/favicons?sz=128&domain=${domain}`;
        } catch (e) {
            console.log("Ei voitu luoda favicon-linkkiä");
        }
    }

    const items = feedContent.items.map(item => {
        let itemDate = new Date(item.pubDate || item.isoDate);
        if (isNaN(itemDate.getTime()) || itemDate > now) itemDate = now;

        if (itemDate.getHours() === 0 && itemDate.getMinutes() === 0) {
            const randomMinutes = Math.floor(Math.random() * 720);
            itemDate.setMinutes(itemDate.getMinutes() - randomMinutes);
        }
        
        let img = null;

        // A) Kokeillaan mediakenttiä (Priorisoidaan leveys)
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

        if (!img && item.mediaThumbnail) {
            img = item.mediaThumbnail.$?.url || item.mediaThumbnail.url;
        }

        if (!img && item.enclosure && item.enclosure.url) {
            img = item.enclosure.url;
        }

        // B) Jos ei mediakentissä, kaivetaan tekstin seasta (Access Now vahvistus)
        if (!img) {
            img = extractImageFromContent(item, feed.rssUrl);
        }

        // C) ÄLYKÄS PUHDISTUS
        if (img) {
            if (img.includes('?')) img = img.split('?')[0];
            if (img.startsWith('/') && !img.startsWith('http')) {
                try {
                    const urlObj = new URL(feed.rssUrl);
                    img = `${urlObj.protocol}//${urlObj.hostname}${img}`;
                } catch (e) { img = null; }
            }
            if (img && img.startsWith('//')) img = 'https:' + img;
        }

        // --- TEKSTIN POIMINTA ---
        const rawContent = item['content:encoded'] || item.contentEncoded || item.content || item.description || "";
        let cleanText = rawContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

        if (cleanText.length < 10 || cleanText === "...") {
            cleanText = item.title || "";
        }

        const finalSnippet = cleanText.length > 500 ? cleanText.substring(0, 500) + "..." : cleanText;

        let articleLink = item.link;
        if (articleLink && !articleLink.startsWith('http')) {
            try { articleLink = new URL(articleLink, feed.rssUrl).href; } catch (e) {}
        }

        return {
            title: item.title,
            link: articleLink,
            pubDate: itemDate.toISOString(),
            content: finalSnippet,
            creator: item.creator || item.author || "",
            sourceTitle: feed.nameFI || feedContent.title || new URL(feed.rssUrl).hostname,
            sourceTitle: feed.nameFI || domain || "Muu",
            sheetCategory: feed.category,
            enforcedImage: img,
            sourceDescription: sourceDescription,
            sourceLogo: sourceLogo,
            originalRssUrl: feed.rssUrl,
            isDarkLogo: feed.isDarkLogo
        };
    });
    allArticles.push(...items);
}

async function processScraper(feed, allArticles, now) {
    const urlObj = new URL(feed.scrapeUrl);
    const domain = urlObj.hostname.replace('www.', '');

    try {
        const { data } = await axios.get(feed.scrapeUrl, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) OpenMag-Robot-v1' },
            timeout: 15000,
            httpsAgent: agent 
        });
        const $ = cheerio.load(data);
        
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
                    enforcedImage: $(el).find('img').first().attr('src') || $(el).find('img').first().attr('data-src'),
                    content: ""
                };
            }

            if (item && item.title && item.link) {
                const fullLink = item.link.startsWith('http') ? item.link : new URL(item.link, feed.scrapeUrl).href;
                let finalImg = item.enforcedImage;
                if (finalImg && !finalImg.startsWith('http')) finalImg = new URL(finalImg, fullLink).href;
            
                allArticles.push({
                    title: item.title,
                    link: fullLink,
                    pubDate: item.pubDate || now.toISOString(),
                    content: item.content || "Lue lisää sivustolta.",
                    creator: item.creator || "",
                    sourceTitle: feed.nameFI || domain,
                    sheetCategory: feed.category,
                    enforcedImage: finalImg,
                    sourceDescription: "Verkkosivulta poimittu uutinen.",
                    sourceLogo: `https://www.google.com/s2/favicons?sz=128&domain=${domain}`,
                    originalRssUrl: null,
                    isDarkLogo: feed.isDarkLogo
                });
            }
        }
    } catch (err) {
        console.error(`Scraper epäonnistui kohteelle ${domain}: ${err.message}`);
    }
}

function extractImageFromContent(item, baseUrl) {
    const searchString = (item['content:encoded'] || "") + 
                         (item.contentEncoded || "") + 
                         (item.content || "") + 
                         (item.description || "") +
                         (item.summary || "");
    
    if (!searchString) return null;

    const $ = cheerio.load(searchString);
    let foundImg = null;

    $('img').each((i, el) => {
        if (foundImg) return;
        
        // WordPress / Jetpack / Access Now tuki:
        // Priorisoidaan data-orig-file (alkuperäinen täysikokoinen kuva)
        let src = $(el).attr('data-orig-file') || 
                  $(el).attr('src') || 
                  $(el).attr('data-src') || 
                  $(el).attr('data-lazy-src');
        
        if (!src && $(el).attr('srcset')) {
            const sets = $(el).attr('srcset').split(',');
            src = sets[sets.length - 1].trim().split(' ')[0];
        }

        if (src) {
            if (src.includes('?')) src = src.split('?')[0];
            if (src.startsWith('//')) src = 'https:' + src;
            if (src.startsWith('/') && !src.startsWith('http')) {
                try {
                    const urlObj = new URL(baseUrl);
                    src = `${urlObj.protocol}//${urlObj.hostname}${src}`;
                } catch (e) {}
            }
            
            if (src.startsWith('http')) {
                const isUseless = /analytics|doubleclick|pixel|1x1|wp-emoji|avatar|count|loading|tracker/i.test(src);
                if (!isUseless) foundImg = src;
            }
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
