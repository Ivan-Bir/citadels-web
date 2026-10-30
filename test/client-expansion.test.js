"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const setup = require("../public/setup");
const source = fs.readFileSync(require.resolve("../public/app.jsx"), "utf8");

// Exercise the real client event boundary, as in setup-client.test.js.
function gameClient(state, connect = false) {
    const handlers = {};
    class Component {setState(change) {this.state = Object.assign({}, this.state, change);}}
    const context = vm.createContext({React: {Component}, CitadelsSetup: setup, localStorage: {},
        setTimeout, clearTimeout,
        window: {socket: {on(name, handler) {handlers[name] = handler;}}, matchMedia: () => ({matches: false})},
        document: {body: {style: {}}},
        CommonRoom: {roomInit(game) {game.userId = "host"; return {roomId: "test"};}, processCommonRoom() {}}
    });
    const start = source.indexOf("class Game extends React.Component");
    const end = source.indexOf("    render()", start);
    vm.runInContext(source.slice(start, end) + "}\nglobalThis.Game = Game;", context);
    const game = new context.Game();
    game.state = Object.assign(game.state, {phase: 2, currentPlayer: 0, userSlot: 0, buildDistricts: 1, player: {action: null, hand: []}, playerDistricts: {0: []}}, state);
    const emitted = [];
    game.socket = {emit(...args) {emitted.push(JSON.parse(JSON.stringify(args)));}, on(name, handler) {handlers[name] = handler;}};
    if (connect) {game.componentDidMount(); emitted.length = 0;}
    return {game, emitted, handlers};
}

test("the client quotes the current construction payment after permanent and per-factory reductions", () => {
    const {game} = gameClient({player: {hand: [{type: "museum", kind: 9, cost: 5, buildDiscount: 1}]}, playerDistricts: {0: [{type: "factory", kind: 9}, {type: "factory", kind: 9}]}});
    assert.equal(game.getBuildCost(0), 2);
});

test("hand construction hints quote the payable price before taking resources and explain exhausted limits", () => {
    const {game} = gameClient({tookResource: false, playerGold: {0: 2}, player: {action: null, hand: [{type: "museum", kind: 9, cost: 5, buildDiscount: 1}]}, playerDistricts: {0: [{type: "factory", kind: 9}, {type: "factory", kind: 9}]}});
    assert.equal(game.getHandBuildHint(0), "Стоимость постройки: 2");
    game.state.buildDistricts = 0;
    assert.equal(game.getHandBuildHint(0), "Достигнут лимит строительства в ход");
    game.state.buildDistricts = 1;
    game.state.playerGold[0] = 1;
    assert.equal(game.getHandBuildHint(0), "Недостаточно золота");
});

