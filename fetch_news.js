const axios = require('axios');
const fs = require('fs');

// Use the Secret if available, otherwise fallback to the hardcoded link for testing
const SHEET_CSV_URL = process.env.SHEET_CSV_URL || 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRUveH7tPtcCI0gLuCL7krtgpLPPo_nasbZqxioFhftwSrAykn3jOoJVwPzsJnnl5XzcO8HhP7jpk2_/pub?gid=0&single=true&output=csv';

async function run() {
    try {
        console.log("Starting Robot: Fetching Spreadsheet...");
        const response = await axios.get(SHEET_CSV_URL);
        const rows = response.data.split('\n').slice(1);
        
        const feedData = rows.map(row => {
            const cols = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            return { 
                category: cols[0] ? cols[0].replace(/^"|"$/g, '').trim() : "General",
                url: cols[2] ? cols[2].replace(/^"|"$/g, '').trim() : null
            };
        }).filter(f => f.url && f.url.startsWith('http'));

        console.log(`Found ${feedData.length} feeds. Starting throttled fetch...`);

        let allArticles = [];

        // THE SEQUENTIAL FETCH LOOP (The part you were looking for)
        for (let i = 0; i < feedData.length; i += 2) { 
            const batch = feedData.slice(i, i + 2);
            
            await Promise.all(batch.map(async (feed) => {
                try {
                    console.log(`Processing: ${feed.url}`);
                    const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed.url)}`;
                    
                    const res = await axios.get(apiUrl, {
                        headers: { 'User-Agent': 'OpenMag-Robot-v1' }
                    });
                    
                    if (res.data.status === 'ok') {
                        const items = res.data.items.map(item => ({
                            ...item,
                            sourceTitle: res.data.feed.title,
                            sheetCategory: feed.category,
                            // Enhance image extraction for the Robot
                            enforcedImage: extractImage(item)
                        }));
                        allArticles.push(...items);
                    }
                } catch (e) {
                    console.error(`Skipped ${feed.url}: ${e.response?.status || e.message}`);
                }
            }));

            // Wait 3 seconds between batches to avoid 429 errors
            if (i + 2 < feedData.length) {
                await new Promise(r => setTimeout(r, 3000));
            }
        }

        // Sort by date (newest first)
        allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

        // Limit to 500 articles to keep the file size reasonable
        const finalData = allArticles.slice(0, 500);

        fs.writeFileSync('data.json', JSON.stringify(finalData, null, 2));
        console.log(`Success! data.json created with ${finalData.length} articles.`);

    } catch (error) {
        console.error("Critical Robot Failure:", error);
        process.exit(1);
    }
}

// Helper to find the best image for the magazine
function extractImage(item) {
    let src = null;
    if (item.enclosures && item.enclosures.length > 0) {
        const images = item.enclosures.filter(e => e.type && e.type.includes('image'));
        if (images.length > 0) src = images[images.length - 1].url;
    }
    if (!src) src = item.thumbnail || item.enclosure?.link;
    return src;
}

run();
