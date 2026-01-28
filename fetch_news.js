const axios = require('axios');
const fs = require('fs');
const path = require('path');
const Parser = require('rss-parser');
const cheerio = require('cheerio');

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
        const rows = response.data.split('\n').slice(1);

        const feeds = rows.map(row => {
            if (!row || row.trim() === '') return null;
            const cols = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            if (cols.length < 3) return null; 
            
            return { 
                category: cols[0]?.replace(/^"|"$/g, '').trim() || "Yleinen",
                rssUrl: cols[2]?.replace(/^"|"$/g, '').trim(), 
                scrapeUrl: cols[3]?.replace(/^"|"$/g, '').trim(),
                nameFI: cols[4]?.replace(/^"|"$/g, '').trim(),
                nameEN: cols[5]?.replace(/^"|"$/g, '').trim(),
                lang: cols[6]?.replace(/^"|"$/g, '').trim() || "FI",
                isDarkLogo: (cols[7] || "").toUpperCase().trim() === "TRUE" || cols[7] === "1"
            };
        }).filter(f => f && (f.rssUrl || f.scrapeUrl));

        for (const feed of feeds) {
            try {
                if (feed.rssUrl && feed.rssUrl.length > 10) {
                    await processRSS(feed, allArticles, now);
                } else if (feed.scrapeUrl) {
                    await processScraper(feed, allArticles, now);
                }
                await new Promise(r => setTimeout(r, 600));
            } catch (e) {
                console.error(`Virhe kohteessa ${feed.rssUrl || feed.scrapeUrl}: ${e.message}`);
                failedFeeds.push(`${feed.category}: ${e.message}`);
            }
        }

        // 3. DUPLIKAATTIEN POISTO JA LAJITTELU (Uusin ensin)
        const seenIds = new Set();
        allArticles = allArticles
            .filter(art => {
                if (!art) return false;
                
                // Luodaan uniikki tunniste linkin ja otsikon yhdistelmästä
                const cleanUrl = (art.link || "").split('?')[0].split('#')[0].trim().toLowerCase();
                const cleanTitle = (art.title || "").trim().toLowerCase();
                const uniqueId = cleanUrl + "|" + cleanTitle;

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
    
    // 1. Poimitaan syötteen kuvaus
    const sourceDescription = feedContent.description ? feedContent.description.trim() : "";
    
// 2. Poimitaan logo
    let sourceLogo = feedContent.image ? feedContent.image.url : null;
    
    if (!sourceLogo && feedContent.link) {
        try {
            const domain = new URL(feedContent.link).hostname;
            // Pyydetään 128px kokoa 64px sijaan
            sourceLogo = `https://www.google.com/s2/favicons?sz=128&domain=${domain}`;
            
            // Vaihtoehtoisesti DuckDuckGo, joka on usein laadukkaampi:
            // sourceLogo = `https://icons.duckduckgo.com/ip3/${domain}.ico`;
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
        
        // --- KUVAN POIMINTA ALKAA ---
        let img = null;

        // A) Kokeillaan standardeja mediakenttiä
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

        // B) Jos ei vieläkään löydy (esim. OKFN/ePressi), kaivetaan sisällön seasta
        if (!img) {
            img = extractImageFromContent(item, feed.rssUrl);
        }

        // C) ÄLYKÄS PUHDISTUS
        if (img) {
            if (img.includes('i0.wp.com') || img.includes('wp-content')) {
                if (img.includes('?')) {
                    img = img.split('?')[0];
                }
            }
            
            if (img.startsWith('/') && !img.startsWith('http')) {
                try {
                    const urlObj = new URL(feed.rssUrl);
                    img = `${urlObj.protocol}//${urlObj.hostname}${img}`;
                } catch (e) { img = null; }
            }
            
            if (img && img.includes('guim.co.uk')) {
                img = img.replace('http://', 'https://');
            }
        }
        // --- KUVAN POIMINTA PÄÄTTYY ---

        // --- TEKSTIN POIMINTA ALKAA ---
        // Haetaan raakateksti useasta mahdollisesta kentästä (ePressi käyttää content:encoded)
        const rawContent = item['content:encoded'] || item.contentEncoded || item.content || item.description || "";
        
        // Poistetaan HTML ja ylimääräiset tyhjät
        let cleanText = rawContent
            .replace(/<[^>]*>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        // Jos teksti jäi tyhjäksi tai on vain pisteitä, käytetään otsikkoa varalla
        if (cleanText.length < 10 || cleanText === "...") {
            cleanText = item.title || "";
        }

        const finalSnippet = cleanText.length > 500 
            ? cleanText.substring(0, 500) + "..." 
            : cleanText;
        // --- TEKSTIN POIMINTA PÄÄTTYY ---

        let articleLink = item.link;
        if (articleLink && !articleLink.startsWith('http')) {
            try {
                articleLink = new URL(articleLink, feed.rssUrl).href;
            } catch (e) {
                console.error("Linkin korjaus epäonnistui:", articleLink);
            }
        }

        return {
            title: item.title,
            link: articleLink,
            pubDate: itemDate.toISOString(),
            content: finalSnippet,
            creator: item.creator || item.author || "",
            sourceTitle: feedContent.title || new URL(feed.rssUrl).hostname,
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

async function processRSS(feed, allArticles, now) {
    const feedContent = await parser.parseURL(feed.rssUrl);
    const sourceDescription = feedContent.description ? feedContent.description.trim() : "";
    
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
        
        // --- KUVAN POIMINTA (Päivitetty Access Now / WP tuki) ---
        let img = null;

        // A) Kokeillaan mediakenttiä (Priorisoidaan suurin tai ensimmäinen löytyvä URL)
        let mContent = item.mediaContent || item['media:content'];
        if (mContent) {
            const mediaArray = Array.isArray(mContent) ? mContent : [mContent];
            let maxW = 0;
            mediaArray.forEach(m => {
                const currentUrl = m.url || m.$?.url;
                const currentWidth = parseInt(m.width || m.$?.width || 0);
                // Access Now: Jos URL löytyy, otetaan se. Jos löytyy leveys, suositaan leveintä.
                if (currentUrl) {
                    if (currentWidth >= maxW || !img) {
                        maxW = currentWidth;
                        img = currentUrl;
                    }
                }
            });
        }

        if (!img && item.mediaThumbnail) {
            img = item.mediaThumbnail.$?.url || item.mediaThumbnail.url;
        }

        if (!img && item.enclosure && item.enclosure.url) {
            img = item.enclosure.url;
        }

        // B) Jos ei mediakentissä, kaivetaan tekstin seasta (Sisältää content:encoded)
        if (!img) {
            img = extractImageFromContent(item, feed.rssUrl);
        }

        // C) ÄLYKÄS PUHDISTUS (Vakauttaa Jetpack/WordPress linkit)
        if (img) {
            // Poistetaan WP-parametrit (resize, fit, w, h)
            if (img.includes('?')) {
                img = img.split('?')[0];
            }
            
            // Korjataan suhteelliset polut
            if (img.startsWith('/') && !img.startsWith('http')) {
                try {
                    const urlObj = new URL(feed.rssUrl);
                    img = `${urlObj.protocol}//${urlObj.hostname}${img}`;
                } catch (e) { img = null; }
            }
            
            // Varmistetaan https
            if (img && img.startsWith('//')) img = 'https:' + img;
        }

        // --- TEKSTIN POIMINTA ---
        const rawContent = item['content:encoded'] || item.contentEncoded || item.content || item.description || "";
        let cleanText = rawContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

        if (cleanText.length < 10) cleanText = item.title || "";
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
            sourceTitle: feedContent.title || new URL(feed.rssUrl).hostname,
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

function extractImageFromContent(item, baseUrl) {
    // Access Now ja muut WP-sivut piilottavat kuvat usein content:encoded -kenttään
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
        
        // WP-sivut käyttävät laajasti data-määritteitä lazy loadingiin
        let src = $(el).attr('src') || 
                  $(el).attr('data-src') || 
                  $(el).attr('data-lazy-src') || 
                  $(el).attr('data-orig-file');
        
        // Jos srcset on tarjolla, otetaan sieltä suurin kuva
        if (!src && $(el).attr('srcset')) {
            const sets = $(el).attr('srcset').split(',');
            src = sets[sets.length - 1].trim().split(' ')[0];
        }

        if (src) {
            // Puhdistetaan parametrit heti (esim. ?w=640)
            if (src.includes('?')) {
                src = src.split('?')[0];
            }
            
            // Protokollan korjaus
            if (src.startsWith('//')) {
                src = 'https:' + src;
            } else if (src.startsWith('/') && !src.startsWith('http')) {
                try {
                    const urlObj = new URL(baseUrl);
                    src = `${urlObj.protocol}//${urlObj.hostname}${src}`;
                } catch (e) {}
            }
            
            if (src.startsWith('http')) {
                // Suodatetaan turhat pikselit, hymiöt ja seurantakuvat
                const isUseless = /analytics|doubleclick|pixel|1x1|wp-emoji|avatar|count|sharedaddy|loading|tracker/i.test(src);
                if (!isUseless) {
                    foundImg = src;
                }
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
