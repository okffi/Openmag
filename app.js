// app.js - Globaalit muuttujat ja alustus
let allArticles = []; 
let displayedCount = 0;
const PAGE_SIZE = 50;
let msnry;
let isLoading = false;
let currentCategory = 'All';
let statsData = null; 
let mainFeedCache = null;
let translations = {}; 

// --- APUFUNKTIOT ---
function t(key) {
    const lang = document.getElementById('langFilter').value || 'en';
    if (translations[lang] && translations[lang][key]) {
        return translations[lang][key];
    }
    return key.includes('.') ? key.split('.')[1].replace(/_/g, ' ') : key;
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

// --- LOGIIKKA JA RENDERÖINTI ---
// (Liitä tähän loput handleCategoryClick, loadData, createArticleCard jne. funktiot)

// Tunnistetaan kieli ja aloitetaan
async function init() {
    // Asetetaan oletuskieli selaimen mukaan ennen latausta
    const userLang = navigator.language.substring(0, 2);
    const supported = ['fi', 'en', 'sv', 'de', 'fr'];
    if (supported.includes(userLang)) {
        document.getElementById('langFilter').value = userLang;
    }

    // Masonry-alustus
    const container = document.querySelector('#magazine-grid');
    msnry = new Masonry(container, { 
        itemSelector: '.grid-item', 
        columnWidth: '.grid-sizer', 
        percentPosition: true, 
        gutter: 25
    });
    window.msnry = msnry;

    // Lataukset
    try {
        const res = await fetch('translations.json?v=' + Date.now());
        translations = await res.json();
    } catch(e) { console.warn("Käännökset puuttuvat."); }

    await loadData('data.json', true);
    initSidebar(); 
    updateUITranslations();

    // Event listenerit
    document.getElementById('langFilter').addEventListener('change', updateView);
    document.getElementById('scopeFilter').addEventListener('change', updateView);

    // Scroll-tunnistin
    const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && !isLoading) displayArticles();
    }, { rootMargin: '400px' });
    observer.observe(document.querySelector('#scroll-sentinel'));
}

init();