test("hand hints distinguish response waits, role bans and card-specific construction exceptions", () => {
    const {game} = gameClient({citySize: 7, currentCharacter: "4_1", playerGold: {0: 20}, player: {action: null, hand: [{type: "temple", cost: 1, kind: 5}]}});
    const cases = [
        [{phase: 3}, "Строительство доступно только в основной ход"],
        [{phase: 2, currentPlayer: 1}, "Сейчас ход другого игрока"],
        [{currentPlayer: 0, buildingBan: true}, "Строительство запрещено Судейской палатой"],
        [{buildingBan: false, witched: "4_1", witchedstate: 2, buildDistricts: -1}, "Сначала завершите обязательное действие"],
        [{witched: null, blackmailed: ["4_1"]}, "Сначала завершите обязательное действие"],
        [{blackmailed: [], currentCharacter: "7_2"}, "Этот персонаж не может строить кварталы"],
        [{buildDistricts: 1, currentCharacter: "4_1"}, "Стоимость постройки: 1"]
    ];
    for (const [change, hint] of cases) {
        Object.assign(game.state, change);
        assert.equal(game.getHandBuildHint(0), hint);
    }
    game.state.player.action = "magistrate-open";
    assert.equal(game.getHandBuildHint(0), "Сначала завершите обязательное действие");
    game.state.player.action = null;
    game.state.playerDistricts[0] = [{type: "temple", kind: 5}];
    assert.equal(game.getHandBuildHint(0), "Превышен лимит повторяющихся кварталов");
    game.state.playerDistricts[0].push({type: "quarry", kind: 9});
    assert.equal(game.getHandBuildHint(0), "Стоимость постройки: 1");
    game.state.playerDistricts[0].pop();
    game.state.currentCharacter = "3_2";
    assert.equal(game.getHandBuildHint(0), "Стоимость постройки: 1");
    game.state.buildDistricts = 0;
    game.state.player.hand[0].wizard = true;
    assert.equal(game.getHandBuildHint(0), "Стоимость постройки: 1");
    game.state.currentCharacter = "4_1";
    assert.equal(game.getHandBuildHint(0), "Превышен лимит повторяющихся кварталов");
    game.state.player.hand[0] = {type: "stable", cost: 2, kind: 9};
    assert.equal(game.getHandBuildHint(0), "Стоимость постройки: 2");
    game.state.currentCharacter = "6_3";
    game.state.player.hand[0] = {type: "market", cost: 2, kind: 6};
    assert.equal(game.getHandBuildHint(0), "Стоимость постройки: 2");
    game.state.buildDistricts = -1;
    assert.equal(game.getHandBuildHint(0), "Этот персонаж не может строить кварталы");
    game.state.buildDistricts = 1;
    game.state.player.hand[0] = {type: "secret_vault", cost: 0, kind: 9};
    assert.equal(game.getHandBuildHint(0), "Тайное убежище нельзя построить");
    game.state.player.hand[0] = {type: "monument", cost: 4, kind: 9};
    game.state.playerDistricts[0] = Array.from({length: 5}, () => ({type: "tavern"}));
    assert.equal(game.getHandBuildHint(0), "Монумент нельзя построить как последний квартал");
    game.state.playerDistricts[0][0] = {type: "catacombs"};
    assert.equal(game.getHandBuildHint(0), "Стоимость постройки: 4");
});

test("hand hints consider free replacements and quote the explicitly selected replacement", () => {
    const {game} = gameClient({citySize: 7, playerGold: {0: 0}, player: {action: null, hand: [{type: "necropolis", cost: 5, kind: 9}]}, playerDistricts: {0: [{type: "necropolis", kind: 9}]}});
    assert.equal(game.getHandBuildHint(0), "Стоимость постройки: 5");
    assert.equal(game.getHandBuildStatus(0, {goldOnly: true}).reason, "Превышен лимит повторяющихся кварталов");
    game.setUserAction("necropolis", {buildTarget: 0});
    assert.equal(game.getHandBuildHint(0), "Стоимость постройки: 0");
    game.handleStopUserAction();
    game.state.player.hand[0] = {type: "monument", cost: 4, kind: 9};
    game.state.playerDistricts[0] = [{type: "framework", kind: 9}, ...Array.from({length: 4}, () => ({type: "tavern"}))];
    assert.equal(game.getHandBuildHint(0), "Стоимость постройки: 4");
    assert.equal(game.getHandBuildStatus(0, {goldOnly: true}).reason, "Монумент нельзя построить как последний квартал");
    assert.equal(game.getHandBuildStatus(0, {frameworkIndex: 0}).cost, 0);
    assert.equal(game.getHandBuildStatus(0, {frameworkIndex: 0}).reason, null);
    game.setUserAction("framework", {districtSource: 0});
    assert.equal(game.getHandBuildHint(0), "Стоимость постройки: 0");
    game.state.player.hand[0] = {type: "framework", cost: 3, kind: 9};
    assert.equal(game.getHandBuildHint(0), "Стоимость постройки: 0");
    assert.equal(game.getHandBuildStatus(0, {goldOnly: true}).reason, "Превышен лимит повторяющихся кварталов");
    game.state.buildingBan = true;
    assert.equal(game.getHandBuildHint(0), "Строительство запрещено Судейской палатой");
});

