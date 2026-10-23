"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const setup = require("../public/setup");
const source = fs.readFileSync(require.resolve("../public/app.jsx"), "utf8");

// Exercise the real client event boundary, as in setup-client.test.js.
function gameClient(state) {
    class Component {setState(change) {this.state = Object.assign({}, this.state, change);}}
    const context = vm.createContext({React: {Component}, CitadelsSetup: setup, localStorage: {}});
    const start = source.indexOf("class Game extends React.Component");
    const end = source.indexOf("    render()", start);
    vm.runInContext(source.slice(start, end) + "}\nglobalThis.Game = Game;", context);
    const game = new context.Game();
    game.state = Object.assign(game.state, {phase: 2, currentPlayer: 0, userSlot: 0, buildDistricts: 1, player: {action: null, hand: []}, playerDistricts: {0: []}}, state);
    const emitted = [];
    game.socket = {emit(...args) {emitted.push(JSON.parse(JSON.stringify(args)));}};
    return {game, emitted};
}

test("the client quotes the current construction payment after permanent and per-factory reductions", () => {
    const {game} = gameClient({player: {hand: [{type: "museum", kind: 9, cost: 5, buildDiscount: 1}]}, playerDistricts: {0: [{type: "factory", kind: 9}, {type: "factory", kind: 9}]}});
    assert.equal(game.getBuildCost(0), 2);
});

test("choosing one Museum sends that exact source index and clears the local selection", () => {
    const {game, emitted} = gameClient();
    game.setUserAction("museum", {districtSource: 3});
    game.handleClickHandCard(0);
    assert.deepEqual(emitted, [["museum-action", 0, 3]]);
    assert.equal(game.state.districtSource, null);
});

test("Mirror Hall lets the player cancel, build without copying, or select a foreign non-Theater district", () => {
    const {game, emitted} = gameClient({player: {hand: [{type: "mirror_hall", cost: 6, kind: 9}]}, playerDistricts: {0: [], 1: [{type: "theater"}, {type: "wine_cellar"}]}});
    game.handleClickHandCard(0);
    assert.equal(game.state.userAction, "mirror_hall");
    assert.deepEqual(emitted, []);
    game.handleClickBuilding(1, 0);
    assert.deepEqual(emitted, []);
    game.handleStopUserAction();
    assert.deepEqual(emitted, []);
    game.handleClickHandCard(0);
    game.handleClickBuilding(1, 1);
    assert.deepEqual(emitted, [["build-mirror", 0, 1, 1]]);
    game.handleClickHandCard(0);
    game.handleBuildMirror();
    assert.deepEqual(emitted[1], ["build-mirror", 0]);
});

test("Tower peek is read-only: selecting a visible card cannot take it, and closing uses its own event", () => {
    const {game, emitted} = gameClient({phase: 3, player: {action: "district-peek", hand: [], choose: [{type: "manor"}]}});
    game.handleTakeCard(0);
    assert.deepEqual(emitted, []);
    game.handleCloseDistrictPeek();
    assert.deepEqual(emitted, [["district-peek-close"]]);
});

test("Warlord target payment includes every Great Wall before the client submits the action", () => {
    const {game, emitted} = gameClient({player: {action: "warlord-action", hand: []}, playerGold: {0: 1}, playerDistricts: {0: [], 1: [{type: "watchtower", cost: 1}, {type: "great_wall", cost: 6}, {type: "great_wall", cost: 6}]}});
    game.handleClickBuilding(1, 0);
    assert.deepEqual(emitted, []);
    game.state.playerGold[0] = 2;
    game.handleClickBuilding(1, 0);
    assert.deepEqual(emitted, [["destroy", 1, 0]]);
});

