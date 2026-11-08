# Openmag
Read the mag at https://okffi.github.io/Openmag/

## Scraper sources

The news updater reads source metadata and URLs from the published Google Sheet
configured in `fetch_news.js`. Adding a file to `scrapers/` alone does not add a
source: the sheet must contain a row with a valid HTTP(S) listing URL in the
scrape URL column (the fourth column). Its hostname, without a leading `www.`,
must match the scraper filename, for example `example.com.js`. Include the
source name, category, language and scope in the corresponding sheet columns.

When both RSS and scrape URLs are provided, the updater processes both and
deduplicates article URLs. Only sources with valid articles appear in the
sidebar; the front page contains at most 1,000 recent articles. Scrapers must
return a title, link and valid publication date. Check the update workflow's
`Show failed feeds` step for invalid URLs, missing rules, request failures or
selectors that return no valid articles. Some websites may block the updater;
those failures require a source-specific solution or a working RSS feed.
The AHM UvA scraper reads the listing's JSON API because its articles are
rendered by JavaScript; keep the AHM listing URL in the sheet, not the API URL.
