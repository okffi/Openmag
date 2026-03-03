// app.js - Encapsulated in IIFE to prevent global variable pollution
(function () {
    // Constants
    const CONTENT_PREVIEW_LENGTH = 150;
    const PAGE_SIZE = 50;

    // State variables
    let allArticles = [];
    let displayedCount = 0;
    let masonry;
    let isLoading = false;
    let currentCategory = 'All';
    let statsData = null;
    let mainFeedCache = null;
    let translations = {};
    let currentLang = 'all';
    let currentScope = 'all';
    let currentSourceFile = 'data.json';
    let scrollObserver = null;
    let pendingOperation = false;

    // --- APUFUNKTIOT ---
    function t(key, originalValue = null) {
        const lang = document.getElementById('uiLangFilter').value || 'en';
        if (translations[lang] && translations[lang][key]) {
            return translations[lang][key];
        }
        if (translations['en'] && translations['en'][key]) {
            return translations['en'][key];
        }
        return originalValue || (key.includes('.') ? key.split('.')[1].replace(/_/g, ' ') : key);
    }

    function decodeHtml(html) {
        const txt = document.createElement("textarea");
        txt.innerHTML = html;
        return txt.value;
    }

    function getTranslation(group, value) {
        if (!value || value === 'All') return t(`${group}.general`);
        const slug = value.toString()
            .replace(/[\(\)\+]/g, '')
            .trim()
            .replace(/\s+/g, '_')
            .replace(/[^a-zA-Z0-9_]/g, '')
            .replace(/_+/g, '_')
            .toLowerCase();
        return t(`${group}.${slug}`);
    }

    function resetFilters() {
        document.getElementById('langFilter').value = 'all';
        document.getElementById('scopeFilter').value = 'all';
        syncSettingsPanelFromFilters();
        updateView();
    }

    function resetFiltersFromPanel() {
        resetFilters();
        closeSettingsPanel();
    }

    function toggleSettingsPanel() {
        const panel = document.getElementById('settings-panel');
        const btn = document.getElementById('settings-btn');
        const isOpen = panel.classList.contains('open');
        if (isOpen) {
            closeSettingsPanel();
        } else {
            panel.hidden = false;
            // Force reflow so the transition plays
            void panel.offsetHeight;
            panel.classList.add('open');
            btn.classList.add('active');
        }
    }

    function closeSettingsPanel() {
        const panel = document.getElementById('settings-panel');
        const btn = document.getElementById('settings-btn');
        panel.classList.remove('open');
        btn.classList.remove('active');
        panel.addEventListener('transitionend', function handler() {
            panel.removeEventListener('transitionend', handler);
            if (!panel.classList.contains('open')) panel.hidden = true;
        });
    }

    function applySettingsPanel() {
        const selectedLang = document.querySelector('input[name="settings-lang"]:checked');
        const selectedScope = document.querySelector('input[name="settings-scope"]:checked');
        const selectedUiLang = document.querySelector('input[name="settings-ui-lang"]:checked');

        if (selectedLang) document.getElementById('langFilter').value = selectedLang.value;
        if (selectedScope) document.getElementById('scopeFilter').value = selectedScope.value;
        if (selectedUiLang) {
            document.getElementById('uiLangFilter').value = selectedUiLang.value;
            updateUITranslations();
        }

        closeSettingsPanel();
        updateView();
    }

    function syncSettingsPanelFromFilters() {
        const langVal = document.getElementById('langFilter').value;
        const scopeVal = document.getElementById('scopeFilter').value;
        const uiLangVal = document.getElementById('uiLangFilter').value;

        const langRadio = document.querySelector(`input[name="settings-lang"][value="${langVal}"]`);
        if (langRadio) langRadio.checked = true;

        const scopeRadio = document.querySelector(`input[name="settings-scope"][value="${scopeVal}"]`);
        if (scopeRadio) scopeRadio.checked = true;

        const uiLangRadio = document.querySelector(`input[name="settings-ui-lang"][value="${uiLangVal}"]`);
        if (uiLangRadio) uiLangRadio.checked = true;
    }

    function clearGrid() {
        const container = document.querySelector('#magazine-grid');
        const items = container.querySelectorAll('.grid-item');
        items.forEach(el => el.remove());
        if (masonry) {
            masonry.reloadItems();
            masonry.layout();
        }
    }

    function updateView() {
        if (pendingOperation) return;

        // Päivitetään globaalit suodatinarvot valikoista
        currentLang = document.getElementById('langFilter').value;
        currentScope = document.getElementById('scopeFilter').value;

        displayedCount = 0;
        clearGrid();

        displayArticles();
        updateUITranslations();

        const activeView = document.getElementById('btn-az').classList.contains('active') ? 'az' : 'categories';
        showSidebarView(activeView);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // Apufunktio käyttöliittymän tekstien päivittämiseen kielen mukaan
    function updateUITranslations() {
        document.getElementById('sidebar-main-title').textContent = t('ui.publishers');
        document.getElementById('btn-categories').textContent = t('ui.categories');
        document.getElementById('btn-az').textContent = t('ui.az');

        // Settings button label
        const settingsBtnLabel = document.getElementById('settings-btn-label');
        if (settingsBtnLabel) settingsBtnLabel.textContent = t('ui.settings');

        // Settings panel section titles
        const uiLangTitle = document.getElementById('settings-ui-lang-title');
        if (uiLangTitle) uiLangTitle.textContent = t('ui.interface_language').toUpperCase();
        const contentLangTitle = document.getElementById('settings-content-lang-title');
        if (contentLangTitle) contentLangTitle.textContent = t('ui.content_language').toUpperCase();
        const regionTitle = document.getElementById('settings-region-title');
        if (regionTitle) regionTitle.textContent = t('ui.region').toUpperCase();

        // Content language labels
        const langLabelMap = {
            all: 'settings-lang-all-label',
            fi:  'settings-lang-fi-label',
            en:  'settings-lang-en-label',
            sv:  'settings-lang-sv-label',
            de:  'settings-lang-de-label',
            fr:  'settings-lang-fr-label'
        };
        const langTransMap = {
            all: 'ui.all_languages',
            fi:  'lang.finnish',
            en:  'lang.english',
            sv:  'lang.swedish',
            de:  'lang.german',
            fr:  'lang.french'
        };
        Object.keys(langLabelMap).forEach(key => {
            const el = document.getElementById(langLabelMap[key]);
            if (el) el.textContent = t(langTransMap[key]);
        });

        // Region labels
        const scopeLabelMap = {
            'settings-scope-all-label':     t('ui.all_regions'),
            'settings-scope-finland-label': t('reg.finland'),
            'settings-scope-nordic-label':  t('reg.nordic_baltic_countries'),
            'settings-scope-europe-label':  t('reg.europe'),
            'settings-scope-world-label':   t('reg.world')
        };
        Object.keys(scopeLabelMap).forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = scopeLabelMap[id];
        });

        // Fallback note
        const langNote = document.getElementById('settings-lang-note');
        if (langNote) langNote.textContent = t('ui.english_fallback_note');

        // Apply / Reset buttons
        const applyBtn = document.getElementById('settings-apply-btn');
        if (applyBtn) applyBtn.textContent = t('ui.apply').toUpperCase();
        const resetBtn = document.getElementById('settings-reset-btn');
        if (resetBtn) resetBtn.textContent = t('ui.reset_filters').toUpperCase();

        // Päivitetään näkymän otsikko kielen vaihtuessa
        const viewTitle = document.getElementById('current-view-title');
        if (viewTitle && currentSourceFile === 'data.json') {
            if (currentCategory === 'All') {
                viewTitle.textContent = t('ui.latest_news');
            } else {
                viewTitle.textContent = getTranslation('cat', currentCategory);
            }
        }
    }

    // Tunnistetaan kieli ja aloitetaan
    async function init() {
        const userLang = navigator.language.substring(0, 2);
        const supported = ['fi', 'en', 'sv', 'de', 'fr'];
        // Rakennetaan käyttöliittymän kielivalikko: selaimen kieli + englanti
        const uiLangFilter = document.getElementById('uiLangFilter');
        const langNames = { fi: 'Suomi', en: 'English', sv: 'Svenska', de: 'Deutsch', fr: 'Français' };
        uiLangFilter.innerHTML = '';
        if (supported.includes(userLang) && userLang !== 'en') {
            const opt = document.createElement('option');
            opt.value = userLang;
            opt.textContent = langNames[userLang];
            uiLangFilter.appendChild(opt);
        }
        const enOpt = document.createElement('option');
        enOpt.value = 'en';
        enOpt.textContent = langNames['en'];
        uiLangFilter.appendChild(enOpt);
        uiLangFilter.value = supported.includes(userLang) ? userLang : 'en';

        // Rakennetaan käyttöliittymän kielivalinnat asetuspaneeliin
        const uiLangOptions = document.getElementById('settings-ui-lang-options');
        if (uiLangOptions) {
            uiLangOptions.innerHTML = '';
            const uiLangs = supported.includes(userLang) && userLang !== 'en'
                ? [userLang, 'en']
                : ['en'];
            uiLangs.forEach((lang, idx) => {
                const label = document.createElement('label');
                label.className = 'settings-radio-label';
                const radio = document.createElement('input');
                radio.type = 'radio';
                radio.name = 'settings-ui-lang';
                radio.value = lang;
                if (idx === 0) radio.checked = true;
                const span = document.createElement('span');
                span.textContent = langNames[lang];
                label.appendChild(radio);
                label.appendChild(span);
                uiLangOptions.appendChild(label);
            });
        }

        // Masonry-alustus
        const container = document.querySelector('#magazine-grid');
        masonry = new Masonry(container, {
            itemSelector: '.grid-item',
            columnWidth: '.grid-sizer',
            percentPosition: true,
            gutter: 25,
            transitionDuration: '0.4s'
        });
        window.msnry = masonry;

        // Ladataan ensin käännökset
        try {
            const res = await fetch('translations.json?v=' + Date.now());
            translations = await res.json();
        } catch(e) {
            console.warn("Käännökset puuttuvat.");
        }

        await loadData('data.json', true);
        initSidebar();
        updateUITranslations();
        syncSettingsPanelFromFilters();

        // Event listenerit - poistetaan vanhat ennen uusien lisäystä
        const langFilter = document.getElementById('langFilter');
        const scopeFilter = document.getElementById('scopeFilter');
        langFilter.removeEventListener('change', updateView);
        scopeFilter.removeEventListener('change', updateView);
        langFilter.addEventListener('change', updateView);
        scopeFilter.addEventListener('change', updateView);
        uiLangFilter.removeEventListener('change', updateUITranslations);
        uiLangFilter.addEventListener('change', updateUITranslations);

        // Suljetaan asetuspaneeli klikkaamalla sen ulkopuolelle
        document.addEventListener('click', (e) => {
            const panel = document.getElementById('settings-panel');
            const btn = document.getElementById('settings-btn');
            if (panel && panel.classList.contains('open')) {
                if (!panel.contains(e.target) && !btn.contains(e.target)) {
                    closeSettingsPanel();
                }
            }
        });

        // Scroll-tunnistin - katkaistaan mahdollinen aiempi ennen uuden luomista
        if (scrollObserver) scrollObserver.disconnect();
        scrollObserver = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && !isLoading) displayArticles();
        }, { rootMargin: '400px' });
        scrollObserver.observe(document.querySelector('#scroll-sentinel'));
    }

    async function loadData(filePath, isInitial = false, forceRefresh = false) {
        isLoading = true;
        displayedCount = 0;
        const container = document.querySelector('#magazine-grid');
        const sentinel = document.querySelector('#scroll-sentinel');

        sentinel.innerText = t('msg.loading_news');
        container.classList.remove('loaded');
        clearGrid();

        try {
            if (filePath === 'data.json' && mainFeedCache && !isInitial && !forceRefresh) {
                allArticles = mainFeedCache;
                console.log(t('msg.using_cached_feed'));
            } else {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 15000);
                let response;
                try {
                    response = await fetch(filePath + '?v=' + Date.now(), {
                        cache: 'no-cache',
                        headers: { 'Cache-Control': 'no-cache' },
                        signal: controller.signal
                    });
                } finally {
                    clearTimeout(timeoutId);
                }

                if (!response.ok) throw new Error(t('msg.the_server_responded_with_an_error'));

                const data = await response.json();
                if (!Array.isArray(data)) {
                    throw new Error(t('msg.error_loading_news'));
                }
                allArticles = data;

                if (filePath === 'data.json') {
                    mainFeedCache = allArticles;
                }
            }

            sentinel.innerText = "";
            displayArticles();

        } catch (e) {
            console.error("Latausvirhe:", e);
            allArticles = [];
            sentinel.innerText = t('msg.error_loading_news');
            isLoading = false;
        }
    }

    function createArticleCard(item) {
        const img = item.enforcedImage;
        const card = document.createElement('div');
        card.className = `grid-item ${!img ? 'no-image' : ''}`;

        const link = document.createElement('a');
        link.href = item.link || '#';
        link.target = '_blank';
        link.rel = 'noopener';

        if (img) {
            const image = document.createElement('img');
            image.dataset.originalSrc = img;
            let retried = false;
            const onImageLoad = () => {
                image.onerror = null;
                image.onload = null;
                if (masonry && typeof masonry.layout === 'function') masonry.layout();
            };
            image.src = `https://wsrv.nl/?url=${encodeURIComponent(img)}&w=800&q=80&output=png`;
            image.onerror = () => {
                image.onerror = null;
                image.onload = null;
                if (!retried) {
                    retried = true;
                    // Retry with basic parameters as fallback
                    image.onload = onImageLoad;
                    image.onerror = () => {
                        image.onerror = null;
                        image.onload = null;
                        image.remove();
                        card.classList.add('no-image');
                        if (masonry && typeof masonry.layout === 'function') masonry.layout();
                    };
                    image.src = `https://wsrv.nl/?url=${encodeURIComponent(img)}&w=800`;
                } else {
                    image.remove();
                    card.classList.add('no-image');
                    if (masonry && typeof masonry.layout === 'function') masonry.layout();
                }
            };
            image.onload = onImageLoad;
            link.appendChild(image);
        }

        const content = document.createElement('div');
        content.className = 'content';

        const category = document.createElement('span');
        category.className = 'category-label';
        // KÄÄNNÖS: Teksti käännetään, mutta logiikkaan lähetetään item.sheetCategory
        category.textContent = getTranslation('cat', item.sheetCategory);

        category.onclick = (e) => {
            const rawCategory = item.sheetCategory || 'All';
            handleCategoryClick(e, rawCategory);
        };

        const h2 = document.createElement('h2');
        h2.textContent = item.title || '';

        const p = document.createElement('p');
        const clean = (item.content || "").replace(/<[^>]*>/g, '').substring(0, CONTENT_PREVIEW_LENGTH);
        p.textContent = clean + (clean.length ? '...' : '');

        const meta = document.createElement('div');
        meta.className = 'meta-info';

        const src = document.createElement('span');
        src.className = 'source-trigger';
        src.textContent = `${item.sourceTitle || t('ui.general')}${item.creator ? ' | ' + item.creator : ''}`;
        src.onclick = (e) => { e.stopPropagation(); handleSourceClick(e, item.sourceTitle); };

        const dateSpan = document.createElement('span');
        if (item.pubDate) {
            const locale = document.getElementById('langFilter').value === 'fi' ? 'fi-FI' : 'en-GB';
            const d = new Date(item.pubDate);
            const now = new Date();
            const isToday = d.toLocaleDateString(locale) === now.toLocaleDateString(locale);
            const timeStr = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
            const dateStr = d.toLocaleDateString(locale);
            const todayLabel = locale === 'fi-FI' ? 'Tänään' : 'Today';
            dateSpan.textContent = isToday ? `${timeStr} · ${todayLabel}` : `${timeStr} · ${dateStr}`;
            dateSpan.title = d.toLocaleString(locale);
        }

        meta.appendChild(src);
        meta.appendChild(dateSpan);

        content.appendChild(category);
        content.appendChild(h2);
        content.appendChild(p);
        content.appendChild(meta);

        link.appendChild(content);
        card.appendChild(link);

        return card;
    }

    function setViewTitleAndRss(viewTitleEl, title, rssLink, isMainFeed, siteUrl) {
        if (!viewTitleEl) return;

        // 1. Tyhjennetään elementti turvallisesti ilman innerHTML:ää
        while (viewTitleEl.firstChild) {
            viewTitleEl.removeChild(viewTitleEl.firstChild);
        }

        // KÄÄNNÖS: Jos päänäkymä, käytetään käännettyä "Tuoreimmat uutiset"
        const displayTitle = isMainFeed ? t('ui.latest_news') : decodeHtml(title);

        if (isMainFeed) {
            // Päänäkymässä vain teksti. textContent on 100% immuuni XSS-hyökkäyksille.
            viewTitleEl.textContent = displayTitle;
            return;
        } else {
            // Lähdenäkymässä luodaan linkki
            const a = document.createElement('a');
            a.href = siteUrl || '#';
            a.target = '_blank';
            a.rel = 'noopener';
            a.className = 'title-link';
            a.textContent = displayTitle; // Turvallinen tekstin asetus
            viewTitleEl.appendChild(a);

            // Lisätään RSS-ikoni VAIN, jos ollaan lähdenäkymässä
            if (rssLink && rssLink !== 'data.json') {
                const rssA = document.createElement('a');
                rssA.href = rssLink;
                rssA.target = '_blank';
                rssA.rel = 'noopener';
                rssA.className = 'rss-link';
                rssA.title = 'RSS';

                // SVG-ikoni luodaan DOM-metodeilla innerHTML:n sijaan
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('viewBox', '0 0 24 24');
                svg.setAttribute('fill', 'currentColor');
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', 'M6.18,15.64A2.18,2.18,0,0,1,8.36,17.82c0,1.21-.98,2.18-2.18,2.18A2.18,2.18,0,0,1,4,17.82,2.18,2.18,0,0,1,6.18,15.64M4,4.44A15.56,15.56,0,0,1,19.56,20h-2.83A12.73,12.73,0,0,0,4,7.27Zm0,5.66a9.9,9.9,0,0,1,9.9,9.9H11.07A7.07,7.07,0,0,0,4,12.93Z');
                svg.appendChild(path);
                rssA.appendChild(svg);

                viewTitleEl.appendChild(rssA);
            }
        }
    }

    function displayArticles() {
        if (!Array.isArray(allArticles)) return;

        const selectedLang = currentLang;
        const selectedScope = currentScope;

        const filtered = allArticles.filter(art => {
            const langMatch = (selectedLang === 'all') || (art.lang === selectedLang);
            const scopeMatch = (selectedScope === 'all') || (art.scope === selectedScope);
            const catMatch = (currentCategory === 'All') || (art.sheetCategory === currentCategory);
            return langMatch && scopeMatch && catMatch;
        });

        filtered.sort((a, b) => {
            const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
            const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
            return db - da;
        });
        const slice = filtered.slice(displayedCount, displayedCount + PAGE_SIZE);
        const sentinel = document.querySelector('#scroll-sentinel');

        if (slice.length === 0 && displayedCount === 0) {
            const isFiltered = document.getElementById('langFilter').value !== 'all' ||
                               document.getElementById('scopeFilter').value !== 'all';

            while (sentinel.firstChild) { sentinel.removeChild(sentinel.firstChild); }
            if (isFiltered) {
                const msgDiv = document.createElement('div');
                msgDiv.style.padding = '20px';
                const msgP = document.createElement('p');
                msgP.textContent = t('msg.no_news_found_with_the_selected_filters');
                const resetBtn = document.createElement('button');
                resetBtn.style.cssText = 'background:var(--text-dark); color:white; border:none; padding:8px 15px; cursor:pointer; font-size:0.7rem; font-weight:700; text-transform:uppercase;';
                resetBtn.textContent = t('ui.reset_filters');
                resetBtn.onclick = resetFilters;
                msgDiv.appendChild(msgP);
                msgDiv.appendChild(resetBtn);
                sentinel.appendChild(msgDiv);
            } else {
                sentinel.textContent = t('msg._nothing_new_here_right_now_');
            }

            isLoading = false;
            return;
        }

        if (slice.length === 0) {
            sentinel.innerText = t('msg._you_are_up_to_date_');
            isLoading = false;
            return;
        }

        sentinel.innerText = t('msg.loading_more');
        const container = document.querySelector('#magazine-grid');
        const newElements = [];

        slice.forEach(item => {
            const card = createArticleCard(item);
            container.appendChild(card);
            newElements.push(card);
        });

        displayedCount += slice.length;

        imagesLoaded(container, () => {
            if (masonry && typeof masonry.appended === 'function') {
                masonry.appended(newElements);
            }
            if (masonry && typeof masonry.layout === 'function') {
                masonry.layout();
            }
            container.classList.add('loaded');
            isLoading = false;
        });
    }


    async function initSidebar() {
        const list = document.getElementById('source-list');
        if (!list) return;

        if (!statsData) {
            try {
                const response = await fetch('stats.json?v=' + Date.now(), { cache: 'no-store' });
                statsData = await response.json();
            } catch (e) {
                console.error("Sidebar failed", e);
                return;
            }
        }
        const activeView = document.getElementById('btn-az').classList.contains('active') ? 'az' : 'categories';
        showSidebarView(activeView);
    }

    function renderCategoryView(list) {
        list.innerHTML = '';

        const selectedLang = document.getElementById('langFilter').value;
        const selectedScope = document.getElementById('scopeFilter').value;

        const mainItem = document.createElement('div');
        mainItem.className = 'source-item active';
        mainItem.textContent = t('ui.latest_news');
        mainItem.onclick = (e) => changeSource('data.json', t('ui.latest_news'), e.currentTarget);
        list.appendChild(mainItem);

        const cats = {};
        Object.keys(statsData).forEach(name => {
            if (name === "__meta") return;

            const info = statsData[name];
            const langMatch = (selectedLang === 'all') || (info.lang === selectedLang);
            const scopeMatch = (selectedScope === 'all') || (info.scope === selectedScope);

            if (!langMatch || !scopeMatch) return;

            const cat = info.category || "General";
            if (!cats[cat]) cats[cat] = [];
            cats[cat].push({ name, ...info });
        });

        Object.keys(cats).sort().forEach(catName => {
            const group = document.createElement('div');
            group.className = 'category-group';

            const header = document.createElement('div');
            header.className = 'category-header';
            // KÄÄNNÖS
            header.textContent = getTranslation('cat', catName);

            const submenu = document.createElement('div');
            submenu.className = 'source-submenu';

            header.onclick = () => {
                const wasOpen = group.classList.contains('open');
                document.querySelectorAll('.category-group').forEach(g => g.classList.remove('open'));
                if (!wasOpen) group.classList.add('open');
                filterByCategory(catName);
            };

            cats[catName].sort((a,b) => a.name.localeCompare(b.name, 'fi')).forEach(src => {
                const item = document.createElement('div');
                item.className = 'source-item';

                item.textContent = src.name + ' ';
                const countSpan = document.createElement('span');
                countSpan.textContent = src.count;
                item.appendChild(countSpan);

                item.onclick = (e) => {
                    e.stopPropagation();
                    changeSource(`sources/${src.file}`, src.name, item);
                };
                submenu.appendChild(item);
            });

            group.appendChild(header);
            group.appendChild(submenu);
            list.appendChild(group);
        });
    }

    function renderAZView(list) {
        list.innerHTML = '';

        const selectedLang = document.getElementById('langFilter').value;
        const selectedScope = document.getElementById('scopeFilter').value;

        const mainItem = document.createElement('div');
        mainItem.className = 'source-item';
        mainItem.textContent = t('ui.latest_news');
        mainItem.onclick = (e) => changeSource('data.json', t('ui.latest_news'), e.currentTarget);
        list.appendChild(mainItem);

        const sortedSources = Object.keys(statsData)
            .filter(key => {
                if (key === "__meta") return false;

                const info = statsData[key];
                const langMatch = (selectedLang === 'all') || (info.lang === selectedLang);
                const scopeMatch = (selectedScope === 'all') || (info.scope === selectedScope);

                return langMatch && scopeMatch;
            })
            .sort((a, b) => a.localeCompare(b, 'fi'));

        sortedSources.forEach(sourceName => {
            const info = statsData[sourceName];
            const item = document.createElement('div');
            item.className = 'source-item';

            item.textContent = sourceName + ' ';

            const countSpan = document.createElement('span');
            countSpan.className = 'count-badge';
            countSpan.textContent = info.count;

            item.appendChild(countSpan);
            item.onclick = () => changeSource(`sources/${info.file}`, sourceName, item);

            list.appendChild(item);
        });
    }

    function showSidebarView(view) {
        const list = document.getElementById('source-list');
        const btnCat = document.getElementById('btn-categories');
        const btnAz = document.getElementById('btn-az');

        if (view === 'az') {
            btnAz.classList.add('active');
            btnCat.classList.remove('active');
            renderAZView(list);
        } else {
            btnCat.classList.add('active');
            btnAz.classList.remove('active');
            renderCategoryView(list);
        }
    }

    async function changeSource(file, title, el) {
        if (pendingOperation) return;
        pendingOperation = true;
        try {
            const viewTitle = document.getElementById('current-view-title');
            const viewDesc = document.getElementById('current-view-description');
            const logoCont = document.getElementById('feed-logo-container');

            const isMainFeed = (file === 'data.json');
            const displayTitle = isMainFeed ? t('ui.latest_news') : title;

            currentSourceFile = file;

            if (viewTitle) viewTitle.textContent = displayTitle;
            if (viewDesc) viewDesc.innerText = t('msg.loading_news');

            if (logoCont) {
                logoCont.style.display = isMainFeed ? 'none' : 'flex';
                logoCont.innerHTML = "";
                logoCont.classList.remove('dark-bg');
            }

            currentCategory = 'All';
            displayedCount = 0;

            if (!isMainFeed) {
                mainFeedCache = null;
            }

            document.querySelectorAll('.source-item').forEach(i => i.classList.remove('active'));

            if (el) {
                el.classList.add('active');
            } else if (isMainFeed) {
                document.querySelectorAll('.source-item').forEach(i => {
                    if (i.textContent.includes(t('ui.latest_news'))) i.classList.add('active');
                });
            }

            await loadData(file);

            if (Array.isArray(allArticles) && allArticles.length > 0) {
                const first = allArticles[0];
                const rssLink = first.originalRssUrl || (isMainFeed ? 'data.json' : file);

                if (!isMainFeed && logoCont) {
                    if (first.isDarkLogo) logoCont.classList.add('dark-bg');
                    if (first.sourceLogo) {
                        const img = document.createElement('img');
                        img.src = first.sourceLogo;
                        img.alt = title;
                        logoCont.appendChild(img);
                    }
                }

                let siteUrl = "#";
                if (!isMainFeed) {
                    try { siteUrl = new URL(first.link).origin; } catch(e) {}
                }

                setViewTitleAndRss(viewTitle, title, rssLink, isMainFeed, siteUrl);

                if (viewDesc) {
                    if (isMainFeed) {
                        const lastUpdate = (statsData && statsData.__meta)
                            ? statsData.__meta.last_updated
                            : "";

                        viewDesc.innerText = `${t('ui.a_collection_of_the_latest_news_from_followed_sources')} ${lastUpdate ? t('ui.updated_') + lastUpdate + ')' : ''}`;
                    } else {
                        viewDesc.innerText = first.sourceDescription || "";
                    }
                }
            }

            if (window.innerWidth < 1000) {
                const sidebar = document.getElementById('source-sidebar');
                if (sidebar) sidebar.classList.remove('open');
            }

            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (e) {
            console.error("Error in changeSource:", e);
            const viewDesc = document.getElementById('current-view-description');
            if (viewDesc) viewDesc.innerText = t('msg.error_loading_news');
        } finally {
            pendingOperation = false;
        }
    }

    function filterByCategory(catName) {
        currentCategory = catName;
        const viewTitle = document.getElementById('current-view-title');
        const viewDesc = document.getElementById('current-view-description');
        const logoCont = document.getElementById('feed-logo-container');

        // KÄÄNNÖS: Näytetään käännetty nimi, mutta logiikka käyttää catNamea
        if (viewTitle) viewTitle.innerText = getTranslation('cat', catName);

        if (viewDesc) viewDesc.innerText = `${t('ui.latest_news_from_the_category')} ${getTranslation('cat', catName)}`;
        if (logoCont) {
            logoCont.innerHTML = "";
            logoCont.style.display = 'none';
        }

        displayedCount = 0;
        document.querySelectorAll('.source-item').forEach(i => i.classList.remove('active'));
        mainFeedCache = null;
        loadData('data.json');

        if (window.innerWidth < 1000) {
            const sidebar = document.getElementById('source-sidebar');
            if (sidebar) sidebar.classList.remove('open');
        }
    }

    function handleCategoryClick(event, catName) {
        event.preventDefault();
        event.stopPropagation();
        filterByCategory(catName);
    }

    async function handleSourceClick(event, sourceName) {
        event.preventDefault();
        event.stopPropagation();
        if (statsData && statsData[sourceName]) {
            changeSource(`sources/${statsData[sourceName].file}`, sourceName, null);
        }
    }

    function toggleSidebar() {
        const sidebar = document.getElementById('source-sidebar');
        if (window.innerWidth < 1000) {
            sidebar.classList.toggle('open');
        } else {
            sidebar.classList.toggle('closed');
            setTimeout(() => masonry.layout(), 450);
        }
    }

    // Expose functions needed from HTML attributes
    window.toggleSidebar = toggleSidebar;
    window.showSidebarView = showSidebarView;
    window.resetFilters = resetFilters;
    window.toggleSettingsPanel = toggleSettingsPanel;
    window.applySettingsPanel = applySettingsPanel;
    window.resetFiltersFromPanel = resetFiltersFromPanel;

    init();
})();
