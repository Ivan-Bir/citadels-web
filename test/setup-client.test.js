"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const setup = require("../public/setup");
const source = fs.readFileSync(require.resolve("../public/app.jsx"), "utf8");

// These class sections contain no JSX: run their real handlers without Babel or a browser.
function loadClass(name, firstExcludedMethod, globals = {}) {
    const start = source.indexOf("class " + name + " extends React.Component");
    const end = source.indexOf("    " + firstExcludedMethod + "(", start);
    assert.ok(start >= 0 && end > start, "Unable to find the frontend class section");
    class Component {
        constructor(props) { this.props = props; }
        setState(change) { this.state = Object.assign({}, this.state, change); }
    }
    const context = vm.createContext({React: {Component}, CitadelsSetup: setup, ...globals});
    vm.runInContext(source.slice(0, source.indexOf("class Player extends React.Component")) + source.slice(start, end) + "}\nglobalThis.TestClass = " + name, context);
    return context.TestClass;
}

function mountedGame() {
    const handlers = {};
    const socket = {on(event, handler) {handlers[event] = handler;}, emit() {}};
    const Game = loadClass("Game", "getSound", {
        localStorage: {}, document: {}, window: {socket},
        CommonRoom: {
            roomInit(game) {game.socket = socket; game.userId = "host"; game.roomId = "test"; return {roomId: "test"};},
            processCommonRoom() {}
        }
    });
    const game = new Game();
    game.state = {...game.state, phase: 0, userSlot: 0, currentPlayer: 0, hostId: "host",
        showCreateGamePanel: true, setupPending: false, setupError: "previous error", buildTarget: null};
    game.componentDidMount();
    return {game, handlers};
}

test("an externally started game closes the editor independently of the local start request", () => {
    for (const phase of [1, 1.5, 2, 3]) {
        for (const setupPending of [false, true]) {
            const {game, handlers} = mountedGame();
            game.state.setupPending = setupPending;
            handlers.state({phase, hostId: "host", currentPlayer: 0, playerSlots: ["host", "player"]});
            assert.equal(game.state.showCreateGamePanel, false);
            assert.equal(game.state.setupPending, false);
            assert.equal(game.state.setupError, null);
        }
    }
});

test("losing ownership closes the editor while ordinary lobby updates preserve it", () => {
    const {game, handlers} = mountedGame();
    handlers.state({phase: 0, hostId: "host", currentPlayer: 0, playerSlots: ["host", "player"]});
    assert.equal(game.state.showCreateGamePanel, true);
    handlers.state({phase: 0, hostId: "player", currentPlayer: 0, playerSlots: ["host", "player"]});
    assert.equal(game.state.showCreateGamePanel, false);
});

test("import and export refuse an active game, another host, gallery and an unmounted panel", () => {
    let reads = 0, exports = 0;
    const Panel = loadClass("CreateGamePanel", "renderStartingSettings", {
        FileReader: class {readAsText() {reads++;}},
        URL: {createObjectURL() {exports++;}}, Blob: class {}
    });
    for (const change of [{phase: 1}, {phase: 2}, {hostId: "other"}, {galleryMode: true}, {unmounted: true}]) {
        const props = {data: {phase: 0, userId: "host", hostId: "host", playerSlots: ["host", "player"]}, galleryMode: false};
        Object.assign(props.data, change);
        props.galleryMode = change.galleryMode === true;
        const panel = new Panel(props);
        panel.unmounted = change.unmounted === true;
        const before = JSON.stringify(panel.state);
        panel.handleImportSetup({target: {files: [{size: 1}], value: "test.json"}});
        panel.handleExportSetup();
        assert.equal(JSON.stringify(panel.state), before);
    }
    assert.equal(reads, 0);
    assert.equal(exports, 0);
});

