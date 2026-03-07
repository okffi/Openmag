// bookmarks.js - Standalone bookmark management (no UI dependencies)
(function() {
    const STORAGE_KEY = 'openmag_bookmarks';

    window.BookmarkManager = {
        /**
         * Get all bookmarks
         */
        getAll() {
            try {
                const data = localStorage.getItem(STORAGE_KEY);
                return data ? JSON.parse(data) : [];
            } catch (e) {
                console.error('Error reading bookmarks:', e);
                return [];
            }
        },

        /**
         * Check if an article is bookmarked
         */
        isBookmarked(link) {
            if (!link) return false;
            return this.getAll().some(b => b.link === link);
        },

        /**
         * Add a bookmark
         */
        add(article) {
            if (!article.link) return false;
            
            const bookmarks = this.getAll();
            if (bookmarks.some(b => b.link === article.link)) {
                return false; // Already bookmarked
            }

            bookmarks.push({
                title: article.title || '',
                link: article.link,
                content: article.content || '',
                sourceTitle: article.sourceTitle || '',
                creator: article.creator || '',
                pubDate: article.pubDate || '',
                enforcedImage: article.enforcedImage || '',
                sheetCategory: article.sheetCategory || '',
                lang: article.lang || '',
                scope: article.scope || '',
                bookmarkedAt: new Date().toISOString()
            });

            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
                return true;
            } catch (e) {
                console.error('Error saving bookmark:', e);
                return false;
            }
        },

        /**
         * Remove a bookmark
         */
        remove(link) {
            if (!link) return false;
            
            const bookmarks = this.getAll();
            const filtered = bookmarks.filter(b => b.link !== link);
            
            if (filtered.length === bookmarks.length) {
                return false; // Wasn't bookmarked
            }

            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
                return true;
            } catch (e) {
                console.error('Error removing bookmark:', e);
                return false;
            }
        },

        /**
         * Get bookmark count
         */
        getCount() {
            return this.getAll().length;
        }
    };
})();
