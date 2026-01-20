const axios = require('axios');
const fs = require('fs');
const Parser = require('rss-parser');
const parser = new Parser({ headers: { 'User-Agent': 'OpenMag-Robot-v1' } });

const SHEET_CSV_URL = process.env.SHEET_CSV_URL || 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRUveH7tPtcCI0gLuCL7krtgpLPPo_nasbZqxioFhftwSrAykn3jOoJVwPzsJnnl5XzcO8HhP7jpk2_/pub?gid=0&single=true&output=csv';

async function run() {
    try {
        console.log("Starting Robot: Fetching Spreadsheet...");
        const response = await axios.get(SHEET_CSV_URL);
        const rows = response.data.split('\n').slice(1);
        const feeds = rows.map(row => {
            const cols = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            return { 
                category: cols[0]?.replace(/^"|"$/g, '').trim() || "General",
                url: cols[2]?.replace(/^"|"$/g, '').trim() 
            };
        }).filter(f => f.url && f.url.startsWith('http'));

        let allArticles = [];
        const now = new Date(); 

        for (const feed of feeds) {
            try {
                console.log(`Direct Fetching: ${feed.url}`);
                const feedContent = await parser.parseURL(feed.url);
                
                const items = feedContent.items.map(item => {
                    let itemDate = new Date(item.pubDate);
                    
                    if (isNaN(itemDate.getTime()) || itemDate > now) {
                        itemDate = now;
                    }

                    // Aggressiivinen kuvanhaku: enclosure -> thumbnail -> tekstin sisältä
                    const foundImage = item.enclosure?.url || 
                                       item.thumbnail || 
                                       extractImageFromContent(item);

                    return {
                        title: item.title,
                        link: item.link,
                        pubDate: itemDate.toISOString(),
                        content: item.contentSnippet || item.content || "",
                        creator: item.creator || item['dc:creator'] || item.author || "",
                        sourceTitle: feedContent.title,
                        sheetCategory: feed.category,
                        enforcedImage: foundImage
                    };
                });

                allArticles.push(...items);
                await new Promise(r => setTimeout(r, 1000)); 
            } catch (e) {
                console.error(`Skipped ${feed.url}: ${e.message}`);
            }
        }

        allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
        
        fs.writeFileSync('data.json', JSON.stringify(allArticles.slice(0, 500), null, 2));
        console.log(`Success! data.json updated with ${allArticles.length} items.`);
    } catch (error) {
        console.error("Critical Failure:", error);
        process.exit(1);
    }
}

// Parannettu apufunktio kuvan etsimiseen
function extractImageFromContent(item) {
    // Etsitään kaikista mahdollisista tekstikentistä
    const searchString = (item.content || "") + 
                         (item.contentSnippet || "") + 
                         (item['content:encoded'] || "");
    
    // Etsitään ensimmäinen img-tägin src
    const imgRegex = /<img[^>]+src=["']([^"'>?]+)/i;
    const match = searchString.match(imgRegex);
    
    if (match && match[1]) {
        const src = match[1];
        
        // Suodatetaan pois pikkukuvakkeet, seuranta-pikselit ja mainoslogit
        const isTracker = /pixel|analytics|doubleclick|tracker|logo|icon|spacer/i.test(src);
        
        if (!isTracker) {
            return src;
        }
    }
    return null;
}

run();
