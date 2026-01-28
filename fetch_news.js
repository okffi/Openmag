const axios = require('axios');
const fs = require('fs');
const path = require('path');
const Parser = require('rss-parser');
const cheerio = require('cheerio');
const https = require('https');

/**
 * CONFIGURATION & AGENTS
 */
const FORCE_CLEAN = true; // MUUTA TÄMÄ FALSEKSI, KUN OLET AJANUT KERRAN ONNISTUNEESTI!
const SHEET_CSV_URL = process.env.SHEET_CSV_URL || 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRUveH7tPtcCI0gLuCL7krtgpLPPo_nasbZqxioFhftwSrAykn3jOoJVwPzsJnnl5XzcO8HhP7jpk2_/pub?gid=0&single=true&output=csv';

const agent = new https.Agent({ rejectUnauthorized: false });
const parser = new Parser({ 
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) OpenMag-Robot-v1' },
    requestOptions: { agent: agent },
    customFields: {
        item: [
            ['media:content', 'mediaContent', {keepArray: true}],
            ['media:thumbnail', 'mediaThumbnail'],
            ['enclosure', 'enclosure'],
            ['content:encoded', 'contentEncoded']
        ] 
    }
});

async function run() {
    let failedFeeds = []; 
    let allArticles = [];
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const cleanLogFile = path.join(__dirname, 'last_clean.txt');
    const sourcesDir = path.join(__dirname, 'sources');

    try {
        // 1. PUHDISTUSLOGIIKKA
        let lastCleanDate = "";
        if (fs.existsSync(cleanLogFile)) lastCleanDate = fs.readFileSync(cleanLogFile, 'utf8').trim();

        if (FORCE_CLEAN || lastCleanDate !== today) {
            console.log(`--- PUHDISTETAAN JA HAETAAN KAIKKI UUDELLEEN (${today}) ---`);
            if (fs.existsSync(sourcesDir)) {
                fs.readdirSync(sourcesDir).forEach(file => fs.unlinkSync(path.join(sourcesDir, file)));
            }
            allArticles = []; 
            fs.writeFileSync(cleanLogFile, today);
        } else if (fs.existsSync('data.json')) {
            allArticles = JSON.parse(fs.readFileSync('data.json', 'utf8'));
        }

        // 2. CSV-LUKU (Uudet sarakkeet)
        console.log("Haetaan syötelistaa...");
        const response = await axios.get(SHEET_CSV_URL + `&cb=${Date.now()}`);
        const rows = response.data.replace(/\r/g, '').split('\n').slice(1);

        const feeds = rows.map(row => {
            if (!row || row.trim() === '') return null;
            const cols = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            const c = cols.map(val => (val || "").replace(/^"|"$/g, '').trim());

            // LOGIIKKA: Priorisoi Name_FI [7], fallback Feed name [1]
            const nameFI = c[7]; 
            const feedName = c[1];
            const finalName = (nameFI && nameFI !== "-") ? nameFI : feedName;

            const rssUrl = c[2]; // RSS URL default (en)
            const scrapeUrl = c[3];
            const negativeLogoVal = (c[11] || "").toUpperCase();
            const isDarkLogo = negativeLogoVal === "TRUE" || negativeLogoVal === "1";

            if (!finalName || finalName === "-" || (!rssUrl && !scrapeUrl)) return null;

            return { 
                category: c[0] || "Yleinen",
                rssUrl: rssUrl, 
                scrapeUrl: scrapeUrl,
                nameFI: finalName,
                isDarkLogo: isDarkLogo
            };
        }).filter(f => f !== null);

        for (const feed of feeds) {
            try {
                if (feed.rssUrl) await processRSS(feed, allArticles, now);
                else if (feed.scrapeUrl) await processScraper(feed, allArticles, now);
                await new Promise(r => setTimeout(r, 500));
            } catch (e) {
                console.error(`Virhe: ${feed.nameFI}: ${e.message}`);
                failedFeeds.push(`${feed.nameFI}: ${e.message}`);
            }
        }

        // 3. DUPLIKAATTIEN POISTO (Otsikko + Lähde + Päivä)
        const seenIds = new Set();
        allArticles = allArticles
            .filter(art => {
                if (!art) return false;
                const cleanTitle = String(art.title || "").trim().toLowerCase();
                const source = String(art.sourceTitle || "").toLowerCase();
                const datePart = art.pubDate ? art.pubDate.split('T')[0] : "";
                const uniqueId = `${cleanTitle}|${source}|${datePart}`;

                if (seenIds.has(uniqueId) || cleanTitle.length < 3) return false;
                seenIds.add(uniqueId);
                return true;
            })
            .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

        // 4. TALLENNUS JA TILASTOT
        const sourceStats = { "__meta": { "last_run": now.toISOString(), "article_count": allArticles.length } };
        const articlesBySource = {};

        allArticles.forEach(art => {
            let src = String(art.sourceTitle || "Muu").trim();
            if (src === "-" || src.length < 2) src = "Muu";
            const fileKey = src.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            
            if (!articlesBySource[fileKey]) articlesBySource[fileKey] = [];
            articlesBySource[fileKey].push(art);
            
            if (!sourceStats[src]) {
                sourceStats[src] = { file: `${fileKey}.json`, count: 0, category: art.sheetCategory || "Yleinen" };
            }
            sourceStats[src].count++;
        });

        if (!fs.existsSync(sourcesDir)) fs.mkdirSync(sourcesDir, { recursive: true });
        Object.keys(articlesBySource).forEach(key => {
            fs.writeFileSync(path.join(sourcesDir, `${key}.json`), JSON.stringify(articlesBySource[key], null, 2));
        });

        // 5. ETUSIVUN JÄRJESTELY (Round Robin)
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
                const s = art.sourceTitle || "Muu";
                if (!bySource[s]) bySource[s] = [];
                bySource[s].push(art);
            });
            const dSources = Object.keys(bySource);
            let hasItems = true; let idx = 0;
            while (hasItems) {
                hasItems = false;
                dSources.forEach(s => {
                    if (bySource[s][idx]) { finalSorted.push(bySource[s][idx]); hasItems = true; }
                });
                idx++;
            }
        });

        fs.writeFileSync('data.json', JSON.stringify(finalSorted.slice(0, 1000), null, 2));
        fs.writeFileSync('stats.json', JSON.stringify(sourceStats, null, 2));
        if (failedFeeds.length > 0) fs.writeFileSync('failed_feeds.txt', failedFeeds.join('\n'));
        console.log(`Valmis! ${allArticles.length} artikkelia.`);

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
        try { sourceLogo = `https://www.google.com/s2/favicons?sz=128&domain=${new URL(feedContent.link).hostname}`; } catch(e){}
    }

    const items = feedContent.items.map(item => {
        let itemDate = new Date(item.pubDate || item.isoDate);
        if (isNaN(itemDate.getTime()) || itemDate > now) itemDate = now;
        
        // KUVAN POIMINTA (Access Now + WP tuki)
        let img = null;
        let mContent = item.mediaContent || item['media:content'];
        if (mContent) {
            const mArray = Array.isArray(mContent) ? mContent : [mContent];
            let maxW = 0;
            mArray.forEach(m => {
                const url = m.url || m.$?.url;
                const w = parseInt(m.width || m.$?.width || 0);
                if (url && (w >= maxW || !img)) { maxW = w; img = url; }
            });
        }
        if (!img) img = extractImageFromContent(item, feed.rssUrl);
        if (img) {
            if (img.includes('?')) img = img.split('?')[0];
            if (img.startsWith('//')) img = 'https:' + img;
        }

        const raw = item['content:encoded'] || item.contentEncoded || item.content || item.description || "";
        let clean = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        if (clean.length < 10) clean = item.title || "";

        return {
            title: item.title,
            link: item.link,
            pubDate: itemDate.toISOString(),
            content: clean.substring(0, 500),
            creator: item.creator || item.author || "",
            sourceTitle: feed.nameFI,
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
    const domain = new URL(feed.scrapeUrl).hostname.replace('www.', '');
    try {
        const { data } = await axios.get(feed.scrapeUrl, { headers: { 'User-Agent': 'Mozilla/5.0 OpenMag' }, timeout: 15000, httpsAgent: agent });
        const $ = cheerio.load(data);
        const elements = $('article').get().slice(0, 10);

        for (const el of elements) {
            const title = $(el).find('h2, h3, .title').first().text().trim();
            const link = $(el).find('a').first().attr('href');
            if (title && link) {
                const fullLink = link.startsWith('http') ? link : new URL(link, feed.scrapeUrl).href;
                allArticles.push({
                    title: title,
                    link: fullLink,
                    pubDate: now.toISOString(),
                    content: "Lue lisää sivustolta.",
                    sourceTitle: feed.nameFI,
                    sheetCategory: feed.category,
                    enforcedImage: $(el).find('img').first().attr('src'),
                    sourceLogo: `https://www.google.com/s2/favicons?sz=128&domain=${domain}`,
                    isDarkLogo: feed.isDarkLogo
                });
            }
        }
    } catch (e) { console.error(`Scraper failed: ${feed.nameFI}`); }
}

function extractImageFromContent(item, baseUrl) {
    const html = (item['content:encoded'] || "") + (item.description || "");
    if (!html) return null;
    const $ = cheerio.load(html);
    const imgTag = $('img').first();
    // Priorisoidaan Access Now / WordPress alkuperäinen kuva
    let src = imgTag.attr('data-orig-file') || imgTag.attr('src') || imgTag.attr('data-src');
    if (src && src.startsWith('/')) { try { src = new URL(src, baseUrl).href; } catch(e){} }
    return src;
}

run();