test("a pending file read cannot apply its setup after the game starts or ownership changes", () => {
    const Panel = loadClass("CreateGamePanel", "renderStartingSettings", {
        FileReader: class {readAsText() {}},
    });
    for (const change of [{phase: 1}, {hostId: "other"}]) {
        const props = {data: {phase: 0, userId: "host", hostId: "host", playerSlots: ["host", "player"]}};
        const panel = new Panel(props);
        panel.handleImportSetup({target: {files: [{size: 1}], value: "test.json"}});
        assert.equal(panel.state.importPending, true);
        const nextSetup = setup.getDefaultSetup(); nextSetup.starting.gold = 19;
        panel.importReader.result = setup.serializeSetup(nextSetup);
        Object.assign(props.data, change);
        panel.importReader.onload();
        assert.equal(panel.state.starting.gold, 2);
    }
});

test("reset restores all four settings blocks, recovers invalid input and preserves the pack and discard rule", () => {
    const Panel = loadClass("CreateGamePanel", "renderStartingSettings");
    for (const players of [2, 3, 4]) {
        const panel = new Panel({data: {
            phase: 0, userId: "host", hostId: "host",
            playerSlots: Array.from({length: players}, (_, i) => i ? "player" + i : "host")
        }});
        panel.state.basicCounts.manor = 9;
        panel.state.timerSettings.enabled = false;
        panel.state.starting = {handSize: 6, minUnique: 2, gold: 5, exactUnique: true, firstCrownReduction: {cards: 1, gold: 2}};
        panel.state.rules = {citySize: 10, bonuses: {firstCity: 6, otherCities: 1, allColors: 0}, preventRepeatedRandomDiscard: true, duplicateLimit: 3, diplomatCompleteCity: true, magistrateOverLimit: true};
        const before = panel.getSetup();
        panel.state.starting.handSize = "";
        panel.state.rules.bonuses.firstCity = -1;
        panel.handleResetStartingSettings();
        const after = panel.getSetup();
        assert.deepEqual(after, {...before, starting: setup.normalizeStarting(), rules: setup.normalizeRules({preventRepeatedRandomDiscard: true})});
        assert.equal(setup.getCitySize(players, after.rules), players === 3 ? 8 : 7);
    }
});

test("reset refuses an active game, another host and a pending import or start", () => {
    const Panel = loadClass("CreateGamePanel", "renderStartingSettings");
    for (const change of [{phase: 1}, {hostId: "other"}, {setupPending: true}, {importPending: true}]) {
        const props = {data: {phase: 0, userId: "host", hostId: "host", playerSlots: ["host", "player"]}};
        const panel = new Panel(props);
        panel.state.starting.gold = 7;
        Object.assign(props.data, change);
        panel.state.importPending = change.importPending;
        const before = JSON.stringify(panel.state);
        panel.handleResetStartingSettings();
        assert.equal(JSON.stringify(panel.state), before);
    }
});

test("separate setup events survive ordinary room updates and clear on entering an empty room", () => {
    const {game, handlers} = mountedGame();
    const value = setup.getDefaultSetup();
    value.rules.bonuses.allColors = 9;
    handlers["game-setup"](value);
    handlers.state({phase: 1, hostId: "host", currentPlayer: 0, playerSlots: ["host", "player"]});
    assert.deepEqual(game.state.gameSetup, value);
    handlers["game-setup"](null);
    assert.equal(game.state.gameSetup, null);
});