test("hand hints account for card payment and require an active Cardinal with a different funded buyer", () => {
    const {game} = gameClient({playerGold: {0: 1}, player: {action: null, hand: [{type: "den_of_thieves", cost: 6, kind: 9, buildDiscount: 1}, {type: "temple"}, {type: "market"}, {type: "tavern"}]}, playerDistricts: {0: [{type: "factory", kind: 9}]}});
    assert.equal(game.getHandBuildHint(0), "Стоимость постройки: 4");
    assert.equal(game.getHandBuildStatus(0, {goldOnly: true}).reason, "Недостаточно золота");
    game.setUserAction("den_of_thieves", {buildTarget: 0});
    game.state.cardChosen = [1, 2];
    assert.equal(game.getHandBuildStatus(0).cost, 2);
    assert.equal(game.getHandBuildHint(0), "Недостаточно золота");
    game.state.cardChosen = [1, 2, 3];
    assert.equal(game.getHandBuildHint(0), "Стоимость постройки: 1");
    game.handleStopUserAction();
    game.state.player.hand.pop();
    assert.equal(game.getHandBuildHint(0), "Недостаточно золота");
    const cardinal = gameClient({currentCharacter: "5_3", playerGold: {0: 3, 1: 1}, playerCharacter: {0: ["5_3"], 1: []}, player: {action: "cardinal-action", hand: [{type: "cathedral", cost: 5, kind: 5}, {type: "temple"}, {type: "tavern"}]}}).game;
    assert.equal(cardinal.getHandBuildHint(0), "Недостаточно золота");
    cardinal.state.playerGold[1] = 2;
    assert.equal(cardinal.getHandBuildHint(0), "Стоимость постройки: 5");
    assert.equal(cardinal.getHandBuildStatus(0, {goldOnly: true}).reason, "Недостаточно золота");
    cardinal.state.player.action = null;
    assert.equal(cardinal.getHandBuildHint(0), "Недостаточно золота");
    cardinal.state.player.action = "cardinal-action";
    cardinal.state.player.hand.pop();
    assert.equal(cardinal.getHandBuildHint(0), "Недостаточно золота");
});

test("Mirror hand hints test copied district restrictions but retain the Mirror payment", () => {
    const {game} = gameClient({playerGold: {0: 6}, player: {action: null, hand: [{type: "mirror_hall", cost: 6, kind: 9}]}, playerDistricts: {0: [{type: "mirror_hall", kind: 9}], 1: [{type: "temple", kind: 5, cost: 1}]}});
    assert.equal(game.getHandBuildHint(0), "Стоимость постройки: 6");
    assert.equal(game.getHandBuildStatus(0, {goldOnly: true}).reason, "Превышен лимит повторяющихся кварталов");
    game.state.playerGold[0] = 5;
    assert.equal(game.getHandBuildHint(0), "Недостаточно золота");
    game.state.playerGold[0] = 6;
    game.state.playerDistricts[1][0] = {type: "theater", kind: 9};
    assert.equal(game.getHandBuildHint(0), "Превышен лимит повторяющихся кварталов");
    game.state.buildDistricts = 0;
    game.state.playerDistricts[1][0] = {type: "stable", kind: 9};
    assert.equal(game.getHandBuildHint(0), "Стоимость постройки: 6");
    assert.equal(game.getHandBuildStatus(0, {goldOnly: true}).reason, "Достигнут лимит строительства в ход");
    game.state.playerDistricts[0].push({type: "stable", kind: 9});
    assert.equal(game.getHandBuildHint(0), "Превышен лимит повторяющихся кварталов");
    game.state.currentCharacter = "6_3";
    game.state.playerDistricts[1][0] = {type: "market", kind: 6};
    assert.equal(game.getHandBuildHint(0), "Стоимость постройки: 6");
    game.state.buildDistricts = -1;
    assert.equal(game.getHandBuildHint(0), "Этот персонаж не может строить кварталы");
});

