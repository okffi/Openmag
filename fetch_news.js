const axios = require('axios');
const fs = require('fs');
const path = require('path');
const Parser = require('rss-parser');
const cheerio = require('cheerio');
const https = require('https');
const http = require('http');
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const httpAgent = new http.Agent();
const CONTENT_HTML_LIMIT = 1200;
const SNIPPET_TEXT_LIMIT = 200;
const CONTENT_BLOCK_SELECTOR = 'p, li, blockquote, pre';

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
];

function getRandomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function normalizeContent(text) {
    if (!text) return text;
    // Decode common HTML entities for non-breaking spaces
    text = text.replace(/&nbsp;/gi, ' ');
    text = text.replace(/&#160;/g, ' ');
    text = text.replace(/&amp;/gi, '&');
    text = text.replace(/&quot;/gi, '"');
    text = text.replace(/&#39;/g, "'");
    text = text.replace(/&lt;/gi, '<');
    text = text.replace(/&gt;/gi, '>');
    // Remove invisible/zero-width Unicode characters and directional marks
    text = text.replace(/[\u200B-\u200D\uFEFF\u2060\u061C\u200E\u200F\u180E]/g, '');
    // Normalize non-breaking spaces to regular spaces
    text = text.replace(/\u00A0/g, ' ');
    text = text.replace(/\r\n/g, '\n');
    text = text.replace(/[ \t]+\n/g, '\n');
    text = text.replace(/\n{3,}/g, '\n\n');
    // Collapse multiple consecutive spaces to a single space
    text = text.replace(/ {2,}/g, ' ');
    return text.trim();
}

function escapeHtml(text) {
    if (!text) return "";
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function truncateTextAtBoundary(text, maxLength) {
    const normalized = normalizeContent(text);
    if (!normalized || normalized.length <= maxLength) return normalized;

    const truncated = normalized.substring(0, maxLength + 1);
    const boundary = truncated.lastIndexOf(' ');

    if (boundary > Math.floor(maxLength * 0.6)) {
        return truncated.substring(0, boundary).trim();
    }

    return normalized.substring(0, maxLength).trim();
}

function escapeRegExp(text) {
    return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripMarkupToText(text) {
    if (!text) return "";
    return normalizeContent(String(text)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|li|blockquote|pre|div|section|article|h[1-6])>/gi, '\n\n')
        .replace(/<[^>]*>/g, ' '));
}

function comparableText(text) {
    return stripMarkupToText(text)
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '');
}

function isCallToActionOnly(text) {
    return /^(?:read|lue)\b.{0,50}$/i.test(text);
}

function stripKnownBoilerplate(text, title = "") {
    let cleaned = stripMarkupToText(text);
    const normalizedTitle = stripMarkupToText(title);

    cleaned = cleaned.replace(/\bThe post .+? appeared first on .+?(?=(?:[.!?](?:\s|$))|$)/gi, ' ');
    cleaned = cleaned.replace(/\b(?:admin|editor|staff)\b[^.!?\n]*\b(?:mon|tue|wed|thu|fri|sat|sun)\b[^.!?\n]*/gi, ' ');

    if (normalizedTitle) {
        const titlePrefix = new RegExp(`^${escapeRegExp(normalizedTitle)}(?:\\s*[|:–—-]\\s*|\\s+)`, 'i');
        cleaned = cleaned.replace(titlePrefix, '');
    }

    return normalizeContent(cleaned);
}

function isMetadataOnly(text) {
    if (!text) return true;
    const normalized = normalizeContent(text);

    return /^the post .+ appeared first on .+\.?$/i.test(normalized)
        || /^(?:admin|editor|staff|kirjoittanut|posted by|by)\b.*(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\b(?:mon|tue|wed|thu|fri|sat|sun)\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b)/i.test(normalized)
        || /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}(?:\s+(?:klo|at)\s+\d{1,2}[:.]\d{2}(?:[:.]\d{2})?)?$/i.test(normalized);
}