test("Marshal respects the repeat limit without treating Quarry as a transfer exception", () => {
    const rules = setup.normalizeRules({duplicateLimit: 1});
    const {game, emitted} = gameClient({gameSetup: {rules}, player: {action: "marshal-action", hand: []}, playerGold: {0: 9}, playerDistricts: {0: [{type: "tavern", cost: 1}, {type: "tavern", cost: 1}, {type: "quarry", cost: 4}], 1: [{type: "tavern", cost: 1}]}});
    game.handleClickBuilding(1, 0);
    assert.deepEqual(emitted, []);
    game.state.playerDistricts[0].shift();
    game.handleClickBuilding(1, 0);
    assert.deepEqual(emitted, [["seize-district", 1, 0]]);
});

test("Diplomat requires its completed-city flag and includes both Great Walls in the exchange payment", () => {
    const rules = setup.normalizeRules();
    const {game, emitted} = gameClient({citySize: 3, gameSetup: {rules}, player: {action: "diplomat-action", hand: []}, playerGold: {0: 0}, playerDistricts: {0: [{type: "tavern", cost: 1}], 1: [{type: "market", cost: 2}, {type: "great_wall", cost: 6}, {type: "great_wall", cost: 6}]}});
    game.handleClickBuilding(0, 0);
    game.handleClickBuilding(1, 0);
    assert.deepEqual(emitted, []);
    game.state.gameSetup.rules.diplomatCompleteCity = true;
    game.state.playerGold[0] = 2;
    game.handleClickBuilding(1, 0);
    assert.deepEqual(emitted, []);
    game.state.playerGold[0] = 3;
    game.handleClickBuilding(1, 0);
    assert.deepEqual(emitted, [["exchange-districts", 0, 1, 0]]);
});

test("Diplomat checks both receiving cities and allows exchanges that do not increase existing excess", () => {
    for (const ownCity of [[{type: "tavern", cost: 1}], [{type: "tavern", cost: 1}, {type: "tavern", cost: 1}, {type: "market", cost: 2}]]) {
        const {game, emitted} = gameClient({gameSetup: {rules: setup.normalizeRules()}, player: {action: "diplomat-action", hand: []}, playerGold: {0: 9}, playerDistricts: {0: ownCity, 1: [{type: "tavern", cost: 1}, {type: "temple", cost: 1}]}});
        game.handleClickBuilding(0, ownCity.length - 1);
        game.handleClickBuilding(1, ownCity.length === 1 ? 1 : 0);
        assert.deepEqual(emitted, []);
        game.handleClickBuilding(0, 0);
        game.handleClickBuilding(1, 0);
        assert.deepEqual(emitted, [["exchange-districts", 0, 1, 0]]);
    }
});

test("Magistrate cannot reveal an order to gain another copy unless its override is enabled", () => {
    const {game, emitted} = gameClient({targetSlot: 1, gameSetup: {rules: setup.normalizeRules()}, player: {action: "magistrate-open", hand: []}, playerDistricts: {0: [{type: "tavern", cost: 1}], 1: [{type: "tavern", cost: 1}]}});
    game.handleTokenOpen("yes");
    assert.deepEqual(emitted, []);
    game.state.gameSetup.rules.magistrateOverLimit = true;
    game.handleTokenOpen("yes");
    assert.deepEqual(emitted, [["magistrate-open", "yes"]]);
});

test("ordinary construction and Mirror results honor repeat caps while Quarry keeps its construction exception", () => {
    const {game, emitted} = gameClient({gameSetup: {rules: setup.normalizeRules({duplicateLimit: 1})}, player: {action: null, hand: [{type: "tavern", cost: 1}, {type: "mirror_hall", cost: 6}]}, playerDistricts: {0: [{type: "tavern", cost: 1}, {type: "tavern", cost: 1}], 1: [{type: "tavern", cost: 1}, {type: "market", cost: 2}]}});
    game.handleClickHandCard(0);
    assert.deepEqual(emitted, []);
    game.state.playerDistricts[0].push({type: "quarry", cost: 4});
    game.handleClickHandCard(0);
    assert.deepEqual(emitted, [["build", 0]]);
    game.state.playerDistricts[0].pop();
    game.handleClickHandCard(1);
    game.handleClickBuilding(1, 0);
    assert.equal(emitted.length, 1);
    game.handleClickBuilding(1, 1);
    assert.deepEqual(emitted[1], ["build-mirror", 1, 1, 1]);
});

