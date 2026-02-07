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
            // Merkitään ajo tehdyksi vasta tässä
            fs.writeFileSync(cleanLogFile, today);
        } else {
            console.log(`--- Jatketaan päivää: ladataan olemassa oleva data ---`);
            if (fs.existsSync('data.json')) {
                allArticles = JSON.parse(fs.readFileSync('data.json', 'utf8'));
            }
        }

        // 2. HAETAAN SYÖTTEET (Cache Buster ja parannettu validointi)
        console.log("Haetaan syötelistaa Google Sheetsistä (TSV)...");
        const cacheBuster = `&cb=${Date.now()}`;
        const response = await axios.get(SHEET_TSV_URL + cacheBuster);
        
        // Käytetään /\r?\n/ ja suodatetaan tyhjät rivit heti pois
        const rows = response.data.split(/\r?\n/)
            .slice(1)
            .filter(row => row.trim() !== '');

        console.log(`--- DEBUG: Sheets-data haettu ---`);
        console.log(`Rivejä yhteensä (ilman otsikkoa): ${rows.length}`);
        console.log(`Esimerkki ensimmäisestä raakarivistä:\n"${rows[0]}"`);
        
        const feeds = rows.map(row => {
            const c = row.split('\t').map(v => v ? v.trim() : '');
            
            // Validointi: vähintään RSS tai Scrape URL on löydyttävä
            if (!c[2] && !c[3]) return null;

            return { 
                category: c[0] || "Yleinen",
                feedName: c[1] || "Nimetön",
                rssUrl: c[2], 
                scrapeUrl: c[3] || "",
                nameChecked: c[4] || c[1] || "Lähde", // Tämä on "kuningas"
                sheetDesc: c[5] || "",
                lang: (c[6] || "fi").toLowerCase(),
                scope: c[7] || "World",
                isDarkLogo: (c[8] || "").toUpperCase() === "TRUE" || c[8] === "1"
            };
        }).filter(f => f !== null);

        console.log(`--- Parsittu ${feeds.length} voimassa olevaa syötettä ---`);
        
        if (feeds.length === 0) {
            console.error("VIRHE: Syötelista on tyhjä! Tarkista Sheets-yhteys.");
        }
        
        // 2.1. KÄSITTELE RSS-SYÖTTEET (Vakaa osio)
        const rssFeeds = feeds.filter(f => f.rssUrl && f.rssUrl.length > 10);
        console.log(`--- Aloitetaan RSS-haku (${rssFeeds.length} kpl) ---`);
        
        for (const feed of rssFeeds) {
            try {
                console.log(`[RSS] ${feed.nameChecked}: ${feed.rssUrl}`);
                await processRSS(feed, allArticles, now);
                await new Promise(r => setTimeout(r, 600));
            } catch (e) {
                console.error(`RSS-virhe kohteessa ${feed.nameChecked}: ${e.message}`);
                failedFeeds.push(`RSS: ${feed.nameChecked}: ${e.message}`);
            }
        }

        // 2.2. KÄSITTELE SCRAPERIT (Kokeellinen osio - tällä hetkellä pois päältä)
        
        const scrapeFeeds = feeds.filter(f => f.scrapeUrl && !f.rssUrl);
        console.log(`--- Aloitetaan Scraper-haku (${scrapeFeeds.length} kpl) ---`);

        for (const feed of scrapeFeeds) {
            try {
                console.log(`[SCRAPE] ${feed.nameChecked}: ${feed.scrapeUrl}`);
                await processScraper(feed, allArticles, now);
                await new Promise(r => setTimeout(r, 1000));
            } catch (e) {
                console.error(`Scraper-virhe kohteessa ${feed.nameChecked}: ${e.message}`);
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

        // 4. TALLENNUS ARKISTOIHIN JA TILASTOIHIN
        const sourceStats = {};
        const articlesBySource = {};

        allArticles.forEach(art => {
            // Käytetään artikkelin mukana kulkevaa puhdasta nimeä
            const src = art.sourceTitle; 
            const fileKey = src.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            
            if (!articlesBySource[fileKey]) articlesBySource[fileKey] = [];
            articlesBySource[fileKey].push(art);
            
            if (!sourceStats[src]) {
                sourceStats[src] = { 
                    file: `${fileKey}.json`, 
                    count: 0,
                    category: art.sheetCategory || "Yleinen",
                    // Lisätään kuvaus myös tilastoihin, jos käyttöliittymä tarvitsee sitä
                    description: art.sourceDescription || "" 
                };
            }
            sourceStats[src].count++;
        });

        // Jos kansiota ei ole, luodaan se ennen kirjoittamista
        if (!fs.existsSync(sourcesDir)) {
            fs.mkdirSync(sourcesDir, { recursive: true });
            console.log("Sources-kansiota ei ollut – luotiin uusi.");
        }

        Object.keys(articlesBySource).forEach(key => {
            fs.writeFileSync(path.join(sourcesDir, `${key}.json`), JSON.stringify(articlesBySource[key], null, 2));
        });

        // 5. ETUSIVUN JÄRJESTELY (ROUND ROBIN + RAJOITUS 5 KPL/LÄHDE)
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
                
                // RAJOITUS: Lisätään päivän alle vain, jos lähteeltä on alle 5 uutista kyseiselle päivälle
                if (bySource[src].length < 5) {
                    bySource[src].push(art);
                }
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

        // 6. TALLENNUS - Nostettu 1000 artikkeliin
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
    
// 2. Poimitaan logo
    let sourceLogo = feedContent.image ? feedContent.image.url : null;
    
    if (!sourceLogo) {
        try {
            // Yritetään ensin syötteen ilmoittamaa linkkiä, sitten uutislinkkiä, ja lopuksi RSS-osoitetta
            const linkToParse = feedContent.link || (feedContent.items[0] && feedContent.items[0].link) || feed.rssUrl;
            
            if (linkToParse) {
                const domain = new URL(linkToParse).hostname;
                sourceLogo = `https://www.google.com/s2/favicons?sz=128&domain=${domain}`;
            }
        } catch (e) {
            // Jos URL on edelleen viallinen (esim. pelkkä polku), ei kaadeta ajoa
            console.log(`[VAROITUS] Faviconin luonti epäonnistui kohteelle ${feed.nameChecked}: ${e.message}`);
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

        // B) Jos ei vieläkään löydy (esim. OKFN/ePressi), kaivetaan sisällön seasta.
        // Tämä kutsuu erillistä apufunktiota, joka "skrappaa" HTML-sisällön seasta <img>-tagit.
        if (!img) {
            img = extractImageFromContent(item, feed.rssUrl);
        }

        // C) ÄLYKÄS PUHDISTUS
        // Tässä vaiheessa meillä on joko URL tai null. Jos meillä on URL, siivotaan se.
        if (img) {
            // WordPress-pohjaiset sivustot (i0.wp.com / wp-content) käyttävät usein URL-parametreja kuvien koon muuttamiseen.
            if (img.includes('i0.wp.com') || img.includes('wp-content')) {
                // Jos URL:ssa on kysymysmerkki (esim. kuva.jpg?w=640), katkaistaan se pois, jotta saamme alkuperäisen täysikokoisen kuvan.
                if (img.includes('?')) {
                    img = img.split('?')[0];
                }
            }
            
            // Suhteellisten linkkien korjaus: Jos kuva alkaa "/" (esim. /kuvat/uudenvuoden.jpg), se ei toimi sellaisenaan.
            if (img.startsWith('/') && !img.startsWith('http')) {
                try {
                    // Luodaan URL-olio syötteen osoitteesta, jotta saamme domainin (esim. https://okfn.de).
                    const urlObj = new URL(feed.rssUrl);
                    // Yhdistetään protokolla, domain ja suhteellinen polku täydelliseksi osoitteeksi.
                    img = `${urlObj.protocol}//${urlObj.hostname}${img}`;
                } catch (e) { 
                    // Jos URL-muunnos epäonnistuu, hylätään kuva virheen välttämiseksi.
                    img = null; 
                }
            }
            
            // Guardianin (guim.co.uk) kuvat saattavat joskus tulla vanhentuneella http-yhteydellä.
            if (img && img.includes('guim.co.uk')) {
                // Pakotetaan https, jotta selain ei anna "mixed content" -varoitusta.
                img = img.replace('http://', 'https://');
            }
        }
        // --- KUVAN POIMINTA PÄÄTTYY ---
        
        // --- TEKSTIN POIMINTA ALKAA ---
        const rawContent = item['content:encoded'] || item.contentEncoded || item.content || item.description || "";
        
        // Käytetään Cheeriota HTML:n puhdistamiseen tekstiksi muuttamisen sijaan
        const $cleaner = cheerio.load(rawContent);
        
        // 1. Poistetaan vaaralliset tai ulkoasua rikkovat elementit
        $cleaner('script, style, iframe, form, embed, object').remove();
        
        // 2. POISTETAAN INLINE-TYYLIT (Tämä estää Tactical Techin tyylivalumat)
        $cleaner('*').removeAttr('style');
        
        // 3. Otetaan puhdistettu HTML (body-tagin sisältö)
        let safeHTML = $cleaner('body').html() || $cleaner.html();
        
        // 4. Katkaistaan hallitusti, jos teksti on massiivinen
        if (safeHTML.length > 1000) {
            safeHTML = safeHTML.substring(0, 1000);
            // Lataamalla katkaistu teksti uudelleen, Cheerio sulkee mahdolliset avoimeksi jääneet tagit
            safeHTML = cheerio.load(safeHTML).html();
        }
        
        // Tallennetaan puhdistettu HTML
        let cleanText = safeHTML.trim();

        // Jos teksti jäi tyhjäksi tai on vain pisteitä, käytetään otsikkoa varalla
        if (cleanText.length < 10 || cleanText === "...") {
            cleanText = item.title || "";
        }

        const finalSnippet = cleanText.length > 500 
            ? cleanText.substring(0, 500) + "..." 
            : cleanText;
        // --- TEKSTIN POIMINTA PÄÄTTYY ---

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
                    sourceLogo: `https://www.google.com/s2/favicons?sz=128&domain=${domain}`,
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

function extractImageFromContent(item, baseUrl) {
    const searchString = (item.contentEncoded || "") + 
                         (item['content:encoded'] || "") + 
                         (item.content || "") + 
                         (item.description || "") +
                         (item.summary || "");
    
    if (!searchString) return null;

    const $ = cheerio.load(searchString);
    let foundImg = null;

    $('img').each((i, el) => {
        if (foundImg) return;
        
        let src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src');
        
        if (!src && $(el).attr('srcset')) {
            const sets = $(el).attr('srcset').split(',');
            src = sets[sets.length - 1].trim().split(' ')[0];
        }

        if (src) {
            // Jos src on pelkkä domain , se ei ole oikea kuva
            try {
                const checkUrl = new URL(src);
                if (checkUrl.pathname === "/" || checkUrl.pathname === "") {
                    return; // Hypätään tämän kuvan yli ja jatketaan seuraavaan <img> tagiin
                }
            } catch (e) {
                // Jos URL on viallinen, jatketaan
            }

            // --- TÄRKEIN KORJAUS COARILLE JA WP-KUVILLE ---
            // Poistetaan kaikki parametrit, jotta wsrv.nl ei saa tuplakoodattuja merkkejä
            // Esim: image.png?resize=1024%2C768 -> image.png
            // Jos cheerio tai aiempi XML-puhdistus on jättänyt URL-osoitteeseen 
            // entiteettejä, siivotaan ne tässä vaiheessa.
            if (src.includes('&amp;')) {
                src = src.replace(/&amp;/g, '&');
            }
            if (src.includes('?')) {
                src = src.split('?')[0];
            }
            
            // Jos kyseessä on i0.wp.com -linkki, se toimii usein paremmin ilman i0-alkua
            // mutta usein parametrien poisto riittää jo sellaisenaan.

            if (src.startsWith('/') && !src.startsWith('//')) {
                try {
                    const urlObj = new URL(baseUrl);
                    src = `${urlObj.protocol}//${urlObj.hostname}${src}`;
                } catch (e) {}
            } else if (src.startsWith('//')) {
                src = 'https:' + src;
            }
            
            if (src.startsWith('http')) {
                const isUseless = /analytics|doubleclick|pixel|1x1|wp-emoji|avatar|count/i.test(src);
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
