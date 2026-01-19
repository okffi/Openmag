const axios = require('axios');
const Parser = require('rss-parser');
const fs = require('fs');

const parser = new Parser();
const SHEET_CSV_URL = process.env.SHEET_CSV_URL;

async function run() {
    try {
        // 1. Get Spreadsheet Data
        const response = await axios.get(SHEET_CSV_URL);
        const rows = response.data.split('\n').slice(1);
        const feeds = rows.map(row => {
            const cols = row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            return { 
                category: cols[0]?.replace(/^"|"$/g, '').trim(), 
                url: cols[2]?.replace(/^"|"$/g, '').trim() 
            };
        }).filter(f => f.url && f.url.startsWith('http'));

        let allArticles = [];

        // 2. Fetch Feeds (Sequentially to avoid rate limits)
        for (const feed of feeds) {
            try {
                console.log(`Fetching: ${feed.url}`);
                const feedContent = await parser.parseURL(feed.url);
                const items = feedContent.items.map(item => ({
                    title: item.title,
                    link: item.link,
                    pubDate: item.pubDate,
                    content: item.contentSnippet || item.content,
                    source: feedContent.title,
                    category: feed.category,
                    // Basic image extraction from content
                    image: extractImage(item)
                }));
                allArticles.push(...items);
            } catch (e) {
                console.error(`Skipped ${feed.url}: ${e.message}`);
            }
        }

        // 3. Sort and Save
        allArticles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
        fs.writeFileSync('data.json', JSON.stringify(allArticles.slice(0, 500), null, 2));
        console.log("Successfully saved 500 articles to data.json");

    } catch (error) {
        console.error("Critical Failure:", error);
        process.exit(1);
    }
}

function extractImage(item) {
    // Simple regex to find the first img tag src in content
    const imgRegex = /<img[^>]+src="([^">]+)"/;
    const match = (item.content || "").match(imgRegex);
    return match ? match[1] : null;
}

run();
