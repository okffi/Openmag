/**
 * generate_summaries.js
 *
 * On-demand AI category summary generator.
 *
 * Usage:
 *   node generate_summaries.js                  # Generate all categories
 *   node generate_summaries.js "Category Name"  # Generate a single category
 *   node generate_summaries.js --force          # Bypass cache and regenerate
 *   node generate_summaries.js --server         # Start optional HTTP API server
 *
 * Environment variables:
 *   OPENAI_API_KEY   – If set, uses OpenAI GPT to produce AI summaries.
 *                      If unset, falls back to a lightweight extractive summary.
 *   SUMMARIES_PORT   – Port for the optional HTTP server (default: 3001).
 */

'use strict';

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const http = require('http');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CACHE_FILE = path.join(__dirname, 'category_summaries.json');
const DATA_FILE = path.join(__dirname, 'data.json');

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_ARTICLES_PER_CATEGORY = 10;
const THROTTLE_MS = 500;
const CRAWL_TIMEOUT_MS = 10000;

// Marker for an empty HTML body that fetch_news.js sometimes produces
const EMPTY_CONTENT_MARKER = '<html><head></head><body></body></html>';

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

function loadCache() {
    if (fs.existsSync(CACHE_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        } catch (_e) {
            return {};
        }
    }
    return {};
}

function saveCache(cache) {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

function isCacheFresh(entry) {
    if (!entry || !entry.timestamp) return false;
    const ageMs = Date.now() - new Date(entry.timestamp).getTime();
    return ageMs < CACHE_MAX_AGE_MS;
}

// ---------------------------------------------------------------------------
// Content crawling
// ---------------------------------------------------------------------------

/**
 * Fetch and extract meaningful plain text from an article URL.
 * Returns null on any error.
 */
async function crawlArticleContent(url) {
    try {
        const response = await axios.get(url, {
            timeout: CRAWL_TIMEOUT_MS,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) OpenMag-Robot-v1'
            }
        });
        const $ = cheerio.load(response.data);
        // Remove non-content elements
        $('script, style, nav, footer, header, aside, form, iframe').remove();
        // Prefer semantic content containers
        const text = ($('article').first().text() ||
                      $('main').first().text() ||
                      $('[class*="content"]').first().text() ||
                      $('body').text())
            .replace(/\s+/g, ' ')
            .trim();
        return text.substring(0, 2000) || null;
    } catch (_e) {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Summary generation
// ---------------------------------------------------------------------------

/**
 * Lightweight extractive fallback when no OpenAI key is available.
 */
function extractiveSummary(categoryName, articles) {
    const top3 = articles.slice(0, 3);
    const titles = top3.map(a => `"${a.title}"`).join(', ');
    const sourceCount = new Set(articles.map(a => a.source)).size;
    return (
        `Recent coverage in ${categoryName} (${articles.length} articles from ` +
        `${sourceCount} source${sourceCount !== 1 ? 's' : ''}) includes ${titles}.`
    );
}

/**
 * Generate a summary using the OpenAI Chat API.
 * Throws on API errors so the caller can fall back gracefully.
 */
async function openAISummary(categoryName, articles) {
    const articlesText = articles
        .map((a, i) => `${i + 1}. "${a.title}" (${a.source})\n${a.content || ''}`)
        .join('\n\n');

    const prompt =
        `The following are recent news articles from the "${categoryName}" category.\n` +
        `Provide a concise 2-3 sentence summary of the main themes and topics covered. ` +
        `Reference the top 3 most significant articles by title.\n\n` +
        `${articlesText}\n\nSummary:`;

    const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
            model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 300,
            temperature: 0.5
        },
        {
            headers: {
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        }
    );

    return response.data.choices[0].message.content.trim();
}

/**
 * Choose AI or extractive summarisation based on API key availability.
 */
