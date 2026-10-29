// Isolated browser proof using the actual Game rendering and handlers; room transport is stubbed.
// Usage: node autotests/ui-flea-market.cjs <Playwright node_modules> <React/Babel node_modules>
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const [browserModules, frontendModules] = process.argv.slice(2);
if (!browserModules || !frontendModules) throw new Error('Укажите каталоги node_modules Playwright и React/Babel.');
const frontend = createRequire(path.resolve(frontendModules, '__flea_market_check.cjs'));
const {chromium} = createRequire(path.resolve(browserModules, '__flea_market_check.cjs'))('playwright');
const publicDir = path.resolve(__dirname, '../public');
const output = path.resolve(__dirname, '../output/playwright');
fs.mkdirSync(output, {recursive: true});
const source = fs.readFileSync(path.join(publicDir, 'app.jsx'), 'utf8')
    .replace("ReactDOM.render(<Game/>, document.getElementById('root'));", 'window.FleaGame = Game; window.FleaCard = Card;');
const compiled = frontend('@babel/core').transformSync(source, {
    presets: [frontend.resolve('@babel/preset-react')], configFile: false, babelrc: false
}).code;
const bootstrap = `
window.cs = (...values) => values.flatMap(value => typeof value === 'string' ? [value] : Object.keys(value || {}).filter(key => value[key])).join(' ');
window.PlayerName = ({id}) => React.createElement('span', null, id);
window.handlers = {}; window.emitted = [];
window.socket = {on(event, callback) {handlers[event] = callback;}, emit(...args) {emitted.push(args);}};
window.CommonRoom = function () {return null;};
CommonRoom.roomInit = game => {game.socket = socket; game.userId = 'host'; return {roomId: 'flea-market-proof'};};
CommonRoom.processCommonRoom = () => {};
window.commonRoom = {getPlayerName: id => id};
window.ReactInlineSVG = {default: () => null};
ReactDOM.render(React.createElement(FleaGame, {ref: value => window.game = value}), document.getElementById('root'));
const card = type => ({type, cost: CitadelsSetup.districts[type].cost, kind: CitadelsSetup.districts[type].type});
window.restart = (hand = ['secret_vault', 'manor']) => {
 if (game.zoomed) game.zoomCard();
 game.handleStopUserAction();
 const state = {inited: true, phase: 2, currentPlayer: 0, turnId: 11, playerSlots: ['host', 'player'], hostId: 'host', onlinePlayers: ['host', 'player'], playerNames: {}, playerCharacter: {0: [], 1: []}, playerGold: {0: 0, 1: 0}, playerHand: {0: hand.length, 1: 0}, playerScore: {}, player: {hand: hand.map(card), action: null, character: []}, playerDistricts: {0: [{...card('flea_market'), instanceId: 'flea-a'}, {...card('flea_market'), instanceId: 'flea-b'}], 1: []}, tookResource: false, buildDistricts: 0, buildingBan: true, currentCharacter: '8_1', magistrated: [], blackmailed: [], characterInGame: [], characterFace: [], spectators: [], teamsLocked: true, districtDeckCount: 0, districtDiscardCount: 0};
 handlers.state(state); emitted.length = 0;
};
restart();
`;
// The engine normally supplies Material Icons. Only its zoom glyph is substituted here.
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/citadels/style.css"><style>.card-zoom-button {font-size: 0;} .card-zoom-button::after {content: '⌕'; font: 28px Arial;}</style></head><body><div id="root"></div><script src="/react.js"></script><script src="/react-dom.js"></script><script src="/citadels/setup.js"></script><script src="/app.js"></script><script src="/bootstrap.js"></script></body></html>`;
const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost').pathname;
    let body, type = 'application/javascript';
    if (url === '/') {body = html; type = 'text/html';}
    else if (url === '/app.js') body = compiled;
    else if (url === '/bootstrap.js') body = bootstrap;
    else {
        const file = url === '/react.js' ? path.join(path.dirname(frontend.resolve('react/package.json')), 'umd/react.development.js')
            : url === '/react-dom.js' ? path.join(path.dirname(frontend.resolve('react-dom/package.json')), 'umd/react-dom.development.js')
            : url.startsWith('/citadels/') ? path.resolve(publicDir, '.' + url.slice('/citadels'.length)) : null;
        if (!file || (!file.startsWith(publicDir + path.sep) && !url.startsWith('/react')) || !fs.existsSync(file)) {response.writeHead(404); response.end(); return;}
        body = fs.readFileSync(file);
        type = ({'.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp'})[path.extname(file)] || type;
    }
    response.writeHead(200, {'Content-Type': type}); response.end(body);
});
(async () => {
    let browser;
    try {
        await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
        browser = await chromium.launch({channel: 'chrome', headless: true});
        const page = await browser.newPage({viewport: {width: 1280, height: 900}});
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.waitForFunction(() => window.game && game.state.inited);
        const sourceButton = () => page.getByRole('button', {name: /^Барахолка \(1\)/});
        const confirm = () => page.getByRole('button', {name: 'Сбросить и взять карту', exact: true});
        const handCard = index => page.locator('.hand-section .cards-list > .hand-card').nth(index);
        await sourceButton().click();
        assert.equal(await confirm().isDisabled(), true);
        await handCard(0).click();
        assert.equal(await confirm().isEnabled(), true);
        assert.deepEqual(await page.evaluate(() => emitted), []);
        assert.deepEqual(await page.evaluate(() => game.state.cardChosen), [0]);
        await handCard(1).click();
        assert.deepEqual(await page.evaluate(() => game.state.cardChosen), [1]);
        await handCard(1).click();
        assert.equal(await confirm().isDisabled(), true);
        await handCard(0).click();
        await page.locator('.control-section').screenshot({path: path.join(output, 'flea-market-selection-desktop.png')});
        await page.getByRole('button', {name: 'Отмена действия', exact: true}).click();
        assert.deepEqual(await page.evaluate(() => emitted), []);
        await sourceButton().click(); await handCard(0).click(); await confirm().click();
        assert.deepEqual(await page.evaluate(() => emitted), [['flea-market-action', 0, 0]]);
        assert.equal(await confirm().count(), 0);
        await page.evaluate(() => restart([]));
        assert.equal(await sourceButton().isDisabled(), true);
        assert.match(await sourceButton().getAttribute('title'), /хотя бы одна карта/);
        // Public and private event updates use the same real stale-selection boundary.
        await page.evaluate(() => restart());
        await sourceButton().click(); await handCard(0).click();
        await page.evaluate(() => handlers['player-state']({...game.state.player, hand: [game.state.player.hand[1]]}));
        assert.equal(await confirm().count(), 0);
        assert.deepEqual(await page.evaluate(() => emitted), []);
        await page.evaluate(() => restart());
        await sourceButton().click(); await handCard(0).click();
        await page.evaluate(() => handlers.state({...game.state, turnId: 12}));
        assert.equal(await confirm().count(), 0);
        await page.evaluate(() => restart());
        await sourceButton().click();
        await page.evaluate(() => handlers['player-state']({...game.state.player, action: 'blackmailed-response'}));
        assert.equal(await confirm().count(), 0);
        assert.equal(await sourceButton().count(), 0);
        for (const width of [390, 320]) {
            await page.setViewportSize({width, height: 844});
            await page.evaluate(() => restart());
            await sourceButton().click(); await handCard(0).click();
            await confirm().scrollIntoViewIfNeeded();
            const bounds = await confirm().boundingBox();
            assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
            await page.screenshot({path: path.join(output, `flea-market-selection-mobile-${width}.png`), fullPage: true});
            await confirm().click();
            assert.deepEqual(await page.evaluate(() => emitted), [['flea-market-action', 0, 0]]);
        }
        // Approved full-card assets use a direct image on the card, zoom and gallery.
        assert.ok(fs.existsSync(path.join(publicDir, 'cards/flea_market-compressed.jpg')));
        {
            const metadata = await page.evaluate(() => ({image: CitadelsSetup.districts.flea_market.image, fullCardImage: CitadelsSetup.districts.flea_market.fullCardImage}));
            assert.deepEqual(metadata, {image: '/citadels/cards/flea_market-compressed.jpg', fullCardImage: true});
            await page.evaluate(() => {
                restart(['flea_market']);
            });
            await page.waitForFunction(() => Array.from(document.querySelectorAll('.district-face-full-card')).every(img => img.complete && img.naturalWidth === 707));
            assert.equal(await handCard(0).locator('.district-face-heading').count(), 0);
            await handCard(0).locator(':scope > .card-zoom-button').dispatchEvent('mousedown');
            assert.equal(await page.locator('.zoomed .district-face-full-card').count(), 2);
            await page.screenshot({path: path.join(output, 'flea-market-zoom-mobile.png')});
            await page.evaluate(() => {
                game.zoomCard();
                const gallery = document.createElement('div'); gallery.id = 'gallery-proof'; document.body.append(gallery);
                ReactDOM.render(React.createElement(FleaCard, {card: {type: 'flea_market', cost: 2, kind: 9}, type: 'card', game, isGallery: true}), gallery);
            });
            assert.equal(await page.locator('#gallery-proof .district-face-full-card').count(), 2);
        }
        assert.deepEqual(errors, []);
        fs.writeFileSync(path.join(output, 'flea-market-ui-proof.json'), JSON.stringify({checks: ['actual Game/hand/button rendering', 'explicit confirmation and cancellation', 'single selection/toggle', 'exchange despite building ban/no gold/no builds/empty piles', 'Secret Vault selection', 'empty-hand disabled reason', 'private hand/public turn/mandatory response staleness', '390/320 mobile', 'approved full-card image from actual catalog in normal/zoom/gallery'], errors}, null, 2));
        console.log('FLEA MARKET UI PASS; screenshots and proof in ' + output);
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => {console.error(error); process.exitCode = 1;});