test("the second Necropolis and Den of Thieves keep their hand index for gold and alternative payment", () => {
    for (const type of ["necropolis", "den_of_thieves"]) {
        const {game, emitted} = gameClient({player: {action: null, hand: [{type, cost: 6}, {type, cost: 6, buildDiscount: 2, wizard: true}, {type: "tavern", cost: 1}]}, playerDistricts: {0: [{type: "market", cost: 2}]}});
        game.handleClickHandCard(1);
        game.handleClickBuildForGold();
        assert.deepEqual(emitted, [["build", 1]]);
        game.handleClickHandCard(1);
        if (type === "necropolis") game.handleClickBuilding(0, 0);
        else game.handleApplyAction(0, [0]);
        assert.deepEqual(emitted[1], type === "necropolis" ? ["build-necropolis", 0, 1] : ["build-den-of-thieves", [0], 1]);
    }
});

test("district actions wait for Witch, Blackmailer and an out-of-turn Emperor response", () => {
    const blocked = [{witched: "4_1", witchedstate: 2}, {blackmailed: ["4_1"]}, {player: {action: "emperor-nores-action", hand: []}}, {player: {action: "blackmailed-response", hand: []}}];
    for (const change of blocked) {
        const {game, emitted} = gameClient(Object.assign({currentCharacter: "4_1", player: {action: null, hand: []}}, change));
        game.handleDistrictAction("divination_tower", 0);
        assert.deepEqual(emitted, []);
    }
    const {game, emitted} = gameClient({currentCharacter: "4_1", tookResource: false});
    game.handleDistrictAction("divination_tower", 0);
    assert.deepEqual(emitted, [["divination-tower-action", 0]]);
});

test("Cardinal finances the chosen Mirror copy using the original card payment and retains its target", () => {
    const {game, emitted} = gameClient({currentCharacter: "5_3", player: {action: "cardinal-action", hand: [{type: "mirror_hall", cost: 6, kind: 9}, ...Array.from({length: 6}, () => ({type: "tavern", cost: 1, kind: 6}))]}, playerGold: {0: 0, 1: 6}, playerCharacter: {0: ["5_3"], 1: []}, playerDistricts: {0: [], 1: [{type: "museum", cost: 4, kind: 9}]}});
    game.handleClickHandCard(0);
    game.handleClickBuilding(1, 0);
    assert.equal(game.state.userAction, "cardinal-action-player");
    assert.deepEqual(emitted, []);
    game.handleCardinalActionPlayer(1);
    for (let index = 1; index <= 6; index++) game.handleClickHandCard(index);
    game.handleCardinalActionCards();
    assert.deepEqual(emitted, [["cardinal-sell", 1, 0, [1, 2, 3, 4, 5, 6], 1, 0]]);
    assert.equal(game.state.mirrorTarget, null);
});

test("the selected discounted Necropolis can still use Cardinal financing from its gold choice", () => {
    const {game, emitted} = gameClient({currentCharacter: "5_3", player: {action: "cardinal-action", hand: [{type: "necropolis", cost: 5, kind: 9}, {type: "necropolis", cost: 5, kind: 9, buildDiscount: 2}, {type: "market", cost: 2}, {type: "temple", cost: 1}, {type: "tavern", cost: 1}]}, playerGold: {0: 0, 1: 3}, playerCharacter: {0: ["5_3"], 1: []}, playerDistricts: {0: [{type: "market", cost: 2}], 1: []}});
    game.handleClickHandCard(1);
    game.handleClickBuildForGold();
    assert.equal(game.state.userAction, "cardinal-action-player");
    assert.deepEqual(emitted, []);
    game.handleCardinalActionPlayer(1);
    for (const index of [2,3,4]) game.handleClickHandCard(index);
    game.handleCardinalActionCards();
    assert.deepEqual(emitted, [["cardinal-sell", 1, 1, [2,3,4]]]);
});