async function generateSummary(categoryName, articles) {
    if (process.env.OPENAI_API_KEY) {
        return openAISummary(categoryName, articles);
    }
    return extractiveSummary(categoryName, articles);
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Main entry point for generating summaries.
 *
 * @param {string|null} targetCategory  – If set, only process this category.
 * @param {boolean}     force           – Bypass cache and regenerate.
 * @returns {{ generated: number, cached: number }}
 */
async function generateCategorySummaries(targetCategory = null, force = false) {
    if (!fs.existsSync(DATA_FILE)) {
        throw new Error('data.json not found. Run fetch_news.js first.');
    }

    const articles = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const cache = loadCache();

    // Group articles by category
    const byCategory = {};
    articles.forEach(art => {
        const cat = art.sheetCategory || 'General';
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(art);
    });

    // Determine which categories to process
    let categories = Object.keys(byCategory);
    if (targetCategory) {
        if (!byCategory[targetCategory]) {
            const available = categories.join(', ');
            throw new Error(
                `Category "${targetCategory}" not found in data.json. ` +
                `Available categories: ${available}`
            );
        }
        categories = [targetCategory];
    }

    let generated = 0;
    let cached = 0;

    for (const catName of categories) {
        // Check cache freshness
        if (!force && isCacheFresh(cache[catName])) {
            console.log(`[CACHED]     ${catName}`);
            cached++;
            continue;
        }

        console.log(`[GENERATING] ${catName}...`);

        // Top 10 most recent articles for the category
        const catArticles = byCategory[catName]
            .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))
            .slice(0, MAX_ARTICLES_PER_CATEGORY);

        // Enrich articles that lack meaningful content
        const enriched = [];
        for (const art of catArticles) {
            const hasContent =
                art.content &&
                art.content.trim().length > 100 &&
                art.content !== EMPTY_CONTENT_MARKER;

            let content = hasContent ? art.content : null;

            if (!content && art.link) {
                console.log(`  Crawling: ${art.link.substring(0, 70)}...`);
                content = await crawlArticleContent(art.link);
                // Throttle requests to external sources
                await new Promise(r => setTimeout(r, THROTTLE_MS));
            }

            enriched.push({
                title: art.title || '',
                source: art.sourceTitle || '',
                content: content || art.title || ''
            });
        }

        try {
            const summary = await generateSummary(catName, enriched);
            const topArticles = catArticles.slice(0, 3).map(a => ({
                title: a.title || 'Untitled',
                link: a.link || ''
            }));

            cache[catName] = {
                summary,
                timestamp: new Date().toISOString(),
                articleCount: catArticles.length,
                topArticles
            };

            saveCache(cache);
            console.log(`[DONE]       ${catName}: ${summary.substring(0, 80)}...`);
            generated++;
        } catch (err) {
            console.error(`[ERROR]      ${catName}: ${err.message}`);
        }
    }

    console.log(`\nFinished. Generated: ${generated}, Cached: ${cached}`);
    return { generated, cached };
}

// ---------------------------------------------------------------------------
// Optional HTTP server  (POST /api/summaries/refresh, GET /api/summaries)
// ---------------------------------------------------------------------------

function startServer(port) {
    const server = http.createServer(async (req, res) => {
        if (req.method === 'POST' && req.url === '/api/summaries/refresh') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
                let params = {};
                try { params = JSON.parse(body || '{}'); } catch (_e) { /* ignore */ }
                const { category = null, force = false } = params;
                try {
                    const result = await generateCategorySummaries(category, force);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, ...result }));
                } catch (err) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: err.message }));
                }
            });
        } else if (req.method === 'GET' && req.url === '/api/summaries') {
            const cache = loadCache();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(cache));
        } else {
            res.writeHead(404);
            res.end();
        }
    });

    server.listen(port, () => {
        console.log(`Summaries server listening on port ${port}`);
        console.log('  POST /api/summaries/refresh  – Generate summaries on demand');
        console.log('  GET  /api/summaries          – Read cached summaries');
    });
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

// Only run CLI logic when this file is executed directly (not required as module)
if (require.main === module) {
    const args = process.argv.slice(2);
    const force = args.includes('--force');
    const serverMode = args.includes('--server');
    const targetCategory = args.find(a => !a.startsWith('--')) || null;

    if (serverMode) {
        const port = parseInt(process.env.SUMMARIES_PORT || '3001', 10);
        startServer(port);
    } else {
        generateCategorySummaries(targetCategory, force)
            .then(() => process.exit(process.exitCode || 0))
            .catch(err => {
                console.error('Fatal error:', err.message);
                process.exit(1);
            });
    }
}

// ---------------------------------------------------------------------------
// Module exports (for programmatic use and testing)
// ---------------------------------------------------------------------------

module.exports = {
    generateCategorySummaries,
    loadCache,
    saveCache,
    isCacheFresh,
    crawlArticleContent,
    generateSummary,
    extractiveSummary
};
