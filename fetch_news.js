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
const GEOS_TSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRUveH7tPtcCI0gLuCL7krtgpLPPo_nasbZqxioFhftwSrAykn3jOoJVwPzsJnnl5XzcO8HhP7jpk2_/pub?gid=1455134188&single=true&output=tsv";

function parseFeedRows(rows) {
    return rows.map(row => {
        const c = row.split('\t').map(v => v ? v.trim() : '');
        if (!c[2] && !c[9]) return null;
        return {
            category: c[0] || "General",
            feedName: c[1] || "Unnamed",
            rssUrl: c[2] || "",
            nameChecked: c[4] || c[1] || "Source",
            sheetDesc: c[5] || "",
            lang: (c[6] || "fi").toLowerCase(),
            scope: c[7] || "World",
            isDarkLogo: (c[8] || "").toUpperCase() === "TRUE" || c[8] === "1",
            feedId: c[9] || "",
            parentId: c[10] || ""
        };
    }).filter(f => f !== null);
}

function validateFeedBundles(feeds) {
    const counts = new Map();
    feeds.forEach(feed => {
        if (feed.feedId) counts.set(feed.feedId, (counts.get(feed.feedId) || 0) + 1);
    });
    const roots = new Set(feeds.filter(feed => feed.feedId && !feed.parentId && counts.get(feed.feedId) === 1)
        .map(feed => feed.feedId));
    feeds.forEach(feed => {
        if (!feed.feedId || counts.get(feed.feedId) !== 1) {
            console.warn(`Invalid or duplicate feed ID for ${feed.nameChecked}: ${feed.feedId || '(missing)'}`);
            feed.bundleId = '';
        } else if (feed.parentId && !roots.has(feed.parentId)) {
            console.warn(`Invalid original feed ID for ${feed.nameChecked}: ${feed.parentId}`);
            feed.bundleId = feed.feedId;
        } else {
            feed.bundleId = feed.parentId || feed.feedId;
        }
    });
}

function attachFeedMetadata(articles, feeds) {
    const feedsById = new Map(feeds.filter(feed => feed.feedId).map(feed => [feed.feedId, feed]));
    articles.forEach(article => {
        if (!article) return;
        let feed = feedsById.get(article.feedId);
        if (!feed && !article.feedId) {
            const candidates = feeds.filter(candidate =>
                candidate.nameChecked === article.sourceTitle && candidate.lang === article.lang &&
                (!article.originalRssUrl || candidate.rssUrl === article.originalRssUrl)
            );
            if (candidates.length === 1) feed = candidates[0];
            else console.warn(`Cannot uniquely identify retained article source: ${article.sourceTitle}`);
        }
        if (feed) {
            article.feedId = feed.feedId;
            article.bundleId = feed.bundleId;
        }
    });
}

