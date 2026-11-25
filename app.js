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
    let isBookmarksView = false;
    let currentCategory = 'All';
    let statsData = null;
    let mainFeedCache = null;
    let translations = {};
    let currentLang = 'all';
    let currentScope = 'all';
    let currentSourceFile = 'data.json';
    let scrollObserver = null;
    let pendingOperation = false;
    let sourcePreferences = null;
    let currentSourceName = null;
    let isTouchDevice = () => {
        return (('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (navigator.msMaxTouchPoints > 0));
    };
    let activeConfirmationRow = null;

    function topicSources(category) {
        return Object.keys(statsData || {}).filter(name =>
            name !== '__meta' && (statsData[name].category || 'General') === category
        );
    }

    function syncSourceControls() {
        // Update all source visibility toggles (sidebar and cards)
        document.querySelectorAll('[data-preference-source]').forEach(toggle => {
            const sourceName = toggle.dataset.preferenceSource;
            const isEnabled = !sourcePreferences || sourcePreferences.isEnabled(sourceName);
            updateVisibilityToggle(toggle, isEnabled);
            if (toggle.disabled !== undefined) toggle.disabled = !sourcePreferences;
            const label = isEnabled ? t('ui.display_source') : t('ui.hide_source');
            toggle.setAttribute('aria-label', label);
        });
        
        // Update topic toggles
        document.querySelectorAll('[data-preference-topic]').forEach(toggle => {
            const topic = toggle.dataset.preferenceTopic;
            const names = topicSources(topic);
            const enabled = names.filter(name => !sourcePreferences || sourcePreferences.isEnabled(name)).length;
            const isAllEnabled = enabled === names.length;
            const isSomeEnabled = enabled > 0;
            const isMixed = isSomeEnabled && !isAllEnabled;
            
            if (isMixed) {
                updateVisibilityToggle(toggle, 'mixed');
            } else {
                updateVisibilityToggle(toggle, isAllEnabled);
            }
            
            if (toggle.disabled !== undefined) toggle.disabled = !sourcePreferences || names.length === 0;
            const label = isAllEnabled ? t('ui.display_topic') : t('ui.hide_topic');
            toggle.setAttribute('aria-label', label);
        });
        
        // Update sidebar source items visibility state
        document.querySelectorAll('.source-item').forEach(item => {
            const toggle = item.querySelector('[data-preference-source]');
            if (toggle) {
                const isEnabled = !sourcePreferences || sourcePreferences.isEnabled(toggle.dataset.preferenceSource);
                updateVisibilityToggle(toggle, isEnabled);
                item.setAttribute('data-visible', isEnabled ? 'true' : 'false');
            }
        });
    }

    function updateVisibilityToggle(toggle, state) {
        const dot = toggle.querySelector('.visibility-dot');
        
        if (state === 'mixed') {
            toggle.setAttribute('data-visible', 'mixed');
        } else if (state) {
            toggle.setAttribute('data-visible', 'true');
            if (dot) dot.style.background = 'var(--primary-color)';
        } else {
            toggle.setAttribute('data-visible', 'false');
            if (dot) dot.style.background = '#ccc';
        }
        return state;
    }

    function showTouchConfirmation(button, sourceName, isTopic, onConfirm) {
        // Hide any existing confirmation row
        if (activeConfirmationRow && activeConfirmationRow !== button) {
            const existingRow = document.getElementById(activeConfirmationRow);
            if (existingRow) existingRow.classList.remove('active');
        }
        
        // Find or create confirmation row
        let confirmationId = `confirm-${sourceName.replace(/[^a-z0-9]/gi, '-')}`;
        let confirmationRow = document.getElementById(confirmationId);
        
        if (!confirmationRow) {
            confirmationRow = document.createElement('div');
            confirmationRow.id = confirmationId;
            confirmationRow.className = 'visibility-confirmation-row';
            
            const text = document.createElement('span');
            text.className = 'visibility-confirmation-text';
            text.textContent = isTopic 
                ? t('ui.hide_topic') 
                : t('ui.hide_source');
            confirmationRow.appendChild(text);
            
            const buttonContainer = document.createElement('div');
            buttonContainer.className = 'visibility-confirmation-buttons';
            
            const confirmBtn = document.createElement('button');
            confirmBtn.className = 'visibility-confirm-btn';
            confirmBtn.textContent = t('ui.apply');
            confirmBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                confirmationRow.classList.remove('active');
                activeConfirmationRow = null;
                onConfirm();
            });
            
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'visibility-cancel-btn';
            cancelBtn.textContent = t('ui.reset_filters');
            cancelBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                confirmationRow.classList.remove('active');
                activeConfirmationRow = null;
            });
            
            buttonContainer.appendChild(confirmBtn);
            buttonContainer.appendChild(cancelBtn);
            confirmationRow.appendChild(buttonContainer);
            
            // Insert after the button's parent item
            const parentItem = button.closest('.source-item, .category-header, .meta-info');
            if (parentItem && parentItem.nextSibling) {
                parentItem.parentNode.insertBefore(confirmationRow, parentItem.nextSibling);
            } else if (parentItem) {
                parentItem.parentNode.appendChild(confirmationRow);
            } else {
                document.body.appendChild(confirmationRow);
            }
        }
        
        confirmationRow.classList.add('active');
        activeConfirmationRow = confirmationId;
    }

    function refreshSourceSelection() {
        syncSourceControls();
        if (!isBookmarksView && currentSourceFile === 'data.json') {
            displayedCount = 0;
            clearGrid();
            displayArticles();
        }
    }

    function createVisibilityToggle(name, isTopic = false) {
        const button = document.createElement('button');
        button.className = 'visibility-toggle';
        button.type = 'button';
        
        const dot = document.createElement('div');
        dot.className = 'visibility-dot';
        button.appendChild(dot);
        
        if (isTopic) {
            button.dataset.preferenceTopic = name;
        } else {
            button.dataset.preferenceSource = name;
        }
        
        const handleToggle = () => {
            const names = isTopic ? topicSources(name) : [name];
            if (!sourcePreferences || names.length === 0) return;
            
            try {
                // For mixed state topic, enable all; otherwise toggle
                const isMixed = button.getAttribute('data-visible') === 'mixed';
                if (isTopic && isMixed) {
                    sourcePreferences.setEnabled(names, true);
                } else {
                    const isCurrentlyEnabled = names.every(n => sourcePreferences.isEnabled(n));
                    sourcePreferences.setEnabled(names, !isCurrentlyEnabled);
                }
            } catch (error) {
                console.error('Error saving source preferences:', error);
                syncSourceControls();
                window.alert(t('msg.source_preferences_save_error'));
                return;
            }
            refreshSourceSelection();
        };
        
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            
            // On touch devices, show confirmation instead of immediately toggling
            if (isTouchDevice()) {
                showTouchConfirmation(button, name, isTopic, handleToggle);
            } else {
                handleToggle();
            }
        });
        
        // Keyboard accessibility: Enter and Space (always immediate, no confirmation)
        button.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                handleToggle();
            }
        });
        
        return button;
    }

    function createPreferenceControl(name, isTopic = false) {
        const label = document.createElement('label');
        label.className = 'preference-switch';
        const input = document.createElement('input');
        input.type = 'checkbox';
        if (isTopic) input.dataset.preferenceTopic = name;
        else input.dataset.preferenceSource = name;
        label.appendChild(input);
        label.addEventListener('click', event => event.stopPropagation());
        input.addEventListener('change', () => {
            const names = isTopic ? topicSources(name) : [name];
            try {
                sourcePreferences.setEnabled(names, input.checked);
            } catch (error) {
                console.error('Error saving source preferences:', error);
                syncSourceControls();
                window.alert(t('msg.source_preferences_save_error'));
                return;
            }
            refreshSourceSelection();
        });
        return label;
    }

        function renderSourceHeaderControl() {
        const container = document.getElementById('source-preference-control');
        container.replaceChildren();
        if (currentSourceName && !isBookmarksView) {
            const toggle = createVisibilityToggle(currentSourceName);
            const text = document.createElement('span');
            text.className = 'preference-text';
            text.textContent = t('ui.follow_source');
            toggle.appendChild(text);
            toggle.style.display = 'inline-flex';
            toggle.style.gap = '8px';
            container.appendChild(toggle);
        }
        syncSourceControls();
    }

    // --- HELPERS ---
    function t(key, originalValue = null) {
        const lang = document.getElementById('uiLangFilter').value || 'en';
        if (translations[lang] && translations[lang][key]) return translations[lang][key];
        if (translations['en'] && translations['en'][key]) return translations['en'][key];
        return originalValue || (key.includes('.') ? key.split('.')[1].replace(/_/g, ' ') : key);
    }

    function decodeHtml(html) {
        const txt = document.createElement("textarea");
        txt.innerHTML = html;
        return txt.value;
    }

    function normalizeText(text) {
        if (!text) return text;
        text = text.replace(/&nbsp;/gi, ' ');
        text = text.replace(/&#160;/g, ' ');
        text = text.replace(/[\u200B-\u200D\uFEFF\u2060\u061C\u200E\u200F\u180E]/g, '');
        text = text.replace(/\u00A0/g, ' ');
        text = text.replace(/\r\n/g, '\n');
        text = text.replace(/[ \t]+\n/g, '\n');
        text = text.replace(/\n{3,}/g, '\n\n');
        text = text.replace(/ {2,}/g, ' ');
        text = text.replace(/&amp;/gi, '&');
        text = text.replace(/&quot;/gi, '"');
        text = text.replace(/&#39;/g, "'");
        text = text.replace(/&lt;/gi, '<');
        text = text.replace(/&gt;/gi, '>');
        return text.trim();
    }

    function escapeRegExp(text) {
        return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function stripMarkupToText(text) {
        if (!text) return "";
        const withBreaks = String(text)
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/(p|li|blockquote|pre|div|section|article|h[1-6])>/gi, '\n\n')
            .replace(/<[^>]*>/g, ' ');

        return normalizeText(decodeHtml(withBreaks));
    }

    function comparableText(text) {
        return stripMarkupToText(text)
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '');
    }

    function isCallToActionOnly(text) {
        return /^(?:read|lue)\b.{0,50}$/i.test(text);
    }

    function stripKnownBoilerplate(text, title = "") {
        let cleaned = stripMarkupToText(text);
        const normalizedTitle = stripMarkupToText(title);

        cleaned = cleaned.replace(/\bThe post .+? appeared first on .+?(?=(?:[.!?](?:\s|$))|$)/gi, ' ');
        cleaned = cleaned.replace(/\b(?:admin|editor|staff)\b[^.!?\n]*\b(?:mon|tue|wed|thu|fri|sat|sun)\b[^.!?\n]*/gi, ' ');

        if (normalizedTitle) {
            const titlePrefix = new RegExp(`^${escapeRegExp(normalizedTitle)}(?:\\s*[|:–—-]\\s*|\\s+)`, 'i');
            cleaned = cleaned.replace(titlePrefix, '');
        }

        return normalizeText(cleaned);
    }

    function isMetadataOnly(text) {
        if (!text) return true;
        const normalized = normalizeText(text);

        return /^the post .+ appeared first on .+\.?$/i.test(normalized)
            || /^(?:admin|editor|staff|kirjoittanut|posted by|by)\b.*(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\b(?:mon|tue|wed|thu|fri|sat|sun)\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b)/i.test(normalized)
            || /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}(?:\s+(?:klo|at)\s+\d{1,2}[:.]\d{2}(?:[:.]\d{2})?)?$/i.test(normalized);
    }

    function isTitleLike(text, title = "") {
        const candidateComparable = comparableText(text);
        return Boolean(candidateComparable && title && candidateComparable === comparableText(title));
    }

    function cleanupPreviewText(text, title = "") {
        const normalized = stripMarkupToText(text);
        if (!normalized) return "";

        const cleaned = normalized
            .split(/\n{2,}/)
            .map(segment => stripKnownBoilerplate(segment, title))
            .filter(segment => comparableText(segment) && !isCallToActionOnly(segment) && !isMetadataOnly(segment) && !isTitleLike(segment, title))
            .join('\n\n');

        const result = normalizeText(cleaned);
        if (!result || isMetadataOnly(result) || isTitleLike(result, title)) return "";
        return result;
    }

    function isGenericSourceDescription(text, sourceTitle = "") {
        if (!text) return true;
        const normalized = stripMarkupToText(text);

        return comparableText(normalized) === comparableText(sourceTitle)
            || /^(?:latest|recent)\s+(?:news|updates|posts|articles|stories|press releases?)(?:\s+from\s+.+)?$/i.test(normalized)
            || /^(?:news|updates|posts|articles|stories|press releases?|blog|blogi|homepage|home)$/i.test(normalized)
            || /^uusimmat\s+(?:uutiset|tiedotteet|artikkelit)$/i.test(normalized)
            || /^tiedotteiden\s+tehokas\s+julkaisukanava$/i.test(normalized);
    }

    function getPreviewText(item) {
        const candidates = [item.snippet, item.content];
        for (const candidate of candidates) {
            const cleaned = cleanupPreviewText(candidate, item.title);
            if (cleaned) return cleaned;
        }
        return "";
    }

    function getSourceDescriptionText(item) {
        const cleaned = cleanupPreviewText(item && item.sourceDescription, "");
        if (!cleaned || isGenericSourceDescription(cleaned, item && item.sourceTitle)) return "";
        return cleaned;
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
        const selectedLang = document.getElementById('settings-content-lang-select');
        const selectedScope = document.querySelector('input[name="settings-scope"]:checked');
        const selectedUiLang = document.getElementById('settings-ui-lang-select');

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

        const contentLangSelect = document.getElementById('settings-content-lang-select');
        if (contentLangSelect) contentLangSelect.value = langVal;
        const scopeRadio = document.querySelector(`input[name="settings-scope"][value="${scopeVal}"]`);
        if (scopeRadio) scopeRadio.checked = true;
        const uiLangSelect = document.getElementById('settings-ui-lang-select');
        if (uiLangSelect) uiLangSelect.value = uiLangVal;
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
        if (isBookmarksView) return;

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

    function populateContentLangSelect(uiLang) {
        const select = document.getElementById('settings-content-lang-select');
        if (!select) return;
        const currentVal = select.value;
        select.innerHTML = '';

        // "All languages" option
        const allOpt = document.createElement('option');
        allOpt.value = 'all';
        allOpt.textContent = t('ui.all_languages');
        select.appendChild(allOpt);

        // All language codes from translations
        const languageCodes = Object.keys(translations);
        languageCodes.forEach(langCode => {
            const opt = document.createElement('option');
            opt.value = langCode;
            opt.textContent =
                (translations[uiLang] && translations[uiLang]['lang.' + langCode]) ||
                (translations['en'] && translations['en']['lang.' + langCode]) ||
                langCode;
            select.appendChild(opt);
        });

        // Restore previous selection if still valid
        if (currentVal && Array.from(select.options).some(opt => opt.value === currentVal)) {
            select.value = currentVal;
        } else {
            select.value = 'all';
        }
    }

    function populateUiLangDropdown() {
        const uiLangFilter = document.getElementById('uiLangFilter');
        const uiLangSelect = document.getElementById('settings-ui-lang-select');

        const languageCodes = Object.keys(translations);
        const browserLang = (navigator.language || 'en').substring(0, 2);
        const defaultLang = languageCodes.includes(browserLang) ? browserLang : 'en';

        // Populate hidden filter (used by t())
        uiLangFilter.innerHTML = '';
        const hiddenOpt = document.createElement('option');
        hiddenOpt.value = defaultLang;
        uiLangFilter.appendChild(hiddenOpt);
        uiLangFilter.value = defaultLang;

        // Populate settings panel dropdown with ALL available languages
        if (uiLangSelect) {
            uiLangSelect.innerHTML = '';
            languageCodes.forEach(langCode => {
                const opt = document.createElement('option');
                opt.value = langCode;
                opt.textContent =
                    (translations[langCode] && translations[langCode]['lang.' + langCode]) ||
                    (translations['en'] && translations['en']['lang.' + langCode]) ||
                    langCode;
                uiLangSelect.appendChild(opt);
            });
            uiLangSelect.value = defaultLang;
        }
    }

    // Updates UI wording for buttons, labels, etc
    function updateUITranslations() {
        document.getElementById('btn-categories').textContent = t('ui.categories');
        document.getElementById('btn-az').textContent = t('ui.az');

        const settingsBtnLabel = document.getElementById('settings-btn-label');
        if (settingsBtnLabel) settingsBtnLabel.textContent = t('ui.settings');
        const uiLangTitle = document.getElementById('settings-ui-lang-title');
        if (uiLangTitle) uiLangTitle.textContent = t('ui.interface_language').toUpperCase();
        const contentLangTitle = document.getElementById('settings-content-lang-title');
        if (contentLangTitle) contentLangTitle.textContent = t('ui.preferred_language').toUpperCase();
        const regionTitle = document.getElementById('settings-region-title');
        if (regionTitle) regionTitle.textContent = t('ui.region').toUpperCase();

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

        const langNote = document.getElementById('settings-lang-note');
        if (langNote) langNote.textContent = t('ui.english_fallback_note');
        const applyBtn = document.getElementById('settings-apply-btn');
        if (applyBtn) applyBtn.textContent = t('ui.apply').toUpperCase();
        const resetBtn = document.getElementById('settings-reset-btn');
        if (resetBtn) resetBtn.textContent = t('ui.reset_filters').toUpperCase();

        const viewTitle = document.getElementById('current-view-title');
        if (viewTitle && currentSourceFile === 'data.json') {
            if (currentCategory === 'All') {
                viewTitle.textContent = t('ui.latest_news');
            } else {
                viewTitle.textContent = getTranslation('cat', currentCategory);
            }
        }
        renderSourceHeaderControl();
    }

    async function init() {
        try {
            const res = await fetch('translations.json?v=' + Date.now());
            translations = await res.json();
        } catch (e) {
            console.warn("Käännökset puuttuvat.");
        }

        populateUiLangDropdown();
        const uiLangFilter = document.getElementById('uiLangFilter');
        let uiLang = uiLangFilter.value || 'en';
        populateContentLangSelect(uiLang);

        try {
            sourcePreferences = window.createSourcePreferences(window.localStorage);
            sourcePreferences.reload();
        } catch (error) {
            sourcePreferences = null;
            console.error('Error reading source preferences:', error);
            window.alert(t('msg.source_preferences_load_error'));
        }
        window.addEventListener('storage', event => {
            if (!sourcePreferences || (event.key !== sourcePreferences.storageKey && event.key !== null)) return;
            try {
                sourcePreferences.reload();
            } catch (error) {
                console.error('Error reading source preferences:', error);
                window.alert(t('msg.source_preferences_load_error'));
                return;
            }
            refreshSourceSelection();
        });

        // Masonry init
        const container = document.querySelector('#magazine-grid');
        masonry = new Masonry(container, {
            itemSelector: '.grid-item',
            columnWidth: '.grid-sizer',
            percentPosition: true,
            gutter: 25,
            transitionDuration: '0.4s'
        });
        window.msnry = masonry;

        await loadData('data.json', true);
        initSidebar();
        updateUITranslations();
        syncSettingsPanelFromFilters();

        // Event handlers
        const langFilter = document.getElementById('langFilter');
        const scopeFilter = document.getElementById('scopeFilter');
        langFilter.removeEventListener('change', updateView);
        scopeFilter.removeEventListener('change', updateView);
        langFilter.addEventListener('change', updateView);
        scopeFilter.addEventListener('change', updateView);

        uiLangFilter.removeEventListener('change', updateUITranslations);
        uiLangFilter.addEventListener('change', updateUITranslations);

        // Update content lang select and UI text on UI language change
        uiLangFilter.addEventListener('change', () => {
            const newUiLang = uiLangFilter.value;
            populateContentLangSelect(newUiLang);
            updateUITranslations();
        });

        // Also sync uiLangFilter when the settings panel select changes
        const uiLangSelectEl = document.getElementById('settings-ui-lang-select');
        if (uiLangSelectEl) {
            uiLangSelectEl.addEventListener('change', () => {
                uiLangFilter.value = uiLangSelectEl.value;
                populateContentLangSelect(uiLangSelectEl.value);
                updateUITranslations();
            });
        }

        document.addEventListener('click', (e) => {
            const panel = document.getElementById('settings-panel');
            const btn = document.getElementById('settings-btn');
            if (panel && panel.classList.contains('open')) {
                if (!panel.contains(e.target) && !btn.contains(e.target)) {
                    closeSettingsPanel();
                }
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const panel = document.getElementById('settings-panel');
                if (panel && panel.classList.contains('open')) {
                    closeSettingsPanel();
                }
            }
        });

        // Infinite scroll observer
        if (scrollObserver) scrollObserver.disconnect();
        scrollObserver = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting && !isLoading && !isBookmarksView) displayArticles();
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
        const clean = getPreviewText(item).substring(0, CONTENT_PREVIEW_LENGTH);
        p.textContent = clean + (clean.length ? '...' : '');

        const meta = document.createElement('div');
        meta.className = 'meta-info';

        const src = document.createElement('span');
        src.className = 'source-trigger';
        src.textContent = `${item.sourceTitle || t('ui.general')}${item.creator ? ' | ' + item.creator : ''}`;
        src.onclick = (e) => { e.stopPropagation(); handleSourceClick(e, item.sourceTitle); };

        const dateSpan = document.createElement('span');
        if (item.pubDate) {
            const uiLang = document.getElementById('uiLangFilter').value;
            const localeMap = { fi: 'fi-FI', en: 'en-GB', sv: 'sv-SE', et: 'et-EE', de: 'de-DE', fr: 'fr-FR' };
            const locale = localeMap[uiLang] || 'en-GB';
            const d = new Date(item.pubDate);
            const now = new Date();
            const isToday = d.toLocaleDateString(locale) === now.toLocaleDateString(locale);
            const timeStr = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
            const dateStr = d.toLocaleDateString(locale);
            const todayLabel = t('ui.today');
            dateSpan.textContent = isToday ? `${timeStr} · ${todayLabel}` : `${timeStr} · ${dateStr}`;
            dateSpan.title = d.toLocaleString(locale);
        }

        meta.appendChild(src);
        
        // Add visibility toggle dot between source and date
        if (item.sourceTitle) {
            const visToggle = document.createElement('button');
            visToggle.className = 'card-visibility-toggle';
            visToggle.dataset.preferenceSource = item.sourceTitle;
            visToggle.dataset.source = item.sourceTitle;
            visToggle.type = 'button';
            
            const dot = document.createElement('div');
            dot.className = 'visibility-dot';
            visToggle.appendChild(dot);
            
            const handleToggle = () => {
                if (!sourcePreferences) return;
                
                const isEnabled = sourcePreferences.isEnabled(item.sourceTitle);
                try {
                    sourcePreferences.setEnabled([item.sourceTitle], !isEnabled);
                } catch (error) {
                    console.error('Error saving source preferences:', error);
                    syncSourceControls();
                    window.alert(t('msg.source_preferences_save_error'));
                    return;
                }
                refreshSourceSelection();
            };
            
            visToggle.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // On touch devices, show confirmation instead of immediately toggling
                if (isTouchDevice()) {
                    showTouchConfirmation(visToggle, item.sourceTitle, false, handleToggle);
                } else {
                    handleToggle();
                }
            });
            
            // Keyboard accessibility: Enter and Space (always immediate, no confirmation)
            visToggle.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    handleToggle();
                }
            });
            
            const isEnabled = sourcePreferences && sourcePreferences.isEnabled(item.sourceTitle);
            const label = isEnabled 
                ? t('ui.display_source') 
                : t('ui.hide_source');
            visToggle.setAttribute('aria-label', label);
            visToggle.setAttribute('data-visible', isEnabled ? 'true' : 'false');
            
            meta.appendChild(visToggle);
        }
        
        meta.appendChild(dateSpan);

        content.appendChild(category);
        content.appendChild(h2);
        content.appendChild(p);
        content.appendChild(meta);

        link.appendChild(content);
        card.appendChild(link);

        // --- BOOKMARK BUTTON (upper right corner) ---
        const bookmarkBtn = document.createElement('button');
        bookmarkBtn.className = 'bookmark-btn';
        bookmarkBtn.setAttribute('data-link', item.link);
        
        // Set initial state
        const updateButtonState = () => {
            const isBookmarked = window.BookmarkManager && window.BookmarkManager.isBookmarked(item.link);
            bookmarkBtn.textContent = isBookmarked ? '★' : '☆';
            bookmarkBtn.setAttribute('aria-pressed', isBookmarked);
        };
        
        updateButtonState();
        
        // Handle bookmark click
        bookmarkBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            if (!window.BookmarkManager) return;
            
            if (window.BookmarkManager.isBookmarked(item.link)) {
                window.BookmarkManager.remove(item.link);
            } else {
                window.BookmarkManager.add(item);
            }
            updateButtonState();
        });
        
        card.appendChild(bookmarkBtn);
        // --- END BOOKMARK BUTTON ---

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
            // Add title link
            const a = document.createElement('a');
            a.href = siteUrl || '#';
            a.target = '_blank';
            a.rel = 'noopener';
            a.className = 'title-link';
            a.textContent = displayTitle;
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

            // Add visibility toggle icon (after RSS icon)
            if (currentSourceName && !isMainFeed) {
                const visButton = document.createElement('button');
                visButton.className = 'source-page-visibility-toggle';
                visButton.type = 'button';
                visButton.dataset.preferenceSource = currentSourceName;
                
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('viewBox', '0 0 24 24');
                svg.setAttribute('fill', 'currentColor');
                
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                // Eye icon (open/visible state)
                path.setAttribute('d', 'M12,9A3,3 0 0,0 9,12A3,3 0 0,0 12,15A3,3 0 0,0 15,12A3,3 0 0,0 12,9M12,17A5,5 0 0,1 7,12A5,5 0 0,1 12,7A5,5 0 0,1 17,12A5,5 0 0,1 12,17M12,4.5C7,4.5 2.73,7.61 1,12C2.73,16.39 7,19.5 12,19.5C17,19.5 21.27,16.39 23,12C21.27,7.61 17,4.5 12,4.5Z');
                svg.appendChild(path);
                visButton.appendChild(svg);
                
                const isEnabled = !sourcePreferences || sourcePreferences.isEnabled(currentSourceName);
                const label = isEnabled ? t('ui.display_source') : t('ui.hide_source');
                visButton.setAttribute('aria-label', label);
                visButton.setAttribute('title', label);
                visButton.setAttribute('data-visible', isEnabled ? 'true' : 'false');
                
                const handleVisibilityToggle = () => {
                    if (!sourcePreferences || !currentSourceName) return;
                    
                    const isCurrentlyEnabled = sourcePreferences.isEnabled(currentSourceName);
                    try {
                        sourcePreferences.setEnabled([currentSourceName], !isCurrentlyEnabled);
                    } catch (error) {
                        console.error('Error saving source preferences:', error);
                        syncSourceControls();
                        window.alert(t('msg.source_preferences_save_error'));
                        return;
                    }
                    refreshSourceSelection();
                };
                
                visButton.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    // On touch devices, show confirmation instead of immediately toggling
                    if (isTouchDevice()) {
                        showTouchConfirmation(visButton, currentSourceName, false, handleVisibilityToggle);
                    } else {
                        handleVisibilityToggle();
                    }
                });
                
                // Keyboard accessibility (always immediate, no confirmation)
                visButton.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        handleVisibilityToggle();
                    }
                });
                
                viewTitleEl.appendChild(visButton);
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
            const sourceMatch = currentSourceFile !== 'data.json' || !sourcePreferences || sourcePreferences.isEnabled(art.sourceTitle);
            return langMatch && scopeMatch && catMatch && sourceMatch;
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
            const hiddenBySource = currentSourceFile === 'data.json' && sourcePreferences &&
                allArticles.some(art => !sourcePreferences.isEnabled(art.sourceTitle) &&
                    (selectedLang === 'all' || art.lang === selectedLang) &&
                    (selectedScope === 'all' || art.scope === selectedScope) &&
                    (currentCategory === 'All' || art.sheetCategory === currentCategory));
            if (hiddenBySource) {
                sentinel.textContent = t('msg.no_enabled_source_news');
            } else if (isFiltered) {
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

        if (!statsData) return;

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
            
            const headerTitle = document.createElement('div');
            headerTitle.textContent = getTranslation('cat', catName);
            header.appendChild(headerTitle);
            header.appendChild(createVisibilityToggle(catName, true));

            const submenu = document.createElement('div');
            submenu.className = 'source-submenu';

            header.onclick = (e) => {
                if (e.target.closest('.visibility-toggle')) return;
                const wasOpen = group.classList.contains('open');
                document.querySelectorAll('.category-group').forEach(g => g.classList.remove('open'));
                if (!wasOpen) group.classList.add('open');
                filterByCategory(catName);
            };

            cats[catName].sort((a,b) => a.name.localeCompare(b.name, 'fi')).forEach(src => {
                const item = document.createElement('div');
                item.className = 'source-item';

                const nameDiv = document.createElement('div');
                nameDiv.className = 'source-item-name';
                nameDiv.textContent = src.name;
                item.appendChild(nameDiv);
                
                item.appendChild(createVisibilityToggle(src.name));

                item.onclick = (e) => {
                    if (e.target.closest('.visibility-toggle')) return;
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

        if (!statsData) return;

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

            const nameDiv = document.createElement('div');
            nameDiv.className = 'source-item-name';
            nameDiv.textContent = sourceName;
            item.appendChild(nameDiv);

            item.appendChild(createVisibilityToggle(sourceName));
            item.onclick = (e) => {
                if (e.target.closest('.visibility-toggle')) return;
                changeSource(`sources/${info.file}`, sourceName, item);
            };

            list.appendChild(item);
        });
    }

    function showSidebarView(view) {
        const wasBookmarksView = isBookmarksView;
        isBookmarksView = false;

        const bookmarksBtn = document.getElementById('btn-bookmarks');
        if (bookmarksBtn) bookmarksBtn.classList.remove('active');

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
        syncSourceControls();

        // If we were in bookmarks view, reload articles for the current source
        if (wasBookmarksView) {
            currentSourceFile = 'data.json';
            currentSourceName = null;
            currentCategory = 'All';
            const viewTitle = document.getElementById('current-view-title');
            const viewDesc = document.getElementById('current-view-description');
            const logoCont = document.getElementById('feed-logo-container');
            if (viewTitle) viewTitle.textContent = t('ui.latest_news');
            if (viewDesc) viewDesc.innerText = t('ui.a_collection_of_the_latest_news_from_followed_sources');
            if (logoCont) { logoCont.innerHTML = ''; logoCont.style.display = 'none'; }
            renderSourceHeaderControl();
            loadData('data.json');
            window.scrollTo({ top: 0, behavior: 'smooth' });
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
            currentSourceName = isMainFeed ? null : title;
            renderSourceHeaderControl();

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
                        viewDesc.innerText = getSourceDescriptionText(first);
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
        isBookmarksView = false;
        const bookmarksBtn = document.getElementById('btn-bookmarks');
        if (bookmarksBtn) bookmarksBtn.classList.remove('active');

        currentCategory = catName;
        currentSourceFile = 'data.json';
        currentSourceName = null;
        renderSourceHeaderControl();
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
        isBookmarksView = false;
        const bookmarksBtn = document.getElementById('btn-bookmarks');
        if (bookmarksBtn) bookmarksBtn.classList.remove('active');
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

    // --- BOOKMARKS VIEW ---

    function showBookmarksView() {
        isBookmarksView = true;
        renderSourceHeaderControl();

        const btn = document.getElementById('btn-bookmarks');
        const btnCategories = document.getElementById('btn-categories');
        const btnAz = document.getElementById('btn-az');
        btnCategories.classList.remove('active');
        btnAz.classList.remove('active');
        btn.classList.add('active');

        // Update view header
        const viewTitle = document.getElementById('current-view-title');
        const viewDesc = document.getElementById('current-view-description');
        const logoCont = document.getElementById('feed-logo-container');
        if (viewTitle) {
            viewTitle.textContent = t('ui.bookmarks') || 'Bookmarks';

            const csvA = document.createElement('a');
            csvA.href = '#';
            csvA.className = 'rss-link';
            csvA.title = 'Export bookmarks as CSV';
            csvA.setAttribute('aria-label', 'Export bookmarks as CSV');
            csvA.onclick = function() { window.BookmarkManager.exportCsv(); return false; };

            const csvSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            csvSvg.setAttribute('viewBox', '0 0 24 24');
            csvSvg.setAttribute('fill', 'currentColor');
            const csvPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            csvPath.setAttribute('d', 'M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z');
            csvSvg.appendChild(csvPath);
            csvA.appendChild(csvSvg);
            viewTitle.appendChild(csvA);
        }
        if (viewDesc) viewDesc.textContent = '';
        if (logoCont) { logoCont.innerHTML = ''; logoCont.style.display = 'none'; }

        const bookmarks = window.BookmarkManager ? window.BookmarkManager.getAll() : [];
        const container = document.querySelector('#magazine-grid');
        const sentinel = document.querySelector('#scroll-sentinel');

        clearGrid();
        container.classList.remove('loaded');
        if (sentinel) sentinel.textContent = '';

        if (bookmarks.length === 0) {
            if (sentinel) sentinel.textContent = t('msg.no_bookmarks') || 'No bookmarks yet. Click \u2606 on articles to bookmark them.';
            const list = document.getElementById('source-list');
            if (list) list.innerHTML = '';
            container.classList.add('loaded');
            return;
        }

        const newElements = [];
        bookmarks.forEach(bm => {
            const card = createArticleCard(bm);
            container.appendChild(card);
            newElements.push(card);
        });

        imagesLoaded(container, () => {
            if (masonry) {
                masonry.appended(newElements);
                masonry.layout();
            }
            container.classList.add('loaded');
        });

        buildBookmarksSidebar(bookmarks);
    }

    function buildBookmarksSidebar(bookmarks) {
        const list = document.getElementById('source-list');
        list.innerHTML = '';

        // "All items" top-level link
        const allItem = document.createElement('div');
        allItem.className = 'source-item active';
        allItem.id = 'bookmark-all-item';
        allItem.textContent = t('ui.all_items') || 'All items';
        allItem.onclick = () => {
            showBookmarksView();
        };
        list.appendChild(allItem);

        // Group bookmarks by category
        const byCategory = {};
        bookmarks.forEach(bm => {
            const cat = bm.sheetCategory || 'Uncategorized';
            if (!byCategory[cat]) byCategory[cat] = [];
            byCategory[cat].push(bm);
        });

        Object.keys(byCategory).sort().forEach(category => {
            const group = document.createElement('div');
            group.className = 'category-group';

            const header = document.createElement('div');
            header.className = 'category-header';
            header.textContent = getTranslation('cat', category);
            header.onclick = () => {
                group.classList.toggle('open');
                filterBookmarksByCategory(category);
                // Update active state
                const allItemEl = document.getElementById('bookmark-all-item');
                if (allItemEl) allItemEl.classList.remove('active');
                list.querySelectorAll('.category-header').forEach(h => h.classList.remove('active'));
                header.classList.add('active');
            };
            group.appendChild(header);

            const submenu = document.createElement('div');
            submenu.className = 'source-submenu';

            const sources = new Set();
            byCategory[category].forEach(bm => sources.add(bm.sourceTitle || 'Unknown'));

            Array.from(sources).sort().forEach(source => {
                const count = byCategory[category].filter(b => b.sourceTitle === source).length;
                const item = document.createElement('div');
                item.className = 'source-item';
                item.textContent = source;
                const countSpan = document.createElement('span');
                countSpan.textContent = count;
                item.appendChild(countSpan);
                item.onclick = (e) => { e.stopPropagation(); filterBookmarksBySource(source, category); };
                submenu.appendChild(item);
            });

            group.appendChild(submenu);
            group.classList.add('open');
            list.appendChild(group);
        });
    }

    function filterBookmarksBySource(source, category) {
        const bookmarks = window.BookmarkManager ? window.BookmarkManager.getAll() : [];
        const filtered = bookmarks.filter(b =>
            b.sourceTitle === source && b.sheetCategory === category
        );

        const container = document.querySelector('#magazine-grid');
        clearGrid();
        container.classList.remove('loaded');

        const newElements = [];
        filtered.forEach(bm => {
            const card = createArticleCard(bm);
            container.appendChild(card);
            newElements.push(card);
        });

        imagesLoaded(container, () => {
            if (masonry) {
                masonry.appended(newElements);
                masonry.layout();
            }
            container.classList.add('loaded');
        });
    }

    function filterBookmarksByCategory(category) {
        const bookmarks = window.BookmarkManager ? window.BookmarkManager.getAll() : [];
        const filtered = category === 'All'
            ? bookmarks
            : bookmarks.filter(b => (b.sheetCategory || 'Uncategorized') === category);

        const container = document.querySelector('#magazine-grid');
        clearGrid();
        container.classList.remove('loaded');

        const newElements = [];
        filtered.forEach(bm => {
            const card = createArticleCard(bm);
            container.appendChild(card);
            newElements.push(card);
        });

        imagesLoaded(container, () => {
            if (masonry) {
                masonry.appended(newElements);
                masonry.layout();
            }
            container.classList.add('loaded');
        });
    }
    // Expose functions needed from HTML attributes
    window.toggleSidebar = toggleSidebar;
    window.showSidebarView = showSidebarView;
    window.showBookmarksView = showBookmarksView;
    window.resetFilters = resetFilters;
    window.toggleSettingsPanel = toggleSettingsPanel;
    window.closeSettingsPanel = closeSettingsPanel;
    window.applySettingsPanel = applySettingsPanel;
    window.resetFiltersFromPanel = resetFiltersFromPanel;

    init();
})();
