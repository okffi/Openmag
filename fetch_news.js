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
        try {
            const transRes = await axios.get(TRANSLATIONS_TSV_URL + cacheBuster);
            const transRows = transRes.data.split(/\r?\n/).slice(1).filter(r => r.trim() !== '');
            const transObj = { fi: {}, en: {}, sv: {}, de: {}, fr: {} };

            transRows.forEach(row => {
                const [group, key, en, fi, sv, de, fr] = row.split('\t').map(v => v ? v.trim() : '');
                if (key) {
                    transObj.en[key] = en; transObj.fi[key] = fi;
                    transObj.sv[key] = sv; transObj.de[key] = de; transObj.fr[key] = fr;
                }
            });
            fs.writeFileSync('translations.json', JSON.stringify(transObj, null, 2));
            console.log("translations.json päivitetty.");
        } catch (e) {
            console.error("Käännösten haku epäonnistui:", e.message);
        }

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
async function processRSS(feed, allArticles, now) {
    let feedContent;

    // Määritetään yhteiset asetukset axios-pyyntöjä varten
    const axiosConfig = {
        timeout: 15000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
        },
        httpsAgent: typeof httpsAgent !== 'undefined' ? httpsAgent : undefined
    };

    try {
        // Yritetään ensin normaalisti rss-parserilla
        // Huom: rss-parser ei tue suoraan axios-headersseja, joten jos tämä epäonnistuu,
        // mennään automaattisesti catch-lohkoon, jossa axios käyttää User-Agentia.
        feedContent = await parser.parseURL(feed.rssUrl);
    } catch (err) {
        // Poikkeuslogiikka XML-virheille, sertifikaattivioille tai jos palvelin hylkää peruspyynnön
        console.log(`[POIKKEUS] Vikasietoinen haku: ${feed.nameChecked}`);
        
        try {
            // Käytetään axiosia yllä määritellyllä configilla (sisältää User-Agentin)
            const response = await axios.get(feed.rssUrl, axiosConfig);
            
            let xmlData = response.data;
            // Puhdistetaan rikkonaiset XML-merkit
            xmlData = xmlData.replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[a-f\d]+);)/gi, '&amp;');
            
            feedContent = await parser.parseString(xmlData);
        } catch (retryErr) {
            throw new Error(`Vikasietoinen haku epäonnistui: ${retryErr.message}`);
        }
    }
    
    // 1. Poimitaan syötteen kuvaus
    const sourceDescription = feed.sheetDesc || (feedContent.description ? feedContent.description.trim() : "");
    
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

    const items = feedContent.items.map(item => {
        let itemDate = new Date(item.pubDate || item.isoDate);
        
        // --- KUVAN POIMINTA ALKAA ---
        // Alustetaan muuttuja img tyhjäksi. Jos kuvaa ei löydy mistään alta, se jää nulliksi.
        let img = null;

        // A) Kokeillaan standardeja mediakenttiä
        // RSS-syötteet käyttävät usein media:content-tagia. Parseri voi nimetä sen kummalla vain tavalla.
        let mContent = item.mediaContent || item['media:content'];
        
        if (mContent) {
            // Varmistetaan, että käsitellään taulukkoa (listaa), vaikka syötteessä olisi vain yksi kuva.
            const mediaArray = Array.isArray(mContent) ? mContent : [mContent];
            let maxW = 0; // Käytetään suurimman kuvan etsimiseen (leveys pikseleinä).

            mediaArray.forEach(m => {
                // Haetaan kuvan URL. XML-rakenteesta riippuen se on joko m.url tai m.$.url.
                const currentUrl = m.url || m.$?.url;
                // Muutetaan leveystieto numeroksi vertailua varten.
                const currentWidth = parseInt(m.width || m.$?.width || 0);
                
                // Valintalogiikka: otetaan kuva, jos se on leveämpi kuin edellinen löydetty,
                // tai jos kyseessä on ensimmäinen löydetty URL.
                if (currentUrl && (currentWidth >= maxW || !img)) {
                    maxW = currentWidth;
                    img = currentUrl;
                }
            });
        }

        // Jos media:content ei tärpännyt, katsotaan mediaThumbnail-kenttä (pienoiskuva).
        if (!img && item.mediaThumbnail) {
            // Tarkistetaan molemmat mahdolliset XML-polut URL-osoitteelle.
            img = item.mediaThumbnail.$?.url || item.mediaThumbnail.url;
        }

        // Jos ei vieläkään kuvaa, katsotaan enclosure-tagi (usein käytössä podcasteissa tai vanhemmissa RSS-malleissa).
        if (!img && item.enclosure && item.enclosure.url) {
            img = item.enclosure.url;
        }

        // --- TEKSTIN JA KUVAN KÄSITTELY (YHDISTETTY) ---
        const rawContent = item['content:encoded'] || item.contentEncoded || item.content || item.description || "";
        const $c = cheerio.load(rawContent);

        // 1. Jos kuvaa ei vielä ole löytynyt, yritetään poimia se tästä sisällöstä
        if (!img) {
            // 1a. Kokeillaan ensin <picture>-elementtiä (moderni responsiivinen kuva)
            const firstPicture = $c('picture').first();
            if (firstPicture.length) {
                // Yritetään ensin <source srcset> -attribuuttia
                const source = firstPicture.find('source[srcset]').first();
                if (source.length) {
                    const srcset = source.attr('srcset');
                    // Parsitaan srcset oikein: jaetaan pilkulla, otetaan ensimmäinen kandidaatti,
                    // ja poistetaan mahdollinen leveys/tiheyskuvaaja (esim. "800w" tai "2x")
                    if (srcset) {
                        const firstCandidate = srcset.trim().split(',')[0].trim();
                        img = firstCandidate.split(/\s+/)[0] || null;
                    }
                }
                // Jos ei löytynyt sourcesta, kokeillaan picture-elementin sisällä olevaa img-tagia
                if (!img) {
                    const picImg = firstPicture.find('img').first();
                    if (picImg.length) {
                        img = picImg.attr('src');
                    }
                }
            }
            // 1b. Fallback: etsitään tavallinen <img>-tagi (suodatetaan seurantapikselit)
            if (!img) {
                $c('img').each((_, el) => {
                    const w = $c(el).attr('width');
                    const h = $c(el).attr('height');
                    // Ohitetaan seurantapikselit, joilla molemmat dimensiot ovat <= 1 (esim. Matomo 0x0)
                    if (w !== undefined && h !== undefined && parseInt(w) <= 1 && parseInt(h) <= 1) {
                        return true; // jatketaan seuraavaan
                    }
                    img = $c(el).attr('src');
                    return false; // lopetetaan, kuva löytyi
                });
            }
            if (img) {
                console.log(`[KUVA] ${feed.nameChecked}: löytyi HTML-sisällöstä: ${img.substring(0, 80)}`);
            } else {
                console.log(`[KUVA] ${feed.nameChecked}: kuvaa ei löytynyt`);
            }
        }

        // Muutetaan suhteelliset kuva-URL:t absoluuttisiksi
        if (img && !img.startsWith('http') && !img.startsWith('//')) {
            const baseUrl = item.link || feed.rssUrl;
            try {
                img = new URL(img, baseUrl).href;
                console.log(`[KUVA] ${feed.nameChecked}: suhteellinen URL muutettu absoluuttiseksi: ${img.substring(0, 80)}`);
            } catch (e) {
                console.log(`[VAROITUS] ${feed.nameChecked}: kuva-URL:n korjaus epäonnistui: ${img}`);
                img = null;
            }
        }
        
        // 2. POISTETAAN ROSKA (Tämä korjaa COST-ongelman)
        // Poistetaan kuvat, haitalliset skriptit JA WordPressin figure-rakenteet
        $c('img, script, style, iframe, form, figure, figcaption, video, audio').remove();
        
        // 3. PUHDISTETAAN ATTRUBUUTIT
        // Poistetaan inline-tyylit ja ne koodit (srcset, sizes), jotka jäivät kummittelemaan
        $c('*').removeAttr('style').removeAttr('srcset').removeAttr('sizes').removeAttr('fetchpriority').removeAttr('decoding');
        
        // 4. MUODOSTETAAN LOPULLINEN TEKSTI
        let safeHTML = $c('body').html() || $c.html() || "";
        
        // Hallittu katkaisu, jotta tagit sulkeutuvat oikein
        if (safeHTML.length > 800) {
            safeHTML = safeHTML.substring(0, 800);
            safeHTML = cheerio.load(safeHTML).html(); 
        }
        
        let cleanText = safeHTML.trim();

        // Jos teksti jäi tyhjäksi, käytetään otsikkoa varalla
        if (cleanText.length < 10) {
            cleanText = item.title || "";
        }

        // Käytetään tätä lopullisena sisältönä
        const finalSnippet = cleanText;

        let articleLink = item.link;

        if (articleLink) {
            // 1. KORJAUS: Korjataan viallinen protokolla (https:/ -> https://)
            if (articleLink.startsWith('https:/') && !articleLink.startsWith('https://')) {
                articleLink = articleLink.replace('https:/', 'https://');
            }

            // 2. KORJAUS: Muutetaan suhteelliset linkit täysiksi URL-osoitteiksi
            if (!articleLink.startsWith('http')) {
                try {
                    articleLink = new URL(articleLink, feed.rssUrl).href;
                } catch (e) {
                    console.error("Linkin korjaus epäonnistui:", articleLink);
                }
            }
        }

        let finalImg = img;
        if (finalImg && typeof finalImg === 'string') {
            // Palautetaan mahdolliset XML-entiteetit raakamuotoon, jotta selain voi 
            // enkoodata ne puhtaasti wsrv.nl-palvelulle (ei tupla-enkoodausta).
            finalImg = finalImg.replace(/&amp;/g, '&');
        }
        // Valitaan kuvaus: 1. Sheets (sheetDesc), 2. RSS (feedContent.description), 3. Tyhjä
        const finalDescription = feed.sheetDesc || (feedContent.description ? feedContent.description.trim() : "");
    
        return {
            title: item.title,
            link: articleLink,
            pubDate: itemDate.toISOString(),
            content: finalSnippet,
            creator: item.creator || item.author || "",
            // Nimi on aina Sheets-nimi (nameChecked)
            sourceTitle: feed.nameChecked, 
            sheetCategory: feed.category,
            enforcedImage: finalImg,
            sourceDescription: finalDescription, // <--- Korjattu tähän
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
        // Tarkistetaan löytyykö sääntöä ennen kuin edes ladataan sivua
        if (!fs.existsSync(scraperPath)) {
            console.log(`[SCRAPE] Ei kustomoitua skriptiä: ${domain}.`);
            return;
        }

        const scraperRule = require(scraperPath);
        const { data } = await axios.get(feed.scrapeUrl, { 
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 15000 
        });

        const $ = cheerio.load(data);
        // POISTETAAN ROSKA: Gravity Forms, tyylit jne.
        $('script, style, iframe, form').remove();

        const selector = scraperRule.listSelector || 'article';
        const elements = $(selector).get().slice(0, 10);
        const sourceDescription = feed.sheetDesc || "Verkkosivulta poimittu uutinen.";

        for (const el of elements) {
            let item = await scraperRule.parse($, el, axios, cheerio);

            if (item && item.title && item.link) {
                const fullLink = item.link.startsWith('http') ? item.link : new URL(item.link, feed.scrapeUrl).href;
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
                    sourceTitle: feed.nameChecked || domain,
                    sheetCategory: feed.category,
                    enforcedImage: finalImg,
                    sourceDescription: sourceDescription,
                    sourceLogo: await getSourceLogo(null, domain, feed.nameChecked || domain),
                    lang: feed.lang,
                    scope: feed.scope,
                    isDarkLogo: feed.isDarkLogo,
                    // TÄMÄ PUUTTUI NYKYISESTÄ:
                    originalRssUrl: feed.rssUrl || "" 
                });
            }
        }
    } catch (err) {
        console.error(`Scraper epäonnistui kohteelle ${domain}: ${err.message}`);
    }
}

run().then(() => {
    console.log("Ajo suoritettu loppuun.");
    process.exit(0);
}).catch(err => {
    console.error("Ajo epäonnistui:", err);
    process.exit(1);
});
