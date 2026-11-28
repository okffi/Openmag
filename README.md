# Openmag
Read the mag at https://okffi.github.io/Openmag/

## Source selection

Use the controls beside sources in the sidebar, on article cards, or on a
source page to include or exclude sources from the latest-news and topic feeds.
Language versions of a source share one sidebar row and one visibility choice.
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

## Language settings

Primary language sets the interface language and defaults to the browser
language. Content languages are checkboxes for filtering articles and sources;
all are selected by default, and the primary language always stays selected.
Selecting none is treated as selecting all. Choices are saved in this browser.

For a source with multiple language versions, OpenMag shows available articles
from the primary language, or falls back to English, the original language,
then another selected language. A random final fallback stays the same while
its eligible languages remain unchanged. Multiple feeds in the chosen language
are shown together; articles from other languages in the bundle are not shown.
The existing main-feed size limit still applies.

The source sheet's column J contains the permanent ID of each feed. Column K
contains the original feed's ID for language versions and is empty for the
original. Keep IDs stable; missing or invalid IDs are reported in the updater
log. Existing hidden-source choices are migrated to bundle visibility: a bundle
is hidden if any of its previous language versions was hidden.

## RSS sources

The news updater reads source metadata and RSS URLs from the published Google
Sheet configured in `fetch_news.js`. It fetches articles only from RSS feeds;
website URLs in the fourth column are not used to retrieve articles. A source
without an RSS URL cannot receive new articles. Only sources with available
articles appear in the sidebar. Check the update workflow's `Show failed feeds`
step for feed errors.

Articles from previous runs may remain until the next daily data refresh,
including articles previously collected from websites.