function buildSourceData(articles, feeds, now) {
    const feedsById = new Map(feeds.filter(feed => feed.feedId).map(feed => [feed.feedId, feed]));
    const sourceStats = { __meta: { last_updated: now.toLocaleString('fi-FI', { timeZone: 'Europe/Helsinki' }) } };
    const articlesBySource = {};
    articles.forEach(art => {
        const key = art.bundleId ? `bundle:${art.bundleId}` : art.sourceTitle;
        const fileKey = art.bundleId
            ? `bundle_${Buffer.from(art.bundleId).toString('hex')}`
            : key.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        if (!articlesBySource[fileKey]) articlesBySource[fileKey] = [];
        articlesBySource[fileKey].push(art);
        if (!sourceStats[key]) {
            sourceStats[key] = {
                file: `${fileKey}.json`, count: 0, category: art.sheetCategory || 'General',
                description: art.sourceDescription || '', lang: art.lang || 'en',
                scope: art.scope || 'World', name: art.sourceTitle, variants: []
            };
        }
        sourceStats[key].count++;
        const feed = feedsById.get(art.feedId);
        if (feed && feed.bundleId) {
            let variant = sourceStats[key].variants.find(item => item.id === feed.feedId);
            if (!variant) {
                variant = {
                    id: feed.feedId, name: feed.nameChecked, lang: feed.lang, scope: feed.scope,
                    category: feed.category, original: feed.feedId === feed.bundleId, count: 0
                };
                sourceStats[key].variants.push(variant);
            }
            variant.count++;
        }
    });
    feeds.forEach(feed => {
        const info = feed.bundleId && sourceStats[`bundle:${feed.bundleId}`];
        if (info && !info.variants.some(variant => variant.id === feed.feedId)) {
            info.variants.push({
                id: feed.feedId, name: feed.nameChecked, lang: feed.lang, scope: feed.scope,
                category: feed.category, original: feed.feedId === feed.bundleId, count: 0
            });
        }
    });
    return { sourceStats, articlesBySource };
}

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
        // --- 1. DAILY CLEANUP LOGIC ---
        let lastCleanDate = "";
        if (fs.existsSync(cleanLogFile)) {
            lastCleanDate = fs.readFileSync(cleanLogFile, 'utf8').trim();
        }

        if (lastCleanDate !== today) {
            console.log(`--- FIRST RUN OF THE DAY: Clearing archives and data.json (${today}) ---`);
            if (fs.existsSync(sourcesDir)) {
                fs.readdirSync(sourcesDir).forEach(file => fs.unlinkSync(path.join(sourcesDir, file)));
            } else {
                fs.mkdirSync(sourcesDir, { recursive: true });
            }
            allArticles = [];
            if (fs.existsSync('data.json')) fs.unlinkSync('data.json');
            fs.writeFileSync(cleanLogFile, today);
        } else {
            console.log(`--- Continuing day: loading existing data ---`);
            if (fs.existsSync('data.json')) {
                allArticles = JSON.parse(fs.readFileSync('data.json', 'utf8'));
            }
        }

        const cacheBuster = `&cb=${Date.now()}`;

        // --- 2. TRANSLATIONS FETCH (RE-INSTATED) ---
        console.log("Updating translations from Sheets...");

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
        console.log("translations.json updated.");

        // --- 2.5 GEOS HIERARCHY FETCH ---
        // A failure here (e.g. the Geos sheet is not published) must not stop the news update;
        // the previously saved location-hierarchy.json stays in use.
        try {
        console.log("Fetching location hierarchy from Sheets...");
        const geosRes = await axios.get(GEOS_TSV_URL + cacheBuster);
        if (typeof geosRes.data !== 'string' || /^\s*<(!doctype|html)/i.test(geosRes.data)) {
            throw new Error("Geos sheet did not return TSV data");
        }
        const geosRows = geosRes.data.split(/\r?\n/).filter(r => r.trim() !== '');
        
        const locationHierarchy = {};
        const locationsByParent = {};
        
        // Parse Geos data: Location | Parent
        geosRows.slice(1).forEach(row => {
            const [location, parent] = row.split('\t').map(v => v ? v.trim() : '');
            if (location) {
                locationHierarchy[location] = {
                    parent: parent || null,
                    children: []
                };
                if (!locationsByParent[parent]) {
                    locationsByParent[parent] = [];
                }
                locationsByParent[parent].push(location);
            }
        });
        
        // Build children arrays
        Object.entries(locationsByParent).forEach(([parent, children]) => {
            if (parent && locationHierarchy[parent]) {
                locationHierarchy[parent].children = children;
            }
        });
        
        fs.writeFileSync('location-hierarchy.json', JSON.stringify(locationHierarchy, null, 2));
        console.log("location-hierarchy.json updated.");
        } catch (geosError) {
            console.warn(`Location hierarchy not updated, keeping existing file: ${geosError.message}`);
        }


        console.log("Fetching feed list from Google Sheets (TSV)...");
        const response = await axios.get(SHEET_TSV_URL + cacheBuster);
        const rows = response.data.split(/\r?\n/).slice(1).filter(row => row.trim() !== '');

        const feeds = parseFeedRows(rows);
        validateFeedBundles(feeds);

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

        // Articles retained from earlier runs may predate feed identifiers.
        attachFeedMetadata(allArticles, feeds);

        // --- 4. DUPLIKAATTIEN POISTO JA SUODATUS ---
        const seenPostUrls = new Map();
        const maxFutureTime = now.getTime() + 10 * 60000;
        allArticles = allArticles.filter(art => {
            if (!art || !art.link || !art.pubDate) return false;
            const cleanUrl = art.link.split('?')[0].split('#')[0].trim().toLowerCase();
            const artTime = new Date(art.pubDate).getTime();
            if (isNaN(artTime) || artTime > maxFutureTime) return false;
            const seen = seenPostUrls.get(cleanUrl);
            if (seen && (!art.bundleId || !art.feedId || seen.bundleId !== art.bundleId || seen.feedIds.has(art.feedId))) return false;
            if (seen) seen.feedIds.add(art.feedId);
            else seenPostUrls.set(cleanUrl, { bundleId: art.bundleId, feedIds: new Set([art.feedId]) });
            return true;
        });

        // --- 5. TALLENNUS ARKISTOIHIN JA TILASTOIHIN (METATIEDOILLA) ---
        const { sourceStats, articlesBySource } = buildSourceData(allArticles, feeds, now);

        if (!fs.existsSync(sourcesDir)) fs.mkdirSync(sourcesDir, { recursive: true });
        Object.keys(articlesBySource).forEach(key => {
            fs.writeFileSync(path.join(sourcesDir, `${key}.json`), JSON.stringify(articlesBySource[key], null, 2));
        });

        // --- 6. HOMEPAGE ARRANGEMENT (ROUND ROBIN) ---
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

        fs.writeFileSync('failed_feeds.txt', failedFeeds.join('\n'));
        console.log(`Success! data.json, stats.json, and translations.json updated.`);
    } catch (error) {
        console.error("Critical error:", error);
        process.exit(1);
    }
}
async function processRSS(feed, allArticles) {
    let feedContent;

    // Set common axios request configuration
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
        // Try first with rss-parser normally
        // Note: rss-parser doesn't directly support axios headers, so if this fails,
        // we automatically go to the catch block where axios uses the User-Agent.
        feedContent = await createParser().parseURL(feed.rssUrl);
    } catch (err) {
        // Exception handling for XML errors, certificate issues, or if server rejects basic request
        console.log(`[EXCEPTION] Fallback fetch: ${feed.nameChecked}`);

        try {
            // Use axios with config defined above (includes User-Agent)
            const response = await axios.get(feed.rssUrl, axiosConfig);

            let xmlData = response.data;
            // Clean up broken XML characters
            xmlData = xmlData.replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[a-f\d]+);)/gi, '&amp;');

            feedContent = await createParser().parseString(xmlData);
        } catch (retryErr) {
            throw new Error(`Fallback fetch failed: ${retryErr.message}`);
        }
    }

    // 1. Extract feed description
    const sourceDescription = cleanupSourceDescription(feed.sheetDesc || (feedContent.description || ""), {
        sourceTitle: feed.nameChecked
    });

    // 2. Extract logo (multi-level fallback system)
    let sourceLogo = null;
    try {
        // Try feed-specified link first, then article link, then RSS URL
        const linkToParse = feedContent.link || (feedContent.items[0] && feedContent.items[0].link) || feed.rssUrl;
        const domain = linkToParse ? new URL(linkToParse).hostname : null;
        sourceLogo = await getSourceLogo(feedContent, domain, feed.nameChecked);
    } catch (e) {
        // If URL is invalid (e.g., just a path), don't crash the process
        console.log(`[WARNING] Logo fetch failed for ${feed.nameChecked}: ${e.message}`);
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
                        console.error("Link correction failed:", articleLink);
                    }
                }
            }

            // --- 3. Image Extraction ---
            let img = null;
            // A) Try standard media fields
            const thumbnailUrl = item.mediaThumbnail?.$?.url || item.mediaThumbnail?.url;
            const mContent = item.mediaContent || item['media:content'];
            if (mContent) {
                const mediaArray = Array.isArray(mContent) ? mContent : [mContent];
                let maxW = 0;
                mediaArray.forEach(m => {
                    const currentUrl = m.url || m.$?.url;
                    const currentWidth = parseInt(m.width || m.$?.width || 0);
                    if (currentUrl && (currentWidth > maxW || !img)) {
                        maxW = currentWidth;
                        img = currentUrl;
                    }
                });
                // A thumbnail that also appears as media content identifies the article image.
                if (thumbnailUrl && mediaArray.some(m => (m.url || m.$?.url) === thumbnailUrl)) {
                    img = thumbnailUrl;
                }
            }
            // B) Try mediaThumbnail
            if (!img && thumbnailUrl) {
                img = thumbnailUrl;
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
                    const source = firstPicture.find('source[data-srcset], source[srcset]').first();
                    if (source.length) {
                        const srcset = source.attr('data-srcset') || source.attr('srcset');
                        if (srcset) {
                            const firstCandidate = srcset.trim().split(',')[0].trim();
                            img = firstCandidate.split(/\s+/)[0] || null;
                        }
                    }
                    if (!img) {
                        const picImg = firstPicture.find('img').first();
                        if (picImg.length) {
                            img = picImg.attr('data-src') || picImg.attr('data-lazy-src') || picImg.attr('src');
                        }
                    }
                }
                // Fallback: any <img>, including common lazy-loading attributes (ignore pixels)
                if (!img) {
                    $c('img').each((_, el) => {
                        const w = $c(el).attr('width');
                        const h = $c(el).attr('height');
                        if (w !== undefined && h !== undefined && parseInt(w) <= 1 && parseInt(h) <= 1) {
                            return true;
                        }
                        const image = $c(el);
                        const srcset = image.attr('data-srcset') || image.attr('srcset');
                        img = image.attr('data-src') || image.attr('data-lazy-src') || image.attr('src');
                        if (!img && srcset) {
                            img = srcset.trim().split(',')[0].trim().split(/\s+/)[0] || null;
                        }
                        return !img;
                    });
                }
            }

            // E) Absolute image URL if needed
            if (img && !img.startsWith('http') && !img.startsWith('//')) {
                const baseUrl = articleLink || feed.rssUrl;
                try {
                    img = new URL(img, baseUrl).href;
                } catch (e) {
                    console.log(`[WARNING] ${feed.nameChecked}: image URL correction failed: ${img}`);
                    img = null;
                }
            }
            // (optional: log images)
            // if (img) console.log(`[IMAGE] ${feed.nameChecked}: image selected: ${img.substring(0, 80)}`);

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
                feedId: feed.feedId,
                bundleId: feed.bundleId,
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

if (require.main === module) {
    run().then(() => {
        console.log("Run completed successfully.");
        process.exit(0);
    }).catch(err => {
        console.error("Run failed:", err);
        process.exit(1);
    });
}

module.exports = {
    extractArticleContent,
    extractArticleContentFromCheerio,
    normalizeContent,
    truncateTextAtBoundary,
    cleanupSnippet,
    cleanupSourceDescription,
    parseFeedRows,
    validateFeedBundles,
    attachFeedMetadata,
    buildSourceData,
    processRSS
};