test("reading hand construction hints preserves Museum, Laboratory, Seer and Cardinal card selection", () => {
    for (const [action, event] of [["museum", "museum-action"], ["laboratory", "laboratory-action"], ["seer-return", "seer-return"], ["cardinal-action-cards", null]]) {
        const {game, emitted} = gameClient({buildDistricts: 0, playerGold: {0: 0}, player: {action: action === "seer-return" ? action : null, hand: [{type: "market", kind: 6, cost: 2}, {type: "temple", kind: 5, cost: 1}]}, playerDistricts: {0: [{type: "temple", kind: 5}]}});
        if (action !== "seer-return") game.setUserAction(action, {districtSource: 0, buildTarget: 0});
        const stateBeforeHint = JSON.stringify(game.state);
        game.getHandBuildHint(1);
        assert.equal(JSON.stringify(game.state), stateBeforeHint);
        game.handleClickHandCard(1);
        if (action === "cardinal-action-cards") {
            assert.deepEqual(Array.from(game.state.cardChosen), [1]);
            assert.deepEqual(emitted, []);
        } else {
            assert.deepEqual(emitted, [action === "seer-return" ? [event, 1] : [event, 1, 0]]);
        }
    }
});

test("choosing one Museum sends that exact source index and clears the local selection", () => {
    const {game, emitted} = gameClient();
    game.setUserAction("museum", {districtSource: 3});
    game.handleClickHandCard(0);
    assert.deepEqual(emitted, [["museum-action", 0, 3]]);
    assert.equal(game.state.districtSource, null);
});

