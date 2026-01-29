const axios = require('axios');
const fs = require('fs');
const path = require('path');
const Parser = require('rss-parser');
const cheerio = require('cheerio');
const https = require('https');
const http = require('http');

// Agentit SSL-ongelmien ja protokollavirheiden välttämiseksi
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const httpAgent = new http.Agent();

const parser = new Parser({ 
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) OpenMag-Robot-v2' },
    requestOptions: {
        agent: function(url) { return url.protocol === 'https:' ? httpsAgent : httpAgent; }
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
    let allArticles = [];
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const cleanLogFile = path.join(__dirname, 'last_clean.txt');
    const sourcesDir = path.join(__dirname, 'sources');

    try {
        // 1. PUHDISTUSLOGIIKKA (Pakotetaan puhdistus konfliktiarvojen vuoksi)
        console.log(`--- Puhdistetaan ja aloitetaan haku (${today}) ---`);
        if (fs.existsSync(sourcesDir)) {
            fs.readdirSync(sourcesDir).forEach(file => fs.unlinkSync(path.join(sourcesDir, file)));
        }
        allArticles = []; 

        // 2. HAETAAN SYÖTTEET (Päivitetty sarakkeilla 7 ja 11)
        console.log("Haetaan syötelistaa Google Sheetsistä...");
        const response = await axios.get(SHEET_CSV_URL + `&cb=${Date.now()}`);
        const rows = response.data.replace(/\r/g, '').split('\n').slice(1);

        const feeds = rows.map(row => {
            if (!row || row.trim() === '') return null;
            const cols = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            const c = cols.map(v => (v || "").replace(/^"|"$/g, '').trim());

            // Name_FI [7] ensisijainen, Feed name [1] vara
            const finalName = (c[7] && c[7] !== "-") ? c[7] : c[1];
            if (!finalName || (!c[2] && !c[3])) return null;

            return { 
                category: c[0] || "Yleinen",
                rssUrl: c[2], 
                scrapeUrl: c[3], 
                nameFI: finalName, 
                isDarkLogo: c[11] === "TRUE" || c[11] === "1" 
            };
        }).filter(f => f !== null);

        for (const feed of feeds) {
            try {
                if (feed.rssUrl && feed.rssUrl.length > 10) {
                    await processRSS(feed, allArticles, now);
                } else if (feed.scrapeUrl) {
                    await processScraper(feed, allArticles, now);
                }
                await new Promise(r => setTimeout(r, 400));
            } catch (e) {
                console.error(`Virhe: ${feed.nameFI}: ${e.message}`);
            }
        }

        // 3. DUPLIKAATTIEN POISTO (Salliva: Otsikko + Lähde + Päivä)
        const seenIds = new Set();
        allArticles = allArticles.filter(art => {
            if (!art) return false;
            const title = String(art.title || "").trim().toLowerCase();
            const src = String(art.sourceTitle || "").toLowerCase();
            const date = art.pubDate ? art.pubDate.split('T')[0] : "";
            const id = `${title}|${src}|${date}`;
            
            if (seenIds.has(id) || title.length < 5) return false;
            seenIds.add(id);
            return true;
        }).sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

        // 4. TALLENNUS JA ARKISTOINTI
        const sourceStats = { "__meta": { "last_run": now.toISOString(), "article_count": allArticles.length } };
        const articlesBySource = {};

        allArticles.forEach(art => {
            const src = art.sourceTitle || "Muu";
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
            const dList = Object.keys(bySource);
            let more = true; let idx = 0;
            while (more) {
                more = false;
                dList.forEach(s => { if (bySource[s][idx]) { finalSorted.push(bySource[s][idx]); more = true; } });
                idx++;
            }
        });

        fs.writeFileSync('data.json', JSON.stringify(finalSorted.slice(0, 1000), null, 2));
        fs.writeFileSync('stats.json', JSON.stringify(sourceStats, null, 2));
        fs.writeFileSync(cleanLogFile, today);
        console.log(`Valmis! Haettu ${allArticles.length} artikkelia.`);

    } catch (error) {
        console.error("Kriittinen virhe:", error);
        process.exit(1);
    }
}

async function processRSS(feed, allArticles, now) {
    const feedContent = await parser.parseURL(feed.rssUrl);
    let sourceLogo = feedContent.image ? feedContent.image.url : null;
    if (!sourceLogo && feedContent.link) {
        try { sourceLogo = `https://www.google.com/s2/favicons?sz=128&domain=${new URL(feedContent.link).hostname}`; } catch(e){}
    }

    const items = feedContent.items.map(item => {
        let itemDate = new Date(item.pubDate || item.isoDate);
        if (isNaN(itemDate.getTime()) || itemDate > now) itemDate = now;
        
        // KUVAN POIMINTA
        let img = null;
        let mContent = item.mediaContent || item['media:content'];
        if (mContent) {
            const mArr = Array.isArray(mContent) ? mContent : [mContent];
            let maxW = 0;
            mArr.forEach(m => {
                const u = m.url || m.$?.url;
                const w = parseInt(m.width || m.$?.width || 0);
                if (url && (w >= maxW || !img)) { maxW = w; img = u; }
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
    const html = (item['content:encoded'] || "") + (item.description || "") + (item.content || "");
    if (!html) return null;
    const $ = cheerio.load(html);
    const img = $('img').first();
    let src = img.attr('data-orig-file') || img.attr('src') || img.attr('data-src');
    if (src && src.startsWith('/')) { try { src = new URL(src, baseUrl).href; } catch(e){} }
    return src;
}

run();
