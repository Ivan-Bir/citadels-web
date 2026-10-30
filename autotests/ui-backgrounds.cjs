// Component browser check without ws-server-engine.
// Usage: node autotests/ui-backgrounds.cjs <playwright node_modules> <React/Babel node_modules>
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const assert = require("node:assert/strict");
const {createRequire} = require("node:module");
const [browserModules, frontendModules] = process.argv.slice(2);
if (!browserModules || !frontendModules) throw new Error("Укажите каталоги node_modules для Playwright и React/Babel.");
const frontend = createRequire(path.resolve(frontendModules, "__background_check.cjs"));
const browserDeps = createRequire(path.resolve(browserModules, "__background_check.cjs"));
const {chromium} = browserDeps("playwright");
const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
const output = process.env.CITADELS_TEST_OUTPUT
    ? path.resolve(process.env.CITADELS_TEST_OUTPUT)
    : fs.mkdtempSync(path.join(os.tmpdir(), "citadels-ui-backgrounds-"));
fs.mkdirSync(output, {recursive: true});
console.log("Test artifacts: " + output);
const source = fs.readFileSync(path.join(publicDir, "app.jsx"), "utf8")
    .replace("ReactDOM.render(<Game/>, document.getElementById('root'));", "window.BackgroundPanel = CreateGamePanel; window.BackgroundGame = Game;");
const compiled = frontend("@babel/core").transformSync(source, {
    presets: [frontend.resolve("@babel/preset-react")], configFile: false, babelrc: false
}).code;
const bootstrap = `
window.cs = (...values) => values.flatMap(value => typeof value === 'string' ? [value] : Object.keys(value || {}).filter(key => value[key])).join(' ');
window.handlers = {};
window.frames = [];
window.socket = {on(event, callback) {handlers[event] = callback;}, emit(...args) {frames.push(args);}};
window.CommonRoom = {roomInit(game) {game.socket = socket; game.userId = 'host'; game.roomId = 'background-test'; return {roomId: game.roomId};}, processCommonRoom() {}};
window.game = new BackgroundGame();
game.setState = change => Object.assign(game.state, change);
game.componentDidMount();
window.data = {phase: 0, userId: 'host', hostId: 'host', playerSlots: ['host', 'player']};
game.state = {...game.state, ...data, userSlot: 0, currentPlayer: 0};
game.handleClickCreateGame = (...args) => {window.started = args;};
window.mountEditor = () => ReactDOM.render(React.createElement(BackgroundPanel, {data, game, ref: value => window.panel = value}), document.getElementById('root'));
mountEditor();
`;
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/citadels/style.css"></head><body><div id="root"></div>
<script src="/react.js"></script><script src="/react-dom.js"></script><script src="/citadels/react-inlinesvg.min.js"></script><script src="/citadels/setup.js"></script><script src="/app.js"></script><script src="/bootstrap.js"></script></body></html>`;
const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://localhost").pathname;
    let body, type = "application/javascript";
    if (url === "/") {body = html; type = "text/html";}
    else if (url === "/app.js") body = compiled;
    else if (url === "/bootstrap.js") body = bootstrap;
    else {
        const file = url === "/react.js" ? path.join(path.dirname(frontend.resolve("react/package.json")), "umd/react.development.js")
            : url === "/react-dom.js" ? path.join(path.dirname(frontend.resolve("react-dom/package.json")), "umd/react-dom.development.js")
            : url.startsWith("/citadels/") ? path.join(publicDir, url.slice("/citadels/".length)) : null;
        if (!file || (!file.startsWith(publicDir + path.sep) && !url.startsWith("/react")) || !fs.existsSync(file)) {
            response.writeHead(404); response.end(); return;
        }
        body = fs.readFileSync(file);
        type = ({".css": "text/css", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml"})[path.extname(file)] || type;
    }
    response.writeHead(200, {"Content-Type": type}); response.end(body);
});

(async () => {
    let browser;
    try {
        await new Promise((resolve, reject) => {server.once("error", reject); server.listen(0, "127.0.0.1", resolve);});
        browser = await chromium.launch({channel: "chrome", headless: true});
        const page = await browser.newPage({viewport: {width: 1280, height: 900}});
        const errors = [], requests = [];
        page.on("pageerror", error => errors.push(error.message));
        page.on("request", request => requests.push(new URL(request.url()).pathname));
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        const choices = page.getByRole("radio");
        await choices.first().waitFor();
        assert.equal(await choices.count(), Object.keys(require("../public/setup").backgrounds).length);
        assert.equal(await choices.first().isChecked(), true);
        const framesBefore = await page.evaluate(() => frames.length);
        await page.getByRole("radio", {name: "Ночной порт"}).check();
        assert.equal(await page.locator('input[name="party-background"]:checked').count(), 1);
        assert.equal(await choices.first().isChecked(), false);
        assert.equal(await page.evaluate(() => frames.length), framesBefore);
        assert.ok(!(await page.evaluate(() => document.body.style.backgroundImage)).includes("waterfront.webp"));
        await page.reload();
        assert.equal(await page.getByRole("radio", {name: "Ночной порт"}).isChecked(), true);
        await page.locator(".background-settings").scrollIntoViewIfNeeded();
        await page.waitForFunction(() => [...document.querySelectorAll('.background-option img')].every(img => img.complete && img.naturalWidth > 0));
        assert.ok(!requests.some(url => /\/backgrounds\/(?!.*-thumb\.webp$).*\.webp$/.test(url)), "The editor loaded a full background");
        await page.locator(".background-settings").screenshot({path: path.join(output, "background-picker-desktop.png")});
        for (const width of [390, 320]) {
            await page.setViewportSize({width, height: 844});
            await page.getByRole("radio", {name: "Королевская гавань"}).check();
            const fit = await page.locator(".background-settings").evaluate(element => {
                const box = element.getBoundingClientRect();
                return box.left >= 0 && box.right <= document.documentElement.clientWidth;
            });
            assert.ok(fit, "The background picker overflows at " + width);
            await page.locator(".background-settings").screenshot({path: path.join(output, "background-picker-" + width + ".png")});
        }
        await page.getByRole("button", {name: "Создать", exact: true}).click();
        assert.equal(await page.evaluate(() => started.at(-1).backgroundId), "royal");
        const backgroundResponse = page.waitForResponse(response => response.url().endsWith("/backgrounds/royal.webp"));
        await page.evaluate(() => {
            ReactDOM.unmountComponentAtNode(document.getElementById('root'));
            handlers.state({...data, phase: 1, currentPlayer: 0, backgroundId: started.at(-1).backgroundId});
        });
        await page.waitForFunction(() => document.body.style.backgroundImage.includes("royal.webp"));
        assert.equal((await backgroundResponse).status(), 200);
        const style = await page.evaluate(() => {
            const value = getComputedStyle(document.body);
            return [value.backgroundSize, value.backgroundRepeat, value.backgroundPosition];
        });
        assert.deepEqual(style, ["cover", "no-repeat", "50% 50%"]);
        await page.evaluate(() => handlers.state({...data, currentPlayer: 0, backgroundId: "royal"}));
        assert.ok((await page.evaluate(() => document.body.style.backgroundImage)).includes("royal.webp"));
        assert.deepEqual(errors, []);
        console.log("BACKGROUND UI PASS: selection, thumbnails, F5, mobile 390/320, start payload, shared state, cover and lobby retention");
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => {console.error(error); process.exitCode = 1;});