function isTitleLike(text, title = "") {
    const candidateComparable = comparableText(text);
    return Boolean(candidateComparable && title && candidateComparable === comparableText(title));
}

function cleanupSnippet(text, { title = "", maxLength = SNIPPET_TEXT_LIMIT } = {}) {
    const normalized = stripMarkupToText(text);
    if (!normalized) return "";

    const cleaned = normalized
        .split(/\n{2,}/)
        .map(segment => stripKnownBoilerplate(segment, title))
        .filter(segment => comparableText(segment) && !isCallToActionOnly(segment) && !isMetadataOnly(segment) && !isTitleLike(segment, title));

    const joined = normalizeContent(cleaned.join('\n\n'));
    if (!joined || isTitleLike(joined, title) || isMetadataOnly(joined)) return "";

    return truncateTextAtBoundary(joined, maxLength);
}

function isGenericSourceDescription(text, sourceTitle = "") {
    if (!text) return true;
    const normalized = stripMarkupToText(text);

    return comparableText(normalized) === comparableText(sourceTitle)
        || /^(?:latest|recent)\s+(?:news|updates|posts|articles|stories|press releases?)(?:\s+from\s+.+)?$/i.test(normalized)
        || /^(?:news|updates|posts|articles|stories|press releases?|blog|blogi|homepage|home)$/i.test(normalized)
        || /^uusimmat\s+(?:uutiset|tiedotteet|artikkelit)$/i.test(normalized)
        || /^tiedotteiden\s+tehokas\s+julkaisukanava$/i.test(normalized);
}

function cleanupSourceDescription(text, { sourceTitle = "" } = {}) {
    const cleaned = stripKnownBoilerplate(text);
    if (!cleaned || isMetadataOnly(cleaned) || isGenericSourceDescription(cleaned, sourceTitle)) return "";
    return cleaned;
}

function extractContentBlocks($c) {
    return $c(CONTENT_BLOCK_SELECTOR)
        .map((_, el) => {
            const text = normalizeContent($c(el).text().replace(/\s+/g, ' '));
            if (!text) return null;
            return {
                html: $c.html(el) || "",
                text
            };
        })
        .get()
        .filter(Boolean);
}

function buildHtmlContent($c, blocks, maxLength = CONTENT_HTML_LIMIT) {
    if (blocks.length) {
        const htmlParts = [];
        let textLength = 0;

        for (const block of blocks) {
            if (htmlParts.length && textLength + block.text.length > maxLength) break;
            htmlParts.push(block.html);
            textLength += block.text.length;
        }

        return htmlParts.join('\n') || blocks[0].html;
    }

    const htmlContent = $c('body').html() || $c.html() || "";
    if (htmlContent.length <= maxLength) return htmlContent;

    const fallbackText = truncateTextAtBoundary($c.text().replace(/\s+/g, ' '), maxLength);
    return fallbackText ? `<p>${escapeHtml(fallbackText)}</p>` : htmlContent;
}