test("host edits persist locally across remounts without sending any socket messages", () => {
    const data = new Map();
    let writes = 0;
    const storage = {
        getItem(key) {return data.get(key) ?? null;},
        setItem(key, value) {writes++; data.set(key, value);},
        removeItem(key) {data.delete(key);}
    };
    const Panel = loadClass("CreateGamePanel", "renderStartingSettings", {
        window: {sessionStorage: storage}, document: {body: {style: {overflow: ""}}}
    });
    const props = {
        data: {phase: 0, userId: "host", hostId: "host", playerSlots: ["host", "player"]},
        game: {roomId: "room", socket: {emit() {assert.fail("Local drafts must not send socket messages");}}}
    };
    const panel = new Panel(props);
    panel.componentDidMount();
    panel.handleSetupNumberChange("starting", "gold", "7");
    panel.componentDidUpdate();
    assert.equal(writes, 2);
    panel.componentWillUnmount();
    const restored = new Panel(props);
    restored.componentDidMount();
    assert.equal(restored.state.starting.gold, 7);
    assert.equal(writes, 2, "Opening the editor should not rewrite an unchanged draft");
    restored.handleSetupNumberChange("starting", "gold", "");
    restored.componentDidUpdate();
    assert.equal(writes, 2);
    assert.equal(new Panel(props).state.starting.gold, 7);

    const otherRoom = new Panel({...props, game: {...props.game, roomId: "other"}});
    assert.equal(otherRoom.state.starting.gold, 2);
    props.data.hostId = "other";
    restored.handleSetupNumberChange("starting", "gold", "19");
    restored.componentDidUpdate();
    restored.componentWillUnmount();
    assert.equal(writes, 2);
    const viewer = new Panel(props);
    assert.equal(viewer.state.starting.gold, 2);
});

test("structural import preserves Theater for a future four-player party", () => {
    const Panel = loadClass("CreateGamePanel", "renderStartingSettings", {FileReader: class {readAsText() {}}});
    const panel = new Panel({data: {phase: 0, userId: "host", hostId: "host", playerSlots: ["host", "player"]}});
    panel.presets = {};
    const pack = setup.getDefaultSetup(4);
    pack.districts.unique = ["theater"];
    panel.handleImportSetup({target: {files: [{size: 1}], value: "pack.json"}});
    panel.importReader.result = setup.serializeSetup(pack);
    panel.importReader.onload();
    assert.equal(panel.state.importError, null);
    assert.deepEqual([...panel.state.districtsSelected], ["theater"]);
    assert.ok(setup.getStartErrors(panel.getSetup(), 2).length);
});

test("creator mode survives remount without entering the exported game setup", () => {
    const data = new Map();
    const storage = {getItem(k) {return data.get(k) ?? null;}, setItem(k,v) {data.set(k,v);}, removeItem(k) {data.delete(k);}};
    const Panel = loadClass("CreateGamePanel", "renderStartingSettings", {window: {sessionStorage: storage}, document: {body: {style: {overflow: ""}}}});
    const props = {data: {phase: 0, userId: "host", hostId: "host", playerSlots: ["host", "player"]}, game: {roomId: "creator"}};
    const panel = new Panel(props);
    panel.state.creatorMode = true;
    panel.state.preserveCharacters = true;
    panel.componentDidUpdate();
    const restored = new Panel(props);
    assert.equal(restored.state.creatorMode, true);
    assert.equal(Object.hasOwn(restored.getSetup(), "creatorMode"), false);
    assert.equal(Object.hasOwn(restored.getSetup().rules, "creatorMode"), false);
});

test('Stone Bridge is selected alongside special cards without gaining a district type', () => {
    const Panel = loadClass('CreateGamePanel', 'renderStartingSettings');
    const panel = new Panel({data: {phase: 0, userId: 'host', hostId: 'host', playerSlots: ['host', 'player']}});
    assert.ok(panel.getSelectableDistricts().includes('stone_bridge'));
    assert.equal(panel.isDistrictSelected('stone_bridge'), false);
    const initial = panel.getSetup();
    panel.handleClickDistrict('stone_bridge');
    const selected = panel.getSetup();
    assert.equal(panel.isDistrictSelected('stone_bridge'), true);
    assert.equal(selected.districts.basic.stone_bridge, 1);
    assert.deepEqual([...selected.districts.unique], [...initial.districts.unique]);
    assert.equal(setup.districts.stone_bridge.type, 0);
    const restored = setup.parseSetup(setup.serializeSetup(selected));
    assert.equal(restored.districts.basic.stone_bridge, 1);
    panel.handleClickDistrict('stone_bridge');
    assert.equal(panel.getSetup().districts.basic.stone_bridge, 0);
});
