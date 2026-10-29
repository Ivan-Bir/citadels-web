// Isolated component browser proof, using real Card, PlayerSlot and Game handlers.
// Usage: node autotests/ui-mirror-animation.cjs <Playwright node_modules> <React/Babel node_modules>
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {createRequire} = require('node:module');
const [browserModules, frontendModules] = process.argv.slice(2);
if (!browserModules || !frontendModules) throw new Error('Укажите каталоги node_modules Playwright и React/Babel.');
const frontend = createRequire(path.resolve(frontendModules, '__mirror_check.cjs'));
const {chromium} = createRequire(path.resolve(browserModules, '__mirror_check.cjs'))('playwright');
const publicDir = path.resolve(__dirname, '../public');
const output = path.resolve(__dirname, '../output/playwright');
fs.mkdirSync(output, {recursive: true});
const source = fs.readFileSync(path.join(publicDir, 'app.jsx'), 'utf8')
    .replace("ReactDOM.render(<Game/>, document.getElementById('root'));", 'window.MirrorGame = Game; window.MirrorPlayerSlot = PlayerSlot;');
const compiled = frontend('@babel/core').transformSync(source, {
    presets: [frontend.resolve('@babel/preset-react')], configFile: false, babelrc: false
}).code;
const bootstrap = `
window.cs = (...values) => values.flatMap(value => typeof value === 'string' ? [value] : Object.keys(value || {}).filter(key => value[key])).join(' ');
window.PlayerName = ({id}) => React.createElement('span', null, id);
window.handlers = {};
window.socket = {on(event, callback) {handlers[event] = callback;}, emit() {}};
window.CommonRoom = {roomInit(game) {game.socket = socket; game.userId = 'host'; return {roomId: 'mirror-proof'};}, processCommonRoom() {}};
class Harness extends MirrorGame {
 render() {return this.state.playerSlots ? React.createElement('div', {className: 'game'}, React.createElement('div', {className: 'players-section'}, [0, 1].map(slot => React.createElement(MirrorPlayerSlot, {key: slot, slot, data: this.state, game: this})))) : null;}
}
ReactDOM.render(React.createElement(Harness, {ref: value => window.game = value}), document.getElementById('root'));
const card = type => ({type, cost: CitadelsSetup.districts[type].cost, kind: CitadelsSetup.districts[type].type});
window.base = {phase: 2, currentPlayer: 0, playerSlots: ['host', 'player'], hostId: 'host', onlinePlayers: ['host', 'player'], playerNames: {}, playerCharacter: {0: [], 1: []}, playerGold: {0: 10, 1: 10}, playerHand: {0: 0, 1: 0}, playerScore: {}, player: {hand: [], action: null, character: []}, playerDistricts: {0: [], 1: []}, tookResource: true, buildDistricts: 1, currentCharacter: '8_1', magistrated: [], blackmailed: []};
window.restart = (type = 'museum') => {
 if (game.zoomed) game.zoomCard();
 handlers['game-setup'](null);
 base.playerDistricts = {0: [card('temple'), {...card(type), instanceId: 'district-copy', exposition: type === 'museum' ? [card('manor')] : undefined}], 1: [{...card(type), instanceId: 'district-original'}]};
 handlers.state({...base, mirrorBuild: {slot: 0, instanceId: 'district-copy'}});
};
window.freeze = time => {
 for (const timer of game.mirrorAnimationTimers.values()) clearTimeout(timer);
 game.mirrorAnimationTimers.clear();
 for (const animation of document.getAnimations()) {animation.pause(); animation.currentTime = time;}
};
window.sample = () => {
 const overlay = document.querySelector('.player-slot-0 .card-item:not(.zoomed) > .mirror-transformation') || document.querySelector('.zoomed .card-item-zoomed .mirror-transformation');
 return overlay ? Object.fromEntries(['source', 'dark', 'light'].map(name => [name, Number(getComputedStyle(overlay.querySelector('.mirror-transformation-' + name)).opacity)])) : null;
};
handlers.state(base);
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
        const errors = [], frames = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        await page.waitForFunction(() => window.game && game.state.playerSlots);
        await page.waitForFunction(() => game.mirrorArt.complete && game.mirrorArt.naturalWidth > 0);
        await page.evaluate(() => {restart(); freeze(0);});
        assert.equal(await page.locator('.player-slot-1 .mirror-transformation').count(), 0);
        for (const time of [0, 300, 1250, 1900, 2450]) {
            await page.evaluate(time => freeze(time), time);
            frames.push({time, ...await page.evaluate(() => sample())});
            await page.locator('.player-slot-0').screenshot({path: path.join(output, `mirror-desktop-${time}.png`), animations: 'allow'});
        }
        assert.equal(frames[0].source, 1);
        assert.equal(frames[1].source, 1);
        assert.ok(frames[2].source > 0 && frames[2].source < 1);
        assert.ok(frames[3].source < .06);
        assert.equal(frames[4].source, 0);
        assert.ok(frames[4].light < frames[3].light);
        // Ordinary state updates and index shifts retain the real Card DOM and its timeline.
        const stable = await page.evaluate(() => {
            const node = document.querySelector('[data-mirror-start]');
            const animation = node.querySelector('.mirror-transformation').getAnimations()[0];
            handlers.state({...base});
            base.playerDistricts[0].shift(); handlers.state({...base});
            return node === document.querySelector('[data-mirror-start]') && animation === node.querySelector('.mirror-transformation').getAnimations()[0];
        });
        assert.ok(stable);
        // Zoom starts at elapsed time even though its surface was display:none.
        await page.evaluate(() => {window.thumbnailAnimation = document.querySelector('[data-mirror-start] > .mirror-transformation').getAnimations()[0]; const active = game.state.mirrorAnimations['district-copy']; active.startedAt = Date.now() - 1300; document.querySelector('[data-mirror-start]').dataset.mirrorStart = active.startedAt;});
        await page.locator('[data-mirror-start] > .card-zoom-button').dispatchEvent('mousedown');
        const delay = await page.locator('.zoomed .card-item-zoomed').evaluate(node => parseFloat(node.style.getPropertyValue('--mirror-delay')));
        assert.ok(delay <= -1300 && delay > -1600);
        await page.evaluate(() => {for (const animation of document.querySelector('.zoomed .card-item-zoomed').getAnimations({subtree: true})) {animation.pause(); animation.currentTime = 0;}}); // Negative delay puts zoom at its mid-transformation phase.
        const zoomSample = await page.evaluate(() => sample());
        assert.ok(zoomSample.source > 0 && zoomSample.source < 1);
        await page.locator('.zoomed .card-item-zoomed').screenshot({path: path.join(output, 'mirror-zoom-middle.png'), animations: 'allow'});
        await page.evaluate(() => game.zoomCard());
        assert.ok(await page.evaluate(() => thumbnailAnimation === document.querySelector('[data-mirror-start] > .mirror-transformation').getAnimations()[0] && thumbnailAnimation.currentTime === 2450));
        // A custom DistrictFace target uses the same reveal and finishes with its markers intact.
        await page.evaluate(() => {restart('wine_cellar'); freeze(1500);});
        assert.equal(await page.locator('.player-slot-0 .custom-district > .district-face').count(), 1);
        for (const width of [390, 320]) {
            await page.setViewportSize({width, height: 844});
            await page.evaluate(() => freeze(1500));
            await page.locator('.player-slot-0').screenshot({path: path.join(output, `mirror-mobile-${width}.png`), animations: 'allow'});
            const pointerEvents = await page.locator('.player-slot-0 > .districts .mirror-transformation').first().evaluate(node => getComputedStyle(node).pointerEvents);
            assert.equal(pointerEvents, 'none');
        }
        await page.evaluate(() => {for (const animation of document.getAnimations()) {animation.currentTime = 2590; animation.play();}});
        await page.waitForFunction(() => !document.querySelector('[data-mirror-start]'));
        assert.equal(await page.locator('.mirror-transformation').count(), 0);
        await page.locator('.player-slot-0').screenshot({path: path.join(output, 'mirror-target-final.png')});
        await page.emulateMedia({reducedMotion: 'reduce'});
        await page.evaluate(() => restart());
        assert.equal(await page.locator('.mirror-transformation').count(), 0);
        assert.equal(await page.locator('.player-slot-0 [aria-label="Музей"]').count(), 1);
        await page.reload();
        assert.equal(await page.locator('.mirror-transformation').count(), 0);
        const observer = await browser.newPage({viewport: {width: 1280, height: 900}});
        observer.on('pageerror', error => errors.push(error.message));
        await observer.goto(`http://127.0.0.1:${server.address().port}/`);
        await observer.evaluate(() => {game.userId = 'spectator'; restart(); freeze(0);});
        assert.equal(await observer.evaluate(() => game.state.userSlot), -1);
        assert.equal(await observer.locator('.player-slot-0 .mirror-transformation').count(), 2);
        assert.equal(await observer.locator('.player-slot-1 .mirror-transformation').count(), 0);
        await observer.close();
        assert.deepEqual(errors, []);
        fs.writeFileSync(path.join(output, 'mirror-animation-proof.json'), JSON.stringify({frames, zoomSample, checks: ['actual Card and PlayerSlot rendering', 'source hold and reveal', 'public target untouched', 'stable index shifts/state updates', 'elapsed zoom and no restart on close', 'custom DistrictFace', '390/320 mobile', 'animationend cleanup', 'reduced motion', 'reload', 'spectator']}, null, 2));
        console.log('Mirror animation browser proof passed; screenshots and samples in ' + output);
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => {console.error(error); process.exitCode = 1;});
