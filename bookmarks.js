// bookmarks.js - Client-side bookmarking system using localStorage
const BookmarkManager = (function () {
    const STORAGE_KEY = 'openmag_bookmarks';

    function getBookmarks() {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            return [];
        }
    }

    function saveBookmarks(bookmarks) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
        } catch (e) {
            console.error('Failed to save bookmarks:', e);
        }
    }

    function addBookmark(article) {
        const link = article.link;
        if (!link) return false;
        const bookmarks = getBookmarks();
        if (bookmarks.some(b => b.link === link)) return false;
        bookmarks.unshift({
            title: article.title || '',
            link: link,
            content: article.content || '',
            creator: article.creator || '',
            pubDate: article.pubDate || '',
            image: article.enforcedImage || '',
            category: article.sheetCategory || '',
            bookmarkedAt: new Date().toISOString()
        });
        saveBookmarks(bookmarks);
        return true;
    }

    function removeBookmark(link) {
        saveBookmarks(getBookmarks().filter(b => b.link !== link));
    }

    function isBookmarked(link) {
        return getBookmarks().some(b => b.link === link);
    }

    function getBookmarkCount() {
        return getBookmarks().length;
    }

    function clearAllBookmarks() {
        if (confirm('Remove all bookmarks?')) {
            saveBookmarks([]);
            return true;
        }
        return false;
    }

    function exportBookmarks() {
        const bookmarks = getBookmarks();
        const blob = new Blob([JSON.stringify(bookmarks, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'openmag-bookmarks.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function importBookmarks(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const imported = JSON.parse(e.target.result);
                    if (!Array.isArray(imported)) {
                        reject(new Error('Invalid format'));
                        return;
                    }
                    const existing = getBookmarks();
                    const merged = [...existing];
                    let added = 0;
                    imported.forEach(bm => {
                        if (bm.link && !merged.some(b => b.link === bm.link)) {
                            merged.push(bm);
                            added++;
                        }
                    });
                    saveBookmarks(merged);
                    resolve(added);
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = () => reject(new Error('File read error'));
            reader.readAsText(file);
        });
    }

    return {
        getBookmarks,
        saveBookmarks,
        addBookmark,
        removeBookmark,
        isBookmarked,
        getBookmarkCount,
        clearAllBookmarks,
        exportBookmarks,
        importBookmarks
    };
})();
