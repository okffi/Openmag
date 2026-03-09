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
        },

        /**
         * Export all bookmarks as a CSV file download
         */
        exportCsv() {
            const bookmarks = this.getAll();
            const columns = ['title', 'link', 'sourceTitle', 'creator', 'pubDate', 'sheetCategory', 'lang', 'scope', 'bookmarkedAt'];

            function escapeField(value) {
                const str = String(value == null ? '' : value);
                if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                    return '"' + str.replace(/"/g, '""') + '"';
                }
                return str;
            }

            const rows = [columns.join(',')];
            bookmarks.forEach(bm => {
                rows.push(columns.map(col => escapeField(bm[col])).join(','));
            });

            const csvContent = rows.join('\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'bookmarks.csv';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    };
})();
