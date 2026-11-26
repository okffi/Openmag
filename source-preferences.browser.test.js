const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { createServer } = require('node:http');
const { mkdtemp, readFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { rm } = require('node:fs/promises');

const chromeCommands = ['google-chrome', 'chromium', 'chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
const chrome = chromeCommands
    .find(command => {
        const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
        return result.status === 0;
    });

test('source switches filter feeds, synchronize views, and survive reload', {
    skip: !chrome && 'Chrome or Chromium is required',
    timeout: 60000
}, async () => {
    const articles = Array.from({ length: 60 }, (_, i) => ({
        title: `Article ${i}`, link: `https://example.test/${i}`, sourceTitle: i % 2 ? 'Beta' : 'Alpha',
        sheetCategory: 'Topic', lang: 'en', scope: 'Europe', pubDate: new Date(2026, 0, 60 - i).toISOString(),
        snippet: i === 0 ? 'A longer news preview' : i === 1 ? 'A short preview.' : i === 2 ? 'x'.repeat(1000) : '',
        content: i === 0 ? `<p>A longer news preview ${'with meaningful words '.repeat(40)}ending.</p>` : ''
    }));
    articles.push({
        title: 'Finnish article', link: 'https://example.test/finland', sourceTitle: 'Gamma',
        sheetCategory: 'Topic', lang: 'fi', scope: 'Finland', pubDate: '2020-01-01T00:00:00.000Z'
    });
    const stats = {
        Alpha: { file: 'alpha.json', count: 30, category: 'Topic', lang: 'en', scope: 'Europe' },
        Beta: { file: 'beta.json', count: 30, category: 'Topic', lang: 'en', scope: 'Europe' },
        Gamma: { file: 'gamma.json', count: 1, category: 'Topic', lang: 'fi', scope: 'Finland' }
    };
    const originalHtml = await readFile(join(__dirname, 'index.html'), 'utf8');
    const html = originalHtml
        .replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]+>\s*/g, '')
        .replace(/<script src="https:\/\/unpkg\.com\/[^"]+"><\/script>/g, '')
        .replace('</head>', `<script>
            window.Masonry = class { reloadItems() {} layout() {} appended() {} };
            window.imagesLoaded = (_, callback) => callback();
        </script></head>`);
    const server = createServer(async (req, res) => {
        const path = new URL(req.url, 'http://localhost').pathname;
        if (path === '/') {
            res.setHeader('content-type', 'text/html');
            res.end(html);
        } else if (path === '/data.json' || path === '/stats.json' || path.startsWith('/sources/')) {
            res.setHeader('content-type', 'application/json');
            const source = path.split('/').pop().replace('.json', '');
            res.end(JSON.stringify(path === '/stats.json' ? stats :
                path === '/data.json' ? articles : articles.filter(article => article.sourceTitle.toLowerCase() === source)));
        } else if (['/app.js', '/bookmarks.js', '/source-preferences.js', '/translations.json', '/location-hierarchy.json', '/style.css'].includes(path)) {
            res.setHeader('content-type', path.endsWith('.js') ? 'text/javascript' :
                path.endsWith('.json') ? 'application/json' : 'text/css');
            res.end(await readFile(join(__dirname, path.slice(1))));
        } else {
            res.writeHead(404).end();
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const profile = await mkdtemp(join(tmpdir(), 'openmag-browser-test-'));
    const browser = spawn(chrome, [
        '--headless', '--disable-gpu', '--disable-background-networking',
        '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'
    ], { stdio: 'ignore' });
    let socket;
    let browserExited = false;
    let serverClosed = false;
    browser.once('exit', () => { browserExited = true; });
    try {
        const waitFor = async (fn, message) => {
            for (let i = 0; i < 200; i++) {
                const value = await fn();
                if (value) return value;
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            throw new Error(message);
        };
        const portFile = await waitFor(async () => {
            try { return await readFile(join(profile, 'DevToolsActivePort'), 'utf8'); }
            catch (error) { if (error.code === 'ENOENT') return null; throw error; }
        }, 'Browser did not start');
        const debugPort = portFile.split('\n')[0];
        const target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json();
        socket = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
            socket.addEventListener('open', resolve, { once: true });
            socket.addEventListener('error', reject, { once: true });
        });
        let nextId = 0;
        const pending = new Map();
        socket.addEventListener('message', event => {
            const message = JSON.parse(event.data);
            if (!message.id || !pending.has(message.id)) return;
            const { resolve, reject } = pending.get(message.id);
            pending.delete(message.id);
            if (message.error) reject(new Error(message.error.message));
            else resolve(message.result);
        });
        function send(method, params = {}) {
            const id = ++nextId;
            return new Promise((resolve, reject) => {
                pending.set(id, { resolve, reject });
                socket.send(JSON.stringify({ id, method, params }));
            });
        }
        async function evaluate(expression) {
            const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
            if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
            return result.result.value;
        }
        await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
        await waitFor(() => evaluate("document.querySelectorAll('#source-list [data-preference-source]').length === 3"), 'Application did not load');
        assert.equal(await evaluate("document.querySelectorAll('.grid-item').length"), 50);

        await evaluate("document.querySelector('#settings-btn').click()");
        for (const viewportWidth of [1200, 800, 500]) {
            await send('Emulation.setDeviceMetricsOverride', { width: viewportWidth, height: 800, deviceScaleFactor: 1, mobile: false });
            const layout = await evaluate(`(() => {
                const ui = document.querySelector('#settings-ui-lang-select').getBoundingClientRect();
                const content = document.querySelector('#settings-content-lang-select').getBoundingClientRect();
                return { uiLeft: ui.left, uiBottom: ui.bottom, contentLeft: content.left, contentTop: content.top };
            })()`);
            assert.equal(layout.uiLeft, layout.contentLeft);
            assert.ok(layout.uiBottom < layout.contentTop);
        }
        await evaluate("document.querySelector('#settings-close-btn').click()");
        await send('Emulation.clearDeviceMetricsOverride');

        const previewLengths = [];
        for (const viewportWidth of [1600, 500, 1600]) {
            await send('Emulation.setDeviceMetricsOverride', { width: viewportWidth, height: 800, deviceScaleFactor: 1, mobile: false });
            await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
            const previews = await evaluate(`(() => Array.from(document.querySelectorAll('.grid-item')).slice(0, 3).map(card => {
                const preview = card.querySelector('.article-preview');
                return {
                    text: preview.textContent,
                    original: preview.dataset.previewText,
                    height: preview.getBoundingClientRect().height,
                    lineHeight: parseFloat(getComputedStyle(preview).lineHeight)
                };
            }))()`);
            assert.ok(previews[0].text.endsWith('…'));
            const prefix = previews[0].text.slice(0, -1);
            assert.ok(previews[0].original.startsWith(prefix));
            assert.match(previews[0].original.slice(prefix.length), /^\s/);
            assert.ok(previews[0].height <= previews[0].lineHeight * 5 + 0.5);
            assert.equal(Math.round(previews[0].height / previews[0].lineHeight), 5);
            assert.equal(previews[1].text, 'A short preview.');
            assert.equal(previews[2].text, '…');
            previewLengths.push(previews[0].text.length);
        }
        assert.ok(previewLengths[0] > previewLengths[1]);
        assert.equal(previewLengths[2], previewLengths[0]);

        for (const viewportWidth of [500, 1000]) {
            await send('Emulation.setDeviceMetricsOverride', { width: viewportWidth, height: 800, deviceScaleFactor: 1, mobile: false });
            for (const [cardWidth, direction] of [[299, 'column'], [300, 'row'], [301, 'row']]) {
                const layout = await evaluate(`(() => {
                    const card = document.querySelector('.grid-item');
                    card.style.width = '${cardWidth}px';
                    const meta = card.querySelector('.meta-info');
                    return {
                        width: card.getBoundingClientRect().width,
                        direction: getComputedStyle(meta).flexDirection,
                        sourceOrder: getComputedStyle(meta.querySelector('.source-trigger')).order,
                        detailsOrder: getComputedStyle(meta.querySelector('.meta-info-right-block')).order
                    };
                })()`);
                assert.equal(layout.width, cardWidth);
                assert.equal(layout.direction, direction);
                assert.equal(layout.sourceOrder, direction === 'column' ? '2' : '0');
                assert.equal(layout.detailsOrder, direction === 'column' ? '1' : '0');
            }
        }
        await evaluate("document.querySelector('.grid-item').style.width = ''");
        await send('Emulation.clearDeviceMetricsOverride');

        await evaluate("document.querySelector('.grid-item [data-preference-source=\"Alpha\"]').click()");
        assert.deepEqual(await evaluate("JSON.parse(localStorage.getItem('openmag_disabled_sources'))"), ['Alpha']);
        assert.equal(await evaluate("document.querySelectorAll('.grid-item [data-preference-source=\"Alpha\"]').length"), 0);
        assert.equal(await evaluate("document.querySelector('#source-list [data-preference-source=\"Alpha\"]').getAttribute('data-visible')"), 'false');
        assert.equal(await evaluate("document.querySelector('[data-preference-topic=\"Topic\"]').getAttribute('data-visible')"), 'mixed');

        await evaluate("document.querySelector('#source-list [data-preference-source=\"Alpha\"]').closest('.source-item').click()");
        await waitFor(() => evaluate("document.querySelectorAll('.grid-item [data-preference-source=\"Alpha\"]').length === 30"), 'Source preview did not load Alpha cards');
        assert.equal(await evaluate("document.querySelector('#current-view-title .source-page-visibility-toggle').getAttribute('data-visible')"), 'false');
        await evaluate("document.querySelector('#current-view-title .source-page-visibility-toggle').click()");
        assert.equal(await evaluate("document.querySelector('#current-view-title .source-page-visibility-toggle').getAttribute('data-visible')"), 'true');
        assert.equal(await evaluate("document.querySelector('.grid-item [data-preference-source]').getAttribute('data-visible')"), 'true');
        await evaluate("document.querySelector('.bookmark-btn').click(); document.querySelector('#current-view-title .source-page-visibility-toggle').click()");
        assert.equal(await evaluate("document.querySelector('#current-view-title .source-page-visibility-toggle').getAttribute('data-visible')"), 'false');
        await evaluate("showBookmarksView()");
        assert.equal(await evaluate("document.querySelectorAll('.grid-item [data-preference-source=\"Alpha\"]').length"), 1);
        assert.equal(await evaluate("document.querySelector('.grid-item [data-preference-source]').getAttribute('data-visible')"), 'false');

        await evaluate("window.__testMarker = Math.random()");
        await send('Page.reload');
        await waitFor(() => evaluate("typeof window.__testMarker === 'undefined' && document.readyState === 'complete' && document.querySelectorAll('#source-list [data-preference-source]').length === 3"), 'Reload did not finish');
        assert.equal(await evaluate("document.querySelector('#source-list [data-preference-source=\"Alpha\"]').getAttribute('data-visible')"), 'false');
        assert.equal(await evaluate("document.querySelectorAll('.grid-item [data-preference-source=\"Alpha\"]').length"), 0);
        await evaluate("document.querySelector('#langFilter').value = 'en'; document.querySelector('#langFilter').dispatchEvent(new Event('change'))");
        await evaluate("document.querySelector('[data-preference-topic=\"Topic\"]').click()");
        assert.deepEqual(await evaluate("JSON.parse(localStorage.getItem('openmag_disabled_sources'))"), []);
        await evaluate("document.querySelector('[data-preference-topic=\"Topic\"]').click()");
        assert.deepEqual((await evaluate("JSON.parse(localStorage.getItem('openmag_disabled_sources'))")).sort(), ['Alpha', 'Beta', 'Gamma']);
        assert.equal(await evaluate("document.querySelectorAll('.grid-item').length"), 0);
        await evaluate("document.querySelector('#uiLangFilter').value = 'en'; document.querySelector('#uiLangFilter').dispatchEvent(new Event('change'))");
        await waitFor(() => evaluate("document.querySelector('#scroll-sentinel').textContent === 'No articles from enabled sources. Enable sources in the sidebar to see their articles.'"), 'Translation did not load');
        assert.equal(await evaluate("document.querySelector('#scroll-sentinel').textContent"), 'No articles from enabled sources. Enable sources in the sidebar to see their articles.');
        await evaluate("document.querySelector('#source-list [data-preference-source=\"Alpha\"]').click()");
        assert.equal(await evaluate("document.querySelector('[data-preference-topic=\"Topic\"]').getAttribute('data-visible')"), 'mixed');
        await evaluate("document.querySelector('[data-preference-topic=\"Topic\"]').click()");
        assert.deepEqual(await evaluate("JSON.parse(localStorage.getItem('openmag_disabled_sources'))"), []);
        assert.equal(await evaluate("document.querySelectorAll('.grid-item').length"), 50);

        await evaluate("document.querySelector('#langFilter').value = 'all'; document.querySelector('#langFilter').dispatchEvent(new Event('change'))");
        await evaluate("document.querySelector('#settings-btn').click(); document.querySelector('.location-checkbox[value=\"Finland\"]').click()");
        assert.equal(await evaluate("document.querySelectorAll('.location-checkbox[value=\"Poland\"]').length"), 1);
        await evaluate("document.querySelector('.location-expand[data-parent=\"loc-europe\"]').click()");
        assert.equal(await evaluate("document.querySelector('.location-expand[data-parent=\"loc-europe\"]').getAttribute('aria-expanded')"), 'false');
        assert.equal(await evaluate("document.querySelectorAll('.grid-item').length"), 50);
        await evaluate("document.querySelector('#settings-ui-lang-select').value = 'fi'; document.querySelector('#settings-ui-lang-select').dispatchEvent(new Event('change'))");
        assert.equal(await evaluate("document.querySelector('.location-checkbox[value=\"Finland\"]').checked"), true);
        assert.equal(await evaluate("document.querySelector('.location-expand[data-parent=\"loc-europe\"]').getAttribute('aria-expanded')"), 'false');
        await evaluate("document.querySelector('#settings-apply-btn').click()");
        assert.deepEqual(await evaluate("JSON.parse(localStorage.getItem('selectedLocations'))"), ['Finland']);
        assert.equal(await evaluate("document.querySelectorAll('.grid-item').length"), 1);
        assert.equal(await evaluate("document.querySelector('.grid-item [data-preference-source]').dataset.preferenceSource"), 'Gamma');
        assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('#source-list [data-preference-source]'), e => e.dataset.preferenceSource)"), ['Gamma']);
        await evaluate("document.querySelector('#btn-az').click()");
        assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('#source-list [data-preference-source]'), e => e.dataset.preferenceSource)"), ['Gamma']);

        await evaluate("window.__locationReload = true");
        await send('Page.reload');
        await waitFor(() => evaluate("!window.__locationReload && document.querySelectorAll('#source-list [data-preference-source]').length === 1"), 'Location selection did not restore');
        assert.equal(await evaluate("document.querySelector('.grid-item [data-preference-source]').dataset.preferenceSource"), 'Gamma');
        await evaluate("document.querySelector('#settings-btn').click()");
        assert.equal(await evaluate("document.querySelector('.location-checkbox[value=\"Finland\"]').checked"), true);
        await evaluate("document.querySelector('.location-checkbox[value=\"Europe\"]').click(); document.querySelector('.location-checkbox[value=\"Finland\"]').click()");
        assert.equal(await evaluate("document.querySelector('.location-checkbox[value=\"Europe\"]').checked"), true);
        await evaluate("document.querySelector('#settings-apply-btn').click()");
        assert.equal(await evaluate("document.querySelectorAll('.grid-item').length"), 50);
        assert.equal(await evaluate("JSON.parse(localStorage.getItem('selectedLocations')).includes('Europe')"), true);
        assert.equal(await evaluate("JSON.parse(localStorage.getItem('selectedLocations')).includes('Finland')"), false);
        assert.deepEqual((await evaluate("Array.from(document.querySelectorAll('#source-list [data-preference-source]'), e => e.dataset.preferenceSource)")).sort(), ['Alpha', 'Beta']);

        await evaluate("document.querySelector('#settings-btn').click(); document.querySelector('.location-checkbox[value=\"Europe\"]').click(); document.querySelector('#settings-close-btn').click()");
        await evaluate("document.querySelector('#settings-btn').click()");
        assert.equal(await evaluate("document.querySelector('.location-checkbox[value=\"Europe\"]').checked"), true);
        await evaluate("document.querySelector('#settings-reset-btn').click()");
        assert.equal(await evaluate("localStorage.getItem('selectedLocations')"), null);
        assert.equal(await evaluate("document.querySelectorAll('#source-list [data-preference-source]').length"), 3);
        assert.equal(await evaluate("document.querySelectorAll('.grid-item').length"), 50);
    } finally {
        if (socket) {
            try { socket.close(); } catch (e) { }
        }
        if (!browserExited) {
            browser.kill('SIGTERM');
            try {
                await Promise.race([
                    new Promise(resolve => browser.once('exit', resolve)),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Browser kill timeout')), 5000))
                ]);
            } catch (e) {
                console.error('Browser did not exit after SIGTERM');
            }
        }
        try { await rm(profile, { recursive: true, force: true }); } catch (e) { }
        if (!serverClosed) {
            await new Promise(resolve => server.close(() => { serverClosed = true; resolve(); }));
        }
    }
});