test("Mirror Hall lets the player cancel, build without copying, or select a foreign non-Theater district", () => {
    const {game, emitted} = gameClient({player: {hand: [{type: "mirror_hall", cost: 6, kind: 9}]}, playerDistricts: {0: [], 1: [{type: "theater"}, {type: "winery"}]}});
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
        if (ownCity.length > 1) game.handleClickBuilding(0, 0);
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


test("Diplomat clicking the first selected district again clears selection without exchanging", () => {
    for (const slot of [0, 1]) {
        const {game, emitted} = gameClient({player: {action: "diplomat-action", hand: []}, playerGold: {0: 9}, playerDistricts: {0: [{type: "tavern", cost: 1}], 1: [{type: "market", cost: 2}]}});
        game.handleClickBuilding(slot, 0);
        assert.deepEqual(Array.from(game.state.cardChosen), [slot, 0]);
        game.handleClickBuilding(slot, 0);
        assert.deepEqual(Array.from(game.state.cardChosen), []);
        assert.deepEqual(emitted, []);
    }
});

test("Mirror Hall clicking its hand card again cancels copying without building", () => {
    const {game, emitted} = gameClient({player: {hand: [{type: "mirror_hall", cost: 6, kind: 9}]}});
    game.handleClickHandCard(0);
    assert.equal(game.state.userAction, "mirror_hall");
    assert.equal(game.state.buildTarget, 0);
    game.handleClickHandCard(0);
    assert.equal(game.state.userAction, null);
    assert.equal(game.state.buildTarget, null);
    assert.deepEqual(Array.from(game.state.cardChosen), []);
    assert.deepEqual(emitted, []);
});


test("final city display reveals scored Secret Vaults without adding built districts", () => {
    const temple = {type: "temple", cost: 1, kind: 5};
    const {game, emitted} = gameClient({phase: 0, winnerPlayer: 0, playerDistricts: {0: [temple]}, playerScore: {0: 4},
        playerScoreDetails: {0: {citySize: 1, nominal: 1, bonuses: [{id: "secret_vault", label: "Тайное убежище", points: 3}], total: 4}}});
    const before = JSON.stringify(game.state);
    const displayed = game.getDisplayedDistricts(0);
    assert.deepEqual(Array.from(displayed, card => card.type), ["temple", "secret_vault"]);
    assert.equal(displayed[1].cost, 0);
    assert.equal(displayed[1].scoreOnly, true);
    assert.equal(JSON.stringify(game.state), before);
    assert.equal(setup.getPlayerScoreDetails(game.state, 0).citySize, 1);
    assert.equal(setup.getPlayerScoreDetails(game.state, 0).total, 4);
    assert.deepEqual(emitted, []);
});

test("final city display supports multiple Vaults and does not duplicate older displayed copies", () => {
    const {game} = gameClient({phase: 0, winnerPlayer: 1, playerDistricts: {0: [{type: "temple", cost: 1, kind: 5}]},
        playerScoreDetails: {0: {bonuses: [{id: "secret_vault", points: 6}]}}});
    assert.deepEqual(Array.from(game.getDisplayedDistricts(0), card => card.type), ["temple", "secret_vault", "secret_vault"]);
    game.state.playerDistricts[0].push({type: "secret_vault", cost: 0});
    assert.equal(game.getDisplayedDistricts(0).filter(card => card.type === "secret_vault").length, 2);
    assert.equal(game.state.playerDistricts[0].length, 2);
    game.state.phase = 2;
    game.state.playerDistricts[0].pop();
    assert.equal(game.getDisplayedDistricts(0).length, 1);
    game.state.phase = 0;
    game.state.winnerPlayer = null;
    assert.equal(game.getDisplayedDistricts(0).length, 1);
});

test("legacy final city display uses the public scored Vault bonus without reading private hand identities", () => {
    const {game} = gameClient({phase: 0, winnerPlayer: 0, ender: null, king: 1, citySize: 7,
        gameSetup: {rules: setup.normalizeRules()}, playerHand: {0: 1}, playerGold: {0: 2}, playerScore: {0: 4},
        playerDistricts: {0: [{type: "temple", cost: 1, kind: 5}]}});
    Object.defineProperty(game.state, "player", {get() {throw new Error("private hand was read");}});
    assert.deepEqual(Array.from(game.getDisplayedDistricts(0), card => card.type), ["temple", "secret_vault"]);
});


function fleaMarketClient(state = {}, connect = false) {
    return gameClient(Object.assign({turnId: 12, currentCharacter: "4_1", tookResource: false,
        playerGold: {0: 0}, playerSlots: ["host", "guest"], hostId: "host", userId: "host",
        player: {action: null, hand: [{type: "secret_vault", cost: 0, kind: 9, instanceId: "hand-1"},
            {type: "museum", cost: 5, kind: 9, instanceId: "hand-2"}]},
        playerDistricts: {0: [{type: "flea_market", cost: 2, kind: 9, instanceId: "market-1"},
            {type: "flea_market", cost: 2, kind: 9, instanceId: "market-2"}]}
    }, state), connect);
}

test("Flea Market selects exactly one arbitrary hand card and submits only after confirmation", () => {
    for (const tookResource of [false, true]) {
        const {game, emitted} = fleaMarketClient({tookResource, buildingBan: true, buildDistricts: 0, districtDeckCount: 0, districtDiscardCount: 0});
        game.handleDistrictAction("flea_market", 1);
        assert.equal(game.state.userAction, "flea_market");
        game.handleFleaMarketExchange();
        assert.deepEqual(emitted, []);
        game.handleClickHandCard(1);
        assert.deepEqual(Array.from(game.state.cardChosen), [1]);
        game.handleClickHandCard(0); // Secret Vault is a legal exchange, even under a construction ban.
        assert.deepEqual(Array.from(game.state.cardChosen), [0]);
        assert.equal(game.getHandBuildHint(0), "Карта выбрана для обмена Барахолкой");
        assert.equal(game.getHandBuildHint(1), "Выберите эту карту для обмена Барахолкой");
        assert.deepEqual(emitted, []);
        game.handleFleaMarketExchange();
        assert.deepEqual(emitted, [["flea-market-action", 0, 1]]);
        assert.equal(game.state.userAction, null);
        assert.equal(game.state.fleaMarketContext, null);
        assert.equal(game.state.districtSource, null);
        assert.deepEqual(Array.from(game.state.cardChosen), []);
    }
});

test("Flea Market cancellation and deselection consume nothing and stale Wizard choose does not block it", () => {
    const {game, emitted} = fleaMarketClient();
    game.state.player.choose = [{type: "tavern"}];
    game.state.player.action = "wizard-action";
    game.handleDistrictAction("flea_market", 0);
    game.handleClickHandCard(0);
    game.handleClickHandCard(0);
    assert.deepEqual(Array.from(game.state.cardChosen), []);
    game.handleFleaMarketExchange();
    game.handleClickHandCard(1);
    game.handleStopUserAction();
    game.handleFleaMarketExchange();
    assert.deepEqual(emitted, []);
    assert.equal(game.state.fleaMarketContext, null);
});

test("Flea Market validates the exact unused source and requires a hand and an ordinary active turn", () => {
    const blocked = [
        {phase: 3}, {currentPlayer: 1}, {winnerPlayer: 0},
        {witched: "4_1", witchedstate: 2}, {blackmailed: ["4_1"]},
        ...["magistrate-open", "seer-return", "blackmailed-response", "blackmailed-open", "emperor-nores-action"]
            .map(action => ({player: {action, hand: [{type: "temple"}]}})),
        {player: {action: null, hand: []}},
        {playerDistricts: {0: [{type: "flea_market", actionsUsed: {flea_market: 12}}]}},
        {playerDistricts: {0: [{type: "museum"}]}}
    ];
    for (const state of blocked) {
        const {game, emitted} = fleaMarketClient(state);
        game.handleDistrictAction("flea_market", 0);
        assert.equal(game.state.userAction, null, JSON.stringify(state));
        assert.deepEqual(emitted, []);
    }
    for (const sourceIndex of [undefined, null, "0", -1, 0.5, 9]) {
        const {game} = fleaMarketClient();
        game.handleDistrictAction("flea_market", sourceIndex);
        assert.equal(game.state.userAction, null);
    }
    const {game} = fleaMarketClient();
    game.state.playerDistricts[0][0].actionsUsed = {flea_market: 11};
    game.handleDistrictAction("flea_market", 0);
    assert.equal(game.state.userAction, "flea_market");
});

test("Flea Market rejects stale hand, source, turn and mandatory-response contexts before confirming", () => {
    const mutations = [
        game => game.state.player.hand.reverse(),
        game => game.state.player.hand.push({type: "temple"}),
        game => {game.state.player.hand[0].buildDiscount = 1;},
        game => game.state.playerDistricts[0].shift(),
        game => game.state.playerDistricts[0].reverse(),
        game => {game.state.playerDistricts[0][0] = {...game.state.playerDistricts[0][0], instanceId: "replacement"};},
        game => {game.state.playerDistricts[0][0].actionsUsed = {flea_market: 12};},
        game => {game.state.turnId++;},
        game => {game.state.phase = 3;},
        game => {game.state.player.action = "seer-return";},
        game => {game.state.witched = "4_1"; game.state.witchedstate = 2;},
        game => {game.state.blackmailed = ["4_1"];}
    ];
    for (const mutate of mutations) {
        const {game, emitted} = fleaMarketClient();
        game.handleDistrictAction("flea_market", 0);
        game.handleClickHandCard(0);
        mutate(game);
        game.handleFleaMarketExchange();
        assert.deepEqual(emitted, []);
        assert.equal(game.state.userAction, null);
        assert.equal(game.state.fleaMarketContext, null);
    }
    const {game, emitted} = fleaMarketClient();
    game.handleDistrictAction("flea_market", 0);
    game.state.player.hand.shift();
    game.handleClickHandCard(0);
    assert.equal(game.state.userAction, null);
    assert.deepEqual(emitted, []);
});

test("both real socket state handlers cancel stale Flea Market selections and retain unchanged contexts", () => {
    for (const kind of ["public", "private"]) {
        const {game, emitted, handlers} = fleaMarketClient({}, true);
        game.handleDistrictAction("flea_market", 1);
        game.handleClickHandCard(0);
        if (kind === "private") {
            handlers["player-state"](JSON.parse(JSON.stringify(game.state.player)));
            assert.equal(game.state.userAction, "flea_market");
            handlers["player-state"]({...game.state.player, hand: game.state.player.hand.slice(1)});
        } else {
            const publicState = {phase: 2, currentPlayer: 0, playerSlots: ["host", "guest"],
                hostId: "host", turnId: 12, playerDistricts: JSON.parse(JSON.stringify(game.state.playerDistricts))};
            handlers.state(publicState);
            assert.equal(game.state.userAction, "flea_market");
            handlers.state({...publicState, playerDistricts: {0: publicState.playerDistricts[0].slice(0, 1)}});
        }
        assert.equal(game.state.userAction, null, kind);
        assert.equal(game.state.fleaMarketContext, null, kind);
        assert.deepEqual(Array.from(game.state.cardChosen), [], kind);
        assert.deepEqual(emitted, []);
    }
});
