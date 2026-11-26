# Openmag
Read the mag at https://okffi.github.io/Openmag/

## Source selection

Use the checkboxes beside sources in the sidebar, on article cards, or on a
source page to include or exclude sources from the latest-news and topic feeds.
The checkbox beside a topic changes every source in that topic, including sources
hidden by language or region filters. A mixed checkbox means some sources are
enabled; selecting it enables all of them.

Selections are stored only in this browser on this device. Sources are enabled
by default, including new sources; clearing site storage removes the selection.
Source pages still preview articles from disabled sources, and bookmarks remain
visible. Resetting language or region filters does not reset source selections.

## Location selection

Select locations in Settings and choose Apply to filter articles and sidebar
sources. Selecting a region also selects its descendants; individual locations
can then be changed independently. A regional selection includes sources
tagged with that region, not just its countries. With no locations selected,
all locations are shown. Location selections are saved in this browser.

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