function buildTextSnippet($c, blocks, htmlContent, maxLength = SNIPPET_TEXT_LIMIT) {
    if (blocks.length) {
        const snippetParts = [];
        let snippetLength = 0;

        for (const block of blocks) {
            if (snippetParts.length && snippetLength + block.text.length > maxLength) break;
            if (!snippetParts.length && block.text.length > maxLength) {
                return truncateTextAtBoundary(block.text, maxLength);
            }
            snippetParts.push(block.text);
            snippetLength += block.text.length;
        }

        if (snippetParts.length) return snippetParts.join('\n\n');
    }

    return truncateTextAtBoundary((htmlContent || $c.text() || "").replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '), maxLength);
}

function extractArticleContentFromCheerio($c, options = {}) {
    const maxHtmlLength = options.maxHtmlLength || CONTENT_HTML_LIMIT;
    const maxSnippetLength = options.maxSnippetLength || SNIPPET_TEXT_LIMIT;

    const blocks = extractContentBlocks($c);
    const content = buildHtmlContent($c, blocks, maxHtmlLength);
    const snippet = buildTextSnippet($c, blocks, content, maxSnippetLength);

    return { content, snippet };
}

function extractArticleContent(rawContent, options = {}) {
    const $c = cheerio.load(rawContent || "", { decodeEntities: true });
    $c('script, style, iframe, form, figure, figcaption, video, audio').remove();
    $c('*').removeAttr('style').removeAttr('srcset').removeAttr('sizes')
        .removeAttr('fetchpriority').removeAttr('decoding');
    return extractArticleContentFromCheerio($c, options);
}

function createParser() {
    return new Parser({
        headers: {
            'User-Agent': getRandomUserAgent(),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        },
        customFields: {
            item: [
                ['media:content', 'mediaContent', { keepArray: true }],
                ['media:thumbnail', 'mediaThumbnail'],
                ['enclosure', 'enclosure'],
                ['content:encoded', 'contentEncoded']
            ]
        }
    });
}

const SHEET_TSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRUveH7tPtcCI0gLuCL7krtgpLPPo_nasbZqxioFhftwSrAykn3jOoJVwPzsJnnl5XzcO8HhP7jpk2_/pub?gid=0&single=true&output=tsv";
const TRANSLATIONS_TSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRUveH7tPtcCI0gLuCL7krtgpLPPo_nasbZqxioFhftwSrAykn3jOoJVwPzsJnnl5XzcO8HhP7jpk2_/pub?gid=204734258&single=true&output=tsv";

async function getSourceLogo(feedContent, domain, sourceName) {
    // 1. Check multiple RSS feed image metadata fields
    if (feedContent) {
        const rssLogo = (feedContent.image && feedContent.image.url) ||
            (feedContent.logo && feedContent.logo.url) ||
            (feedContent.icon && feedContent.icon.url) ||
            (feedContent.itunes && feedContent.itunes.image && feedContent.itunes.image.url);
        if (rssLogo) {
            console.log(`[LOGO] ${sourceName}: RSS feed image: ${rssLogo.substring(0, 80)}`);
            return rssLogo;
        }
    }

    if (!domain) return null;

    // 2. Try favicon/logo services in order
    const services = [
        { name: 'Google Favicon', url: `https://www.google.com/s2/favicons?sz=128&domain=${domain}` },
        { name: 'DuckDuckGo Icon', url: `https://icons.duckduckgo.com/ip3/${domain}.ico` },
        { name: 'Bing Favicon', url: `https://www.bing.com/favicon.ico?domain=${domain}` },
        { name: 'Direct favicon', url: `https://${domain}/favicon.ico` },
        { name: 'Apple touch icon', url: `https://${domain}/apple-touch-icon.png` },
        { name: 'Clearbit Logo', url: `https://logo.clearbit.com/${domain}` },
    ];

    for (const service of services) {
        try {
            await axios.head(service.url, {
                timeout: 3000,
                validateStatus: s => s < 400,
                httpsAgent: httpsAgent
            });
            console.log(`[LOGO] ${sourceName}: ${service.name}: ${service.url}`);
            return service.url;
        } catch (e) {
            // try next service
        }
    }

    console.log(`[LOGO] ${sourceName}: all logo sources failed`);
    return null;
}

async function run() {
    let failedFeeds = [];
    let allArticles = [];
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const cleanLogFile = path.join(__dirname, 'last_clean.txt');
    const sourcesDir = path.join(__dirname, 'sources');

    try {
        // --- 1. PÄIVITTÄINEN PUHDISTUSLOGIIKKA ---
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

        const cacheBuster = `&cb=${Date.now()}`;

        // --- 2. KÄÄNNÖSTEN HAKU (RE-INSTATED) ---
        console.log("Päivitetään käännökset Sheetsistä...");

        const transRes = await axios.get(TRANSLATIONS_TSV_URL + cacheBuster);
        const transRows = transRes.data.split(/\r?\n/).filter(r => r.trim() !== '');

        // 1. Parse header row for language columns
        const header = transRows[0].split('\t').map(v => v.trim());
        const langCols = header.slice(2); // skip Group and Key
        const transObj = {};
        langCols.forEach(lang => { transObj[lang] = {}; });

        // 2. Parse translation rows
        transRows.slice(1).forEach(row => {
            const fields = row.split('\t').map(v => v ? v.trim() : '');
            const group = fields[0], key = fields[1];
            if (key) {
                langCols.forEach((lang, idx) => {
                    transObj[lang][key] = fields[idx + 2] || "";
                });
            }
        });

        fs.writeFileSync('translations.json', JSON.stringify(transObj, null, 2));
        console.log("translations.json päivitetty.");


        // --- 3. SYÖTTEIDEN HAKU ---
        console.log("Haetaan syötelistaa Google Sheetsistä (TSV)...");
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

        // 3.1 RSS-HAKU
        for (const feed of feeds.filter(f => f.rssUrl && f.rssUrl.length > 10)) {
            try {
                console.log(`[RSS] ${feed.nameChecked}: ${feed.rssUrl}`);
                await processRSS(feed, allArticles, now);
                await new Promise(r => setTimeout(r, 600));
            } catch (e) {
                console.error(`RSS-virhe kohteessa ${feed.nameChecked}: ${e.message}`);
                failedFeeds.push(`RSS: ${feed.nameChecked}: ${e.message}`);
            }
        }

        // 3.2 SCRAPERIT
        for (const feed of feeds.filter(f => f.scrapeUrl && !f.rssUrl)) {
            try {
                console.log(`[SCRAPE] ${feed.nameChecked}: ${feed.scrapeUrl}`);
                await processScraper(feed, allArticles, now);
                await new Promise(r => setTimeout(r, 1000));
            } catch (e) {
                console.error(`Scraper-virhe kohteessa ${feed.nameChecked}: ${e.message}`);
                failedFeeds.push(`SCRAPE: ${feed.nameChecked}: ${e.message}`);
            }
        }

        // --- 4. DUPLIKAATTIEN POISTO JA SUODATUS ---
        const seenPostUrls = new Set();
        const maxFutureTime = now.getTime() + 10 * 60000;
        allArticles = allArticles.filter(art => {
            if (!art || !art.link || !art.pubDate) return false;
            const cleanUrl = art.link.split('?')[0].split('#')[0].trim().toLowerCase();
            const artTime = new Date(art.pubDate).getTime();
            if (seenPostUrls.has(cleanUrl) || isNaN(artTime) || artTime > maxFutureTime) return false;
            seenPostUrls.add(cleanUrl);
            return true;
        });

        // --- 5. TALLENNUS ARKISTOIHIN JA TILASTOIHIN (METATIEDOILLA) ---
        const sourceStats = {
            "__meta": {
                "last_updated": now.toLocaleString('fi-FI', { timeZone: 'Europe/Helsinki' })
            }
        };
        const articlesBySource = {};

        allArticles.forEach(art => {
            const srcName = art.sourceTitle;
            const fileKey = srcName.replace(/[^a-z0-9]/gi, '_').toLowerCase();

            if (!articlesBySource[fileKey]) articlesBySource[fileKey] = [];
            articlesBySource[fileKey].push(art);

            if (!sourceStats[srcName]) {
                sourceStats[srcName] = {
                    file: `${fileKey}.json`,
                    count: 0,
                    category: art.sheetCategory || "General",
                    description: art.sourceDescription || "",
                    lang: art.lang || "en",
                    scope: art.scope || "World"
                };
            }
            sourceStats[srcName].count++;
        });

        if (!fs.existsSync(sourcesDir)) fs.mkdirSync(sourcesDir, { recursive: true });
        Object.keys(articlesBySource).forEach(key => {
            fs.writeFileSync(path.join(sourcesDir, `${key}.json`), JSON.stringify(articlesBySource[key], null, 2));
        });

        // --- 6. ETUSIVUN JÄRJESTELY (ROUND ROBIN) ---
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
            Object.keys(bySource).forEach(src => {
                bySource[src] = bySource[src]
                    .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
                    .slice(0, 5);
            });
            const daySources = Object.keys(bySource);
            let i = 0, hasItems = true;
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

        // --- 7. LOPULLINEN TALLENNUS ---
        fs.writeFileSync('data.json', JSON.stringify(finalSorted.slice(0, 1000), null, 2));
        fs.writeFileSync('stats.json', JSON.stringify(sourceStats, null, 2));

        if (failedFeeds.length > 0) fs.writeFileSync('failed_feeds.txt', failedFeeds.join('\n'));
        console.log(`Success! data.json, stats.json ja translations.json päivitetty.`);
    } catch (error) {
        console.error("Kriittinen virhe:", error);
        process.exit(1);
    }
}
async function processRSS(feed, allArticles) {
    let feedContent;

    // Määritetään yhteiset asetukset axios-pyyntöjä varten
    const axiosConfig = {
        timeout: 15000,
        headers: {
            'User-Agent': getRandomUserAgent(),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.google.com/',
            'Cache-Control': 'no-cache',
        },
        httpsAgent: typeof httpsAgent !== 'undefined' ? httpsAgent : undefined
    };

    try {
        // Yritetään ensin normaalisti rss-parserilla
        // Huom: rss-parser ei tue suoraan axios-headersseja, joten jos tämä epäonnistuu,
        // mennään automaattisesti catch-lohkoon, jossa axios käyttää User-Agentia.
        feedContent = await createParser().parseURL(feed.rssUrl);
    } catch (err) {
        // Poikkeuslogiikka XML-virheille, sertifikaattivioille tai jos palvelin hylkää peruspyynnön
        console.log(`[POIKKEUS] Vikasietoinen haku: ${feed.nameChecked}`);

        try {
            // Käytetään axiosia yllä määritellyllä configilla (sisältää User-Agentin)
            const response = await axios.get(feed.rssUrl, axiosConfig);

            let xmlData = response.data;
            // Puhdistetaan rikkonaiset XML-merkit
            xmlData = xmlData.replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[a-f\d]+);)/gi, '&amp;');

            feedContent = await createParser().parseString(xmlData);
        } catch (retryErr) {
            throw new Error(`Vikasietoinen haku epäonnistui: ${retryErr.message}`);
        }
    }

    // 1. Poimitaan syötteen kuvaus
    const sourceDescription = cleanupSourceDescription(feed.sheetDesc || (feedContent.description || ""), {
        sourceTitle: feed.nameChecked
    });

    // 2. Poimitaan logo (monitasoinen varajärjestelmä)
    let sourceLogo = null;
    try {
        // Yritetään ensin syötteen ilmoittamaa linkkiä, sitten uutislinkkiä, ja lopuksi RSS-osoitetta
        const linkToParse = feedContent.link || (feedContent.items[0] && feedContent.items[0].link) || feed.rssUrl;
        const domain = linkToParse ? new URL(linkToParse).hostname : null;
        sourceLogo = await getSourceLogo(feedContent, domain, feed.nameChecked);
    } catch (e) {
        // Jos URL on edelleen viallinen (esim. pelkkä polku), ei kaadeta ajoa
        console.log(`[VAROITUS] Logon haku epäonnistui kohteelle ${feed.nameChecked}: ${e.message}`);
    }

    const items = feedContent.items
        .map(item => {
            // --- 1. Date: robust, only keep valid dates ---
            const rawDate = item.pubDate || item.published || item.updated || item.isoDate || null;
            let isoDate = null;
            if (rawDate) {
                const d = new Date(rawDate);
                if (!isNaN(d.getTime())) isoDate = d.toISOString();
            }

            // --- 2. Robust Link Extraction (Atom & RSS) ---
            let articleLink = "";
            if (typeof item.link === "string") {
                articleLink = item.link;
            } else if (Array.isArray(item.link)) {
                const alternate = item.link.find(l => l.rel === 'alternate') || item.link[0];
                articleLink = alternate && alternate.href ? alternate.href : "";
            } else if (item.link && item.link.href) {
                articleLink = item.link.href;
            }
            if (articleLink) {
                if (articleLink.startsWith('https:/') && !articleLink.startsWith('https://')) {
                    articleLink = articleLink.replace('https:/', 'https://');
                }
                if (!articleLink.startsWith('http')) {
                    try {
                        articleLink = new URL(articleLink, feed.rssUrl).href;
                    } catch (e) {
                        console.error("Linkin korjaus epäonnistui:", articleLink);
                    }
                }
            }

            // --- 3. Image Extraction ---
            let img = null;
            // A) Try standard media fields
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
            // B) Try mediaThumbnail
            if (!img && item.mediaThumbnail) {
                img = item.mediaThumbnail.$?.url || item.mediaThumbnail.url;
            }
            // C) Try enclosure
            if (!img && item.enclosure && item.enclosure.url) {
                img = item.enclosure.url;
            }

            // --- 4. Content Extraction & Cleaning ---
            const rawContent = item['content:encoded'] || item.contentEncoded || item.content || item.description || "";
            const $c = cheerio.load(rawContent, { decodeEntities: true });

            // D) If no image yet, try finding an image from HTML content
            if (!img) {
                // Try <picture>
                const firstPicture = $c('picture').first();
                if (firstPicture.length) {
                    const source = firstPicture.find('source[srcset]').first();
                    if (source.length) {
                        const srcset = source.attr('srcset');
                        if (srcset) {
                            const firstCandidate = srcset.trim().split(',')[0].trim();
                            img = firstCandidate.split(/\s+/)[0] || null;
                        }
                    }
                    if (!img) {
                        const picImg = firstPicture.find('img').first();
                        if (picImg.length) img = picImg.attr('src');
                    }
                }
                // Fallback: any <img> (ignore pixels)
                if (!img) {
                    $c('img').each((_, el) => {
                        const w = $c(el).attr('width');
                        const h = $c(el).attr('height');
                        if (w !== undefined && h !== undefined && parseInt(w) <= 1 && parseInt(h) <= 1) {
                            return true;
                        }
                        img = $c(el).attr('src');
                        return false;
                    });
                }
            }

            // E) Absolute image URL if needed
            if (img && !img.startsWith('http') && !img.startsWith('//')) {
                const baseUrl = articleLink || feed.rssUrl;
                try {
                    img = new URL(img, baseUrl).href;
                } catch (e) {
                    console.log(`[VAROITUS] ${feed.nameChecked}: kuva-URL:n korjaus epäonnistui: ${img}`);
                    img = null;
                }
            }
            // (optional: log images)
            // if (img) console.log(`[KUVA] ${feed.nameChecked}: kuva valittu: ${img.substring(0, 80)}`);

            // F) Clean up unwanted tags and attributes in HTML
            $c('img').each((_, el) => {
                const w = $c(el).attr('width');
                const h = $c(el).attr('height');
                if (w !== undefined && h !== undefined && parseInt(w) <= 1 && parseInt(h) <= 1) {
                    $c(el).remove();
                }
            });
            $c('script, style, iframe, form, figure, figcaption, video, audio').remove();
            $c('*').removeAttr('style').removeAttr('srcset').removeAttr('sizes')
                .removeAttr('fetchpriority').removeAttr('decoding');
            // G) Safe HTML for detail view
            const { content: htmlContent, snippet: baseSnippet } = extractArticleContentFromCheerio($c);

            // H) Safe plaintext snippet for list views
            let textSnippet = cleanupSnippet(baseSnippet, { title: item.title });
            if (!textSnippet) {
                textSnippet = cleanupSnippet(htmlContent, { title: item.title });
            }

            // I) Final image URL cleaning
            let finalImg = img && typeof img === "string" ? img.replace(/&amp;/g, '&') : null;

            // J) Description fallback
            const finalDescription = sourceDescription;

            return {
                title: normalizeContent(item.title),
                link: articleLink,
                pubDate: isoDate,
                content: htmlContent,
                snippet: textSnippet,
                creator: item.creator || item.author || "",
                sourceTitle: feed.nameChecked,
                sheetCategory: feed.category,
                enforcedImage: finalImg,
                sourceDescription: finalDescription,
                sourceLogo: sourceLogo,
                lang: feed.lang,
                scope: feed.scope,
                isDarkLogo: feed.isDarkLogo,
                originalRssUrl: feed.rssUrl
            };
        })
        .filter(item => item && item.pubDate); // Only keep items with valid date
    allArticles.push(...items);
}

