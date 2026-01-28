const axios = require('axios');
const fs = require('fs');
const path = require('path');
const Parser = require('rss-parser');
const cheerio = require('cheerio');
const https = require('https');
const http = require('http');

/**
 * CONFIGURATION & AGENTS
 */
const FORCE_CLEAN = true; // Aseta falseksi ensimmäisen onnistuneen ajon jälkeen
const SHEET_CSV_URL = process.env.SHEET_CSV_URL || 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRUveH7tPtcCI0gLuCL7krtgpLPPo_nasbZqxioFhftwSrAykn3jOoJVwPzsJnnl5XzcO8HhP7jpk2_/pub?gid=0&single=true&output=csv';

// Agentit molemmille protokollille
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const httpAgent = new http.Agent();

// Parseri, joka osaa vaihtaa agenttia lennosta
const parser = new Parser({ 
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) OpenMag-Robot-v1' },
    requestOptions: {
        // Tämä funktio valitsee oikean agentin URL-osoitteen perusteella
        agent: function(url) {
            return url.protocol === 'https:' ? httpsAgent : httpAgent;
        }
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

async function run() {
    let failedFeeds = []; 
    let allArticles = [];
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const cleanLogFile = path.join(__dirname, 'last_clean.txt');
    const sourcesDir = path.join(__dirname, 'sources');

    try {
        let lastCleanDate = "";
        if (fs.existsSync(cleanLogFile)) lastCleanDate = fs.readFileSync(cleanLogFile, 'utf8').trim();

        if (FORCE_CLEAN || lastCleanDate !== today) {
            console.log(`--- PUHDISTUS JA TÄYSLAJO (${today}) ---`);
            if (fs.existsSync(sourcesDir)) {
                fs.readdirSync(sourcesDir).forEach(file => fs.unlinkSync(path.join(sourcesDir, file)));
            }
            allArticles = []; 
            fs.writeFileSync(cleanLogFile, today);
        } else if (fs.existsSync('data.json')) {
            allArticles = JSON.parse(fs.readFileSync('data.json', 'utf8'));
        }

        const response = await axios.get(SHEET_CSV_URL + `&cb=${Date.now()}`);
        const rows = response.data.replace(/\r/g, '').split('\n').slice(1);

        const feeds = rows.map(row => {
            if (!row || row.trim() === '') return null;
            const cols = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            const c = cols.map(val => (val || "").replace(/^"|"$/g, '').trim());

            const nameFI = c[7]; 
            const feedName = c[1];
            const finalName = (nameFI && nameFI !== "-") ? nameFI : feedName;

            const rssUrl = c[2]; 
            const scrapeUrl = c[3];
            const negativeLogoVal = (c[11] || "").toUpperCase();
            const isDarkLogo = negativeLogoVal === "TRUE" || negativeLogoVal === "1";

            if (!finalName || finalName === "-" || (!rssUrl && !scrapeUrl)) return null;

            return { category: c[0] || "Yleinen", rssUrl, scrapeUrl, nameFI: finalName, isDarkLogo };
        }).filter(f => f !== null);

        for (const feed of feeds) {
            try {
                if (feed.rssUrl) await processRSS(feed, allArticles, now);
                else if (feed.scrapeUrl) await processScraper(feed, allArticles, now);
                await new Promise(r => setTimeout(r, 400));
            } catch (e) {
                console.error(`Virhe: ${feed.nameFI}: ${e.message}`);
                failedFeeds.push(`${feed.nameFI}: ${e.message}`);
            }
        }

        // Duplikaattien poisto
        const seenIds = new Set();
        allArticles = allArticles.filter(art => {
            if (!art) return false;
            const title = String(art.title || "").trim().toLowerCase();
            const src = String(art.sourceTitle || "").toLowerCase();
            const date = art.pubDate ? art.pubDate.split('T')[0] : "";
            const id = `${title}|${src}|${date}`;
            if (seenIds.has(id) || title.length < 3) return false;
            seenIds.add(id);
            return true;
        }).sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

        // Tallennus
        const stats = { "__meta": { "last_run": now.toISOString(), "article_count": allArticles.length } };
        const bySource = {};

        allArticles.forEach(art => {
            let src = String(art.sourceTitle || "Muu").trim();
            if (src === "-" || src.length < 2) src = "Muu";
            const key = src.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            if (!bySource[key]) bySource[key] = [];
            bySource[key].push(art);
            if (!stats[src]) stats[src] = { file: `${key}.json`, count: 0, category: art.sheetCategory || "Yleinen" };
            stats[src].count++;
        });

        if (!fs.existsSync(sourcesDir)) fs.mkdirSync(sourcesDir, { recursive: true });
        Object.keys(bySource).forEach(k => fs.writeFileSync(path.join(sourcesDir, `${k}.json`), JSON.stringify(bySource[k], null, 2)));

        // Round Robin järjestely
        const days = {};
        allArticles.forEach(art => {
            const d = art.pubDate.split('T')[0];
            if (!days[d]) days[d] = [];
            days[d].push(art);
        });

        let final = []; 
        Object.keys(days).sort().reverse().forEach(d => {
            const srcMap = {};
            days[d].forEach(art => {
                const s = art.sourceTitle || "Muu";
                if (!srcMap[s]) srcMap[s] = [];
                srcMap[s].push(art);
            });
            const sList = Object.keys(srcMap);
            let more = true; let i = 0;
            while (more) {
                more = false;
                sList.forEach(s => { if (srcMap[s][i]) { final.push(srcMap[s][i]); more = true; } });
                i++;
            }
        });

        fs.writeFileSync('data.json', JSON.stringify(final.slice(0, 1000), null, 2));
        fs.writeFileSync('stats.json', JSON.stringify(stats, null, 2));
        console.log(`Valmis! ${allArticles.length} artikkelia.`);
    } catch (e) {
        console.error("Kriittinen virhe:", e);
        process.exit(1);
    }
}

async function processRSS(feed, allArticles, now) {
    // Valitaan oikea agentti Axios-hakuun (jos parser.parseURL epäonnistuu)
    const isHttps = feed.rssUrl.startsWith('https');
    const feedContent = await parser.parseURL(feed.rssUrl);
    
    let sourceLogo = feedContent.image ? feedContent.image.url : null;
    if (!sourceLogo && feedContent.link) {
        try { sourceLogo = `https://www.google.com/s2/favicons?sz=128&domain=${new URL(feedContent.link).hostname}`; } catch(e){}
    }

    const items = feedContent.items.map(item => {
        let itemDate = new Date(item.pubDate || item.isoDate);
        if (isNaN(itemDate.getTime()) || itemDate > now) itemDate = now;
        
        let img = null;
        let mContent = item.mediaContent || item['media:content'];
        if (mContent) {
            const mArr = Array.isArray(mContent) ? mContent : [mContent];
            let maxW = 0;
            mArr.forEach(m => {
                const u = m.url || m.$?.url;
                const w = parseInt(m.width || m.$?.width || 0);
                if (u && (w >= maxW || !img)) { maxW = w; img = u; }
            });
        }
        if (!img) img = extractImageFromContent(item, feed.rssUrl);
        if (img) {
            if (img.includes('?')) img = img.split('?')[0];
            if (img.startsWith('//')) img = 'https:' + img;
        }

        const raw = item['content:encoded'] || item.contentEncoded || item.content || item.description || "";
        let clean = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

        return {
            title: item.title,
            link: item.link,
            pubDate: itemDate.toISOString(),
            content: clean.substring(0, 500),
            sourceTitle: feed.nameFI,
            sheetCategory: feed.category,
            enforcedImage: img,
            sourceLogo: sourceLogo,
            isDarkLogo: feed.isDarkLogo
        };
    });
    allArticles.push(...items);
}

async function processScraper(feed, allArticles, now) {
    const isHttps = feed.scrapeUrl.startsWith('https');
    try {
        const { data } = await axios.get(feed.scrapeUrl, { 
            headers: { 'User-Agent': 'Mozilla/5.0 OpenMag' }, 
            timeout: 15000, 
            httpsAgent: isHttps ? httpsAgent : undefined,
            httpAgent: !isHttps ? httpAgent : undefined
        });
        const $ = cheerio.load(data);
        $('article').get().slice(0, 10).forEach(el => {
            const title = $(el).find('h2, h3, .title').first().text().trim();
            const link = $(el).find('a').first().attr('href');
            if (title && link) {
                allArticles.push({
                    title,
                    link: link.startsWith('http') ? link : new URL(link, feed.scrapeUrl).href,
                    pubDate: now.toISOString(),
                    content: "Lue lisää sivustolta.",
                    sourceTitle: feed.nameFI,
                    sheetCategory: feed.category,
                    enforcedImage: $(el).find('img').first().attr('src'),
                    sourceLogo: `https://www.google.com/s2/favicons?sz=128&domain=${new URL(feed.scrapeUrl).hostname}`,
                    isDarkLogo: feed.isDarkLogo
                });
            }
        });
    } catch (e) { console.error(`Scraper epäonnistui: ${feed.nameFI}`); }
}

function extractImageFromContent(item, baseUrl) {
    const html = (item['content:encoded'] || "") + (item.description || "");
    if (!html) return null;
    const $ = cheerio.load(html);
    const img = $('img').first();
    let src = img.attr('data-orig-file') || img.attr('src') || img.attr('data-src');
    if (src && src.startsWith('/')) { try { src = new URL(src, baseUrl).href; } catch(e){} }
    return src;
}

run();