async function processScraper(feed, allArticles, now) {
    const urlObj = new URL(feed.scrapeUrl);
    const domain = urlObj.hostname.replace('www.', '');
    const scraperPath = path.join(__dirname, 'scrapers', `${domain}.js`);

    try {
        // Tarkistetaan löytyykö sääntöä ennen kuin edes ladataan sivua
        if (!fs.existsSync(scraperPath)) {
            console.log(`[SCRAPE] No custom script: ${domain}.`);
            return;
        }

        const scraperRule = require(scraperPath);
        const { data } = await axios.get(feed.scrapeUrl, {
            headers: {
                'User-Agent': getRandomUserAgent(),
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://www.google.com/',
                'Cache-Control': 'no-cache',
            },
            timeout: 15000
        });

        const $ = cheerio.load(data);
        $('script, style, iframe, form').remove();

        const selector = scraperRule.listSelector || 'article';
        const elements = $(selector).get().slice(0, 10);
        const sourceDescription = cleanupSourceDescription(feed.sheetDesc || "", {
            sourceTitle: feed.nameChecked || domain
        });

        for (const el of elements) {
            let item = await scraperRule.parse($, el, axios, cheerio);

            if (item && item.title && item.link) {
                const fullLink = item.link.startsWith('http') ? item.link : new URL(item.link, feed.scrapeUrl).href;
                let finalImg = item.enforcedImage;
                if (finalImg && !finalImg.startsWith('http')) {
                    finalImg = new URL(finalImg, fullLink).href;
                }

                if (!item.pubDate) {
                    console.warn(`Skipping scraped article with missing pubDate in source: ${feed.nameChecked || domain}`);
                    continue;
                }

                allArticles.push({
                    title: item.title,
                    link: fullLink,
                    pubDate: item.pubDate,
                    content: item.content || "",
                    creator: item.creator || "",
                    sourceTitle: feed.nameChecked || domain,
                    sheetCategory: feed.category,
                    enforcedImage: finalImg,
                    sourceDescription: sourceDescription,
                    sourceLogo: await getSourceLogo(null, domain, feed.nameChecked || domain),
                    lang: feed.lang,
                    scope: feed.scope,
                    isDarkLogo: feed.isDarkLogo,
                    originalRssUrl: feed.rssUrl || ""
                });
            }
        }
    } catch (err) {
        console.error(`Scraper epäonnistui kohteelle ${domain}: ${err.message}`);
    }
}

if (require.main === module) {
    run().then(() => {
        console.log("Ajo suoritettu loppuun.");
        process.exit(0);
    }).catch(err => {
        console.error("Ajo epäonnistui:", err);
        process.exit(1);
    });
}

module.exports = {
    extractArticleContent,
    extractArticleContentFromCheerio,
    normalizeContent,
    truncateTextAtBoundary,
    cleanupSnippet,
    cleanupSourceDescription
};
