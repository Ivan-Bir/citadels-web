"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const init = require("../module");
const setup = require("../public/setup");

function createRoom(players = 4) {
    let GameState;
    const messages = [];
    class RoomState extends EventEmitter {
        constructor() { super(); this.room = {}; this.eventHandlers = {}; }
    }
    const registry = {
        RoomState, handleAppPage() {},
        createRoomManager(path, State) { GameState = State; }
    };
    init({app: {use() {}, get() {}}, users: registry, static() {}}, "/test");
    const game = new GameState("host", {}, {
        send(target, event, data) { messages.push({target, event, data}); }
    }, {games: {citadels: {id: "test"}}, authUsers: {processAchievement() {}},
        achievements: {win100Citadels: {id: "win"}, winGames: {id: "games"}}});
    game.room.playerSlots = Array.from({length: 8}, (_, i) => i < players ? (i === 0 ? "host" : "player-" + i) : null);
    return {game, messages};
}
const chars = Array.from({length: 8}, (_, i) => (i + 1) + "_1");
const timer = setup.normalizeTimerSettings({enabled: false});

test("server includes every chosen district, persists setup and deals four cards each", () => {
    const {game} = createRoom();
    const counts = setup.getDefaultBasicCounts(); counts.manor = 9;
    game.userEventHandlers["start-game"]("host", chars, setup.uniqueIds, null, timer, counts);
    const all = game.state.districtDeck.concat(...Object.values(game.state.players).map(player => player.hand));
    assert.equal(game.room.phase, 1);
    assert.equal(all.length, 96);
    assert.equal(all.filter(card => card.type === "manor").length, 9);
    for (const id of setup.uniqueIds)
        assert.equal(all.filter(card => card.type === id).length, 1);
    assert.equal(game.room.gameSetup.districts.basic.manor, 9);
    assert.equal(game.getSnapshot().room.gameSetup.districts.unique.length, 38);
    Object.values(game.state.players).forEach(player => assert.equal(player.hand.length, 4));
    game.clearTurnTimer();
});
test("legacy start request defaults to standard basic counts", () => {
    const {game} = createRoom();
    game.userEventHandlers["start-game"]("host", chars, [], "basic", timer);
    assert.equal(game.room.phase, 1);
    assert.equal(game.state.districtDeck.length, 54 - 16);
    assert.deepEqual(game.room.gameSetup.districts.basic, setup.getDefaultBasicCounts());
    game.clearTurnTimer();
});
test("invalid requests leave room and private state untouched", () => {
    for (const args of [
        ["host", chars, [], null, timer, {manor: -1}],
        ["host", chars, [], null, timer, {}],
        ["host", chars, [], null, timer, {manor: 99}],
        ["host", chars, null, null, timer, undefined],
        ["host", [1,2,3,4,5,6,7,8], [], null, timer, undefined],
        ["other", chars, [], null, timer, undefined],
        ["host", chars, ["library", "library"], null, timer, undefined]
    ]) {
        const {game, messages} = createRoom();
        const before = JSON.stringify(game.getSnapshot());
        assert.doesNotThrow(() => game.userEventHandlers["start-game"](...args));
        assert.equal(JSON.stringify(game.getSnapshot()), before);
        assert.match(messages[messages.length - 1].event, /message|setup-error/);
    }
});
test("server rejects Theater for two players without silently changing the deck", () => {
    const {game, messages} = createRoom(2);
    game.userEventHandlers["start-game"]("host", chars, ["theater"], null, timer, setup.getDefaultBasicCounts());
    assert.equal(game.room.phase, 0);
    assert.match(messages[messages.length - 1].data, /Театр/);
});
test("a second request cannot restart an active game", () => {
    const {game, messages} = createRoom();
    game.userEventHandlers["start-game"]("host", chars, [], null, timer);
    const before = JSON.stringify(game.getSnapshot());
    game.userEventHandlers["start-game"]("host", chars, [], null, timer);
    assert.equal(JSON.stringify(game.getSnapshot()), before);
    assert.match(messages[messages.length - 1].data, /уже началась/);
    game.clearTurnTimer();
});

const district = type => ({type, cost: setup.districts[type].cost, kind: setup.districts[type].type});
function playingRoom(options) {
    const result = createRoom();
    const {game} = result;
    game.userEventHandlers['start-game']('host', chars, setup.uniqueIds, null, timer, setup.getDefaultBasicCounts(), options);
    assert.equal(game.room.phase, 1);
    game.room.phase = 2;
    game.room.currentPlayer = 0;
    game.room.currentCharacter = '8_1';
    game.state.currentIndCharacter = 8;
    game.state.players[0].action = null;
    game.room.tookResource = false;
    game.room.onlinePlayers.add('host');
    game.room.onlinePlayers.add('spectator');
    return result;
}
test('new starting conditions apply to every hand, gold, city size and public pile counts', () => {
    const {game} = createRoom();
    game.userEventHandlers['start-game']('host', chars, setup.uniqueIds, null, timer, setup.getDefaultBasicCounts(),
        {starting: {handSize: 6, minUnique: 2, gold: 9}, rules: {citySize: 10}});
    assert.equal(game.room.phase, 1);
    Object.entries(game.state.players).forEach(([slot, player]) => {
        assert.equal(player.hand.length, 6);
        assert.ok(player.hand.filter(card => card.kind === 9).length >= 2);
        assert.equal(game.room.playerHand[slot], 6);
        assert.equal(game.room.playerGold[slot], 9);
    });
    assert.equal(game.state.maxDistricts, 10);
    assert.equal(game.room.districtDeckCount, 92 - 24);
    assert.equal(game.room.districtDiscardCount, 0);
    assert.deepEqual(game.room.gameSetup.starting, setup.normalizeStarting({handSize: 6, minUnique: 2, gold: 9}));
    assert.ok(!('districtDeck' in game.room));
    assert.ok(!('districtDiscard' in game.room));
    game.clearTurnTimer();
});
test('event dispatcher forwards custom base deck and all starting options', () => {
    const {game} = createRoom(2);
    const basic = setup.getDefaultBasicCounts(); basic.manor = 9;
    game.userEvent('host', 'start-game', [chars, ['museum', 'library'], null, timer, basic,
        {starting: {handSize: 6, minUnique: 1, gold: 9}, rules: {citySize: 2}}]);
    assert.equal(game.room.phase, 1);
    assert.equal(game.room.gameSetup.districts.basic.manor, 9);
    assert.equal(game.state.maxDistricts, 2);
    for (const slot of [0, 1]) {
        assert.equal(game.room.playerGold[slot], 9);
        assert.equal(game.room.playerHand[slot], 6);
        assert.ok(game.state.players[slot].hand.some(card => card.kind === 9));
    }
    assert.equal(game.room.districtDeckCount, 60 - 12);
    game.clearTurnTimer();
});

test('event dispatcher preserves legacy requests and rejects invalid new settings atomically', () => {
    const {game, messages} = createRoom(2);
    const before = JSON.stringify(game.getSnapshot());
    game.userEvent('host', 'start-game', [chars, [], null, timer, setup.getDefaultBasicCounts(), {rules: {citySize: 11}}]);
    assert.equal(JSON.stringify(game.getSnapshot()), before);
    assert.equal(messages.at(-1).event, 'setup-error');
    game.userEvent('host', 'start-game', [chars, [], null, timer]);
    assert.equal(game.room.phase, 1);
    assert.equal(game.room.playerHand[0], 4);
    assert.equal(game.room.playerGold[0], 2);
    game.clearTurnTimer();
});

test('zero starting hand and gold are preserved', () => {
    const {game} = playingRoom({starting: {handSize: 0, gold: 0}, rules: {citySize: 2}});
    assert.equal(game.state.maxDistricts, 2);
    Object.entries(game.state.players).forEach(([slot, player]) => {
        assert.deepEqual(player.hand, []);
        assert.equal(game.room.playerHand[slot], 0);
        assert.equal(game.room.playerGold[slot], 0);
    });
    game.clearTurnTimer();
});
test('automatic city thresholds use 7 for two, 8 for three and 7 for all larger groups', () => {
    for (const players of [2,3,4,8]) {
        const {game} = createRoom(players);
        const roles = [3,8].includes(players) ? chars.concat('9_1') : chars;
        game.userEventHandlers['start-game']('host', roles, ['library','stable'], null, timer);
        assert.equal(game.state.maxDistricts, players === 3 ? 8 : 7);
        game.clearTurnTimer();
    }
});
test('invalid new settings or insufficient special cards leave the room unchanged', () => {
    for (const options of [null, [], {unknown: 3}, {starting: {handSize: 100}}, {starting: {minUnique: 2}},
        {starting: {gold: -1}}, {starting: {handSize: 0, minUnique: 1}}, {rules: {citySize: 1}}, {rules: {citySize: 11}}]) {
        const {game, messages} = createRoom();
        const before = JSON.stringify(game.getSnapshot());
        game.userEventHandlers['start-game']('host', chars, [], null, timer, setup.getDefaultBasicCounts(), options);
        assert.equal(JSON.stringify(game.getSnapshot()), before);
        assert.equal(messages.at(-1).event, 'setup-error');
    }
});
test('server rejects incompatible imported characters with a named reason', () => {
    const {game, messages} = createRoom(2);
    game.userEventHandlers['start-game']('host', chars.concat('9_2'), [], null, timer, setup.getDefaultBasicCounts());
    assert.equal(game.room.phase, 0);
    assert.match(messages.at(-1).data, /Королева.*5.*2/);
});
test('ordinary card choice discards leftovers and broadcasts both counts', () => {
    const {game, messages} = playingRoom();
    const cards = ['tavern','market','manor'].map(district);
    game.state.districtDeck = cards.slice();
    game.state.districtDiscard = [];
    const initialHand = game.state.players[0].hand.length;
    game.slotEventHandlers['take-resources'](0, 'card');
    assert.equal(game.room.phase, 3);
    assert.equal(game.room.districtDeckCount, 1);
    game.slotEventHandlers['take-card'](0, 0);
    assert.deepEqual(game.state.districtDiscard, [cards[1]]);
    assert.deepEqual(game.state.districtDeck, [cards[2]]);
    assert.equal(game.room.playerHand[0], initialHand + 1);
    assert.equal(game.room.districtDiscardCount, 1);
    const broadcast = messages.filter(message => message.event === 'state').at(-1);
    assert.ok(broadcast.target.has('spectator'));
    assert.equal(broadcast.data.districtDeckCount, 1);
    assert.equal(broadcast.data.districtDiscardCount, 1);
    game.clearTurnTimer();
});
test('scholar draws through a reshuffle and discards all unselected cards', () => {
    const {game} = playingRoom();
    game.state.players[0].action = 'scholar-action';
    const top = district('tavern');
    game.state.districtDeck = [top];
    game.state.districtDiscard = ['market','manor','castle'].map(district);
    game.slotEventHandlers['scholar-action'](0);
    assert.equal(game.state.players[0].choose.length, 4);
    assert.equal(game.state.players[0].choose[0], top);
    assert.equal(game.room.districtDiscardCount, 0);
    game.slotEventHandlers['scholar-response'](0, 0);
    assert.equal(game.room.phase, 2);
    assert.equal(game.state.districtDiscard.length, 3);
    assert.equal(game.state.districtDeck.length, 0);
    game.clearTurnTimer();
});
test('empty piles do not create an impossible card choice', () => {
    const {game} = playingRoom();
    game.state.districtDeck = []; game.state.districtDiscard = [];
    game.slotEventHandlers['take-resources'](0, 'card');
    assert.equal(game.room.phase, 2);
    assert.equal(game.room.tookResource, false);
    game.state.players[0].action = 'scholar-action';
    game.slotEventHandlers['scholar-action'](0);
    assert.equal(game.room.phase, 2);
    assert.equal(game.state.players[0].action, null);
    game.slotEventHandlers['take-resources'](0, 'coins');
    assert.equal(game.room.tookResource, true);
    game.clearTurnTimer();
});
test('navigator and card income count the actual cards drawn', () => {
    const {game} = playingRoom();
    const before = game.state.players[0].hand.length;
    game.state.districtDeck = [];
    game.state.districtDiscard = [district('market')];
    game.state.players[0].action = 'navigator-action';
    game.slotEventHandlers['navigator-resources'](0, 'card');
    assert.equal(game.room.playerHand[0], before + 1);
    assert.equal(game.room.playerHand[0], game.state.players[0].hand.length);
    game.room.incomeAction = true;
    game.room.currentCharacter = '4_3';
    game.state.currentIndCharacter = 4;
    game.room.playerDistricts[0] = [district('manor'), district('palace')];
    game.state.districtDiscard = [district('tavern')];
    game.slotEventHandlers['take-income'](0);
    assert.equal(game.room.playerHand[0], before + 2);
    game.clearTurnTimer();
});
test('laboratory and a destroyed Museum with its contents go to discard', () => {
    const {game} = playingRoom();
    game.room.playerDistricts[0] = [district('laboratory')];
    game.room.laboratoryAction = true;
    game.state.players[0].hand = [district('tavern')];
    game.room.playerHand[0] = 1;
    const beforeDeck = game.state.districtDeck.slice();
    game.slotEventHandlers['laboratory-action'](0, 0);
    assert.equal(game.room.playerHand[0], 0);
    const exhibit = district('manor'), museum = Object.assign(district('museum'), {exposition: [exhibit], decoration: 1});
    game.room.playerDistricts[1] = [museum];
    game.state.players[0].action = 'warlord-action';
    game.room.playerGold[0] = 99;
    game.slotEventHandlers['destroy'](0, 1, 0);
    assert.deepEqual(game.state.districtDiscard.map(card => card.type), ['tavern','manor','museum']);
    assert.equal(game.state.districtDiscard[1], exhibit);
    assert.equal(game.state.districtDiscard[2], museum);
    assert.ok(!museum.exposition && !museum.decoration);
    assert.deepEqual(game.state.districtDeck, beforeDeck);
    game.clearTurnTimer();
});
test('timer expiry discards pending choices without losing cards', async () => {
    const {game} = playingRoom();
    const pending = ['market','manor'].map(district);
    game.room.phase = 3;
    game.state.players[0].choose = pending.slice();
    game.state.players[0].chooseSource = 'districtDeck';
    game.state.players[0].action = 'scholar-response';
    game.room.timer = {kind: 'main', ownerSlot: 0, character: '8_1', endsAt: Date.now() - 1};
    game.restoreTurnTimer();
    await new Promise(resolve => setTimeout(resolve, 25));
    pending.forEach(card => assert.ok(game.state.districtDiscard.includes(card)));
    assert.ok(game.room.phase !== 3);
    game.clearTurnTimer();
});
test('snapshots preserve discard and old snapshots keep their original city threshold', () => {
    const {game} = playingRoom({rules: {citySize: 10}});
    game.state.districtDiscard = [district('library')];
    const snapshot = JSON.parse(JSON.stringify(game.getSnapshot()));
    const restored = createRoom().game;
    restored.setSnapshot(snapshot);
    assert.equal(restored.state.maxDistricts, 10);
    assert.deepEqual(restored.state.districtDiscard, [district('library')]);
    assert.equal(restored.room.districtDiscardCount, 1);
    const old = JSON.parse(JSON.stringify(snapshot)); delete old.state.districtDiscard;
    old.state.maxDistricts = 8; delete old.room.gameSetup.starting; delete old.room.gameSetup.rules;
    restored.setSnapshot(old);
    assert.equal(restored.state.maxDistricts, 8);
    assert.deepEqual(restored.state.districtDiscard, []);
    assert.equal(restored.room.districtDiscardCount, 0);
    game.clearTurnTimer(); restored.clearTurnTimer();
});
test('a two-district city gets completion bonuses and ends the game only at round end', () => {
    const {game} = playingRoom({rules: {citySize: 2}});
    game.room.playerDistricts[0] = [district('tavern')];
    game.state.players[0].hand = [district('market')];
    game.room.playerHand[0] = 1;
    game.room.playerGold[0] = 10;
    game.room.buildDistricts = 1;
    game.slotEventHandlers['build'](0, 0);
    assert.equal(game.room.ender, 0);
    assert.equal(game.room.phase, 2);
    assert.equal(game.room.playerScore[0], 1 + 2 + 4);
    game.state.players[1].action = 'warlord-action';
    game.slotEventHandlers['destroy'](1, 0, 0);
    assert.equal(game.room.playerDistricts[0].length, 2);
    game.room.tookResource = true;
    game.slotEventHandlers['end-turn'](0);
    assert.equal(game.room.phase, 0);
    assert.ok(game.room.winnerPlayers.includes(0));
    game.clearTurnTimer();
});

test("event dispatcher starts and saves an exact-special deal", () => {
    const {game} = createRoom(2);
    const starting = {handSize: 4, minUnique: 1, gold: 2, exactUnique: true};
    const uniques = setup.uniqueIds.filter(id => !["theater", "conspirators_house"].includes(id));
    game.userEvent("host", "start-game", [chars, uniques, null, timer, setup.getDefaultBasicCounts(), {starting}]);
    assert.equal(game.room.phase, 1);
    Object.values(game.state.players).forEach(player => {
        assert.equal(player.hand.length, 4);
        assert.equal(player.hand.filter(card => card.kind === 9).length, 1);
    });
    assert.equal(game.state.districtDeck.filter(card => card.kind === 9).length, uniques.length - 2);
    assert.deepEqual(game.getSnapshot().room.gameSetup.starting, setup.normalizeStarting(starting));
    game.clearTurnTimer();
});

test("an impossible exact-special request leaves server state unchanged", () => {
    const {game, messages} = createRoom(4);
    const before = JSON.stringify(game.getSnapshot());
    game.userEvent("host", "start-game", [chars, setup.uniqueIds, null, timer, {},
        {starting: {handSize: 4, minUnique: 1, exactUnique: true}, rules: {citySize: 2}}]);
    assert.equal(JSON.stringify(game.getSnapshot()), before);
    assert.equal(messages.at(-1).event, "setup-error");
    assert.match(messages.at(-1).data, /базовых/);
});

test("the randomly assigned first crown receives reduced resources even with gaps between player seats", () => {
    const {game} = createRoom(3);
    game.room.playerSlots = [null, "host", null, null, "player-1", null, "player-2", null];
    const starting = {handSize: 4, minUnique: 1, gold: 2, exactUnique: true, firstCrownReduction: {cards: 3, gold: 2}};
    const unique = setup.uniqueIds.filter(id => !["theater", "conspirators_house"].includes(id));
    game.userEvent("host", "start-game", [chars.concat("9_1"), unique, null, timer, setup.getDefaultBasicCounts(), {starting}]);
    assert.equal(game.room.phase, 1);
    assert.ok([1, 4, 6].includes(game.room.king));
    assert.equal(game.state.firstCrownSlot, game.room.king);
    for (const slot of [1, 4, 6]) {
        const isCrown = slot === game.state.firstCrownSlot;
        assert.equal(game.state.players[slot].hand.length, isCrown ? 1 : 4);
        assert.equal(game.room.playerHand[slot], isCrown ? 1 : 4);
        assert.equal(game.room.playerGold[slot], isCrown ? 0 : 2);
        assert.equal(game.state.players[slot].hand.filter(card => card.kind === 9).length, 1);
    }
    assert.equal(game.room.districtDeckCount, 54 + unique.length - 9);
    game.clearTurnTimer();
});

test("invalid crown resources or bonuses reject start without changing any room or game state", () => {
    for (const options of [
        {starting: {minUnique: 1, firstCrownReduction: {cards: 4}}},
        {starting: {minUnique: 1, exactUnique: true, firstCrownReduction: {cards: 4}}},
        {starting: {firstCrownReduction: {gold: 3}}},
        {rules: {bonuses: {allColors: -1}}},
        {rules: {preventRepeatedRandomDiscard: "true"}}
    ]) {
        const {game, messages} = createRoom();
        const before = JSON.stringify(game.getSnapshot());
        game.userEvent("host", "start-game", [chars, setup.uniqueIds, null, timer, setup.getDefaultBasicCounts(), options]);
        assert.equal(JSON.stringify(game.getSnapshot()), before);
        assert.equal(messages.at(-1).event, "setup-error");
    }
});

function finishTestRound(game) {
    game.room.phase = 2;
    game.room.currentPlayer = 0;
    game.room.currentCharacter = "8_1";
    game.state.currentIndCharacter = game.room.characterInGame.length;
    game.state.players[0].action = null;
    game.room.tookResource = true;
    game.slotEventHandlers["end-turn"](0);
}

test("completion bonuses are independent totals and zero turns each of them off", () => {
    for (const bonuses of [{firstCity: 9, otherCities: 5, allColors: 0}, {firstCity: 0, otherCities: 0, allColors: 0}]) {
        const {game} = playingRoom({rules: {citySize: 2, bonuses}});
        game.room.ender = 0;
        game.room.playerDistricts[0] = [district("tavern"), district("market")];
        game.room.playerDistricts[1] = [district("temple"), district("church")];
        Object.keys(game.state.players).forEach(slot => {
            game.state.players[slot].hand = [];
            game.room.playerHand[slot] = 0;
        });
        finishTestRound(game);
        assert.equal(game.room.phase, 0);
        assert.equal(game.room.playerScore[0], 3 + bonuses.firstCity);
        assert.equal(game.room.playerScore[1], 3 + bonuses.otherCities);
        game.clearTurnTimer();
    }
});

test("custom all-colors bonus participates in Haunted Quarter's best color choice", () => {
    for (const allColors of [0, 8]) {
        const {game} = playingRoom({rules: {citySize: 10, bonuses: {allColors}}});
        // Without a military district, Haunted Quarter can complete the colors.
        // Keeping it purple instead gives one extra Well of Wishes point.
        game.room.playerDistricts[0] = ["manor", "temple", "tavern", "haunted_quarter", "well_of_wishes"].map(district);
        const costs = game.room.playerDistricts[0].reduce((sum, card) => sum + card.cost, 0);
        Object.keys(game.state.players).forEach(slot => {
            game.state.players[slot].hand = [];
            game.room.playerHand[slot] = 0;
        });
        game.room.ender = 1;
        finishTestRound(game);
        assert.equal(game.room.playerScore[0], costs + Math.max(2, allColors + 1));
        game.clearTurnTimer();
    }
});

test("the first finisher keeps the entire bonus after sacrificing Arsenal through round end", () => {
    for (const firstCity of [0, 4, 9]) {
        const {game} = playingRoom({rules: {citySize: 2, bonuses: {firstCity, otherCities: 5, allColors: 0}}});
        game.room.ender = 0;
        game.room.playerDistricts[0] = [district("tavern"), district("arsenal")];
        game.room.playerDistricts[1] = [district("temple")];
        Object.keys(game.state.players).forEach(slot => {
            game.state.players[slot].hand = [];
            game.room.playerHand[slot] = 0;
        });
        game.slotEventHandlers["arsenal-destroy"](0, 1, 0);
        assert.equal(game.room.ender, 0);
        assert.equal(game.room.playerDistricts[0].length, 1);
        assert.equal(game.room.playerScore[0], 1 + firstCity);
        assert.deepEqual(game.state.districtDiscard.map(card => card.type), ["temple", "arsenal"]);
        finishTestRound(game);
        assert.equal(game.room.phase, 0);
        assert.equal(game.room.playerScore[0], 1 + firstCity);
        game.clearTurnTimer();
    }
});

test("another finisher loses the completion bonus if Arsenal leaves their city incomplete", () => {
    const {game} = playingRoom({rules: {citySize: 2, bonuses: {firstCity: 9, otherCities: 5, allColors: 0}}});
    game.room.ender = 0;
    game.room.currentPlayer = 1;
    game.room.playerDistricts[0] = [district("manor"), district("market")];
    game.room.playerDistricts[1] = [district("tavern"), district("arsenal")];
    game.room.playerDistricts[2] = [district("temple")];
    game.state.players[1].action = null;
    game.slotEventHandlers["arsenal-destroy"](1, 2, 0);
    assert.equal(game.room.playerDistricts[1].length, 1);
    assert.equal(game.room.playerScore[1], 1);
    game.clearTurnTimer();
});

test("snapshots without any setup fields preserve the active game and do not invent its original setup", () => {
    for (const phase of [1, 2]) {
        const {game} = createRoom(3);
        game.userEvent("host", "start-game", [chars.concat("9_1"), ["library", "museum"], null, timer]);
        const saved = JSON.parse(JSON.stringify(game.getSnapshot()));
        saved.room.phase = phase;
        for (const key of ["gameSetup", "setupDraft", "setupDraftAutomatic", "setupDraftInvalid", "setupDraftPreserveCharacters", "citySize", "districtDeckCount", "districtDiscardCount"])
            delete saved.room[key];
        for (const key of ["gameRules", "randomDiscards", "previousRandomDiscards", "districtDiscard", "firstCrownSlot"])
            delete saved.state[key];
        // Load onto a state that previously held a different setup as well.
        const restored = playingRoom({starting: {gold: 19}, rules: {citySize: 10}}).game;
        restored.setSnapshot(saved);
        assert.equal(restored.room.phase, phase);
        assert.equal(restored.room.gameSetup, undefined);
        assert.equal(restored.room.citySize, 8);
        assert.equal(restored.state.maxDistricts, 8);
        assert.deepEqual(restored.state.players, saved.state.players);
        assert.deepEqual(restored.state.districtDeck, saved.state.districtDeck);
        assert.deepEqual(restored.state.districtDiscard, []);
        assert.deepEqual(restored.state.gameRules, setup.normalizeRules());
        assert.equal(restored.room.setupDraft, undefined);
        restored.userEventHandlers["toggle-lock"]("host");
        assert.equal(restored.room.gameSetup, undefined);
        assert.equal(restored.room.districtDeckCount, saved.state.districtDeck.length);
        game.clearTurnTimer(); restored.clearTurnTimer();
    }
});

for (const players of [2, 3, 4, 5, 6, 7, 8]) {
    test("consecutive random discards do not overlap for " + players + " players", () => {
        const {game} = createRoom(players);
        const roles = [3, 4, 8].includes(players) ? chars.concat("9_1") : chars;
        const counts = setup.getDefaultBasicCounts();
        if (players === 8) counts.manor += 2;
        game.userEvent("host", "start-game", [roles, [], null, timer, counts,
            {rules: {preventRepeatedRandomDiscard: true}}]);
        assert.equal(game.room.phase, 1);
        for (let round = 0; round < 8; round++) {
            while (game.room.phase === 1) {
                const slot = game.room.currentPlayer;
                const action = game.state.players[slot].action;
                game.slotEventHandlers[action === "discard" ? "discard-character" : "take-character"](slot, 0);
            }
            assert.ok(!game.state.randomDiscards.some(id => game.state.previousRandomDiscards.includes(id)));
            assert.equal(new Set(game.state.randomDiscards).size, game.state.randomDiscards.length);
            if (players === 3) assert.equal(game.state.randomDiscards.length, 2);
            if (players === 2) assert.equal(game.state.randomDiscards.length, 1);
            const previous = game.state.randomDiscards.slice();
            finishTestRound(game);
            assert.equal(game.room.phase, 1);
            assert.deepEqual(game.state.previousRandomDiscards, previous);
            assert.ok(!game.state.randomDiscards.some(id => previous.includes(id)));
        }
        assert.ok(!("randomDiscards" in game.room));
        assert.ok(!("previousRandomDiscards" in game.room));
        game.clearTurnTimer();
    });
}

test("manual duel discard can repeat a character randomly discarded in the previous round", () => {
    const {game} = createRoom(2);
    game.userEvent("host", "start-game", [chars, [], null, timer, setup.getDefaultBasicCounts(),
        {rules: {preventRepeatedRandomDiscard: true}}]);
    const excluded = game.state.randomDiscards[0];
    finishTestRound(game);
    while (game.state.players[game.room.currentPlayer].action !== "discard") {
        const index = game.state.characterDeck.findIndex(id => id !== excluded);
        game.slotEventHandlers["take-character"](game.room.currentPlayer, index);
    }
    assert.ok(game.state.characterDeck.includes(excluded));
    const randomBefore = game.state.randomDiscards.slice();
    game.slotEventHandlers["discard-character"](game.room.currentPlayer, game.state.characterDeck.indexOf(excluded));
    assert.ok(!game.state.characterDeck.includes(excluded));
    assert.deepEqual(game.state.randomDiscards, randomBefore);
    game.clearTurnTimer();
});

test("random discard history and custom rules restore privately and reset for a new game", () => {
    const {game} = createRoom(4);
    const rules = {bonuses: {firstCity: 8, otherCities: 1, allColors: 6}, preventRepeatedRandomDiscard: true};
    game.userEvent("host", "start-game", [chars, [], null, timer, setup.getDefaultBasicCounts(), {rules}]);
    finishTestRound(game);
    const saved = JSON.parse(JSON.stringify(game.getSnapshot()));
    const restored = createRoom().game;
    restored.setSnapshot(saved);
    assert.deepEqual(restored.state.randomDiscards, saved.state.randomDiscards);
    assert.deepEqual(restored.state.previousRandomDiscards, saved.state.previousRandomDiscards);
    assert.deepEqual(restored.state.gameRules, setup.normalizeRules(rules));
    assert.equal(restored.room.gameSetup.rules.preventRepeatedRandomDiscard, true);
    restored.userEventHandlers["abort-game"]("host");
    restored.userEvent("host", "start-game", [chars, [], null, timer, setup.getDefaultBasicCounts()]);
    assert.deepEqual(restored.state.previousRandomDiscards, []);
    assert.equal(restored.state.gameRules.preventRepeatedRandomDiscard, false);
    delete saved.state.gameRules; delete saved.state.randomDiscards; delete saved.state.previousRandomDiscards;
    delete saved.room.gameSetup.rules;
    restored.setSnapshot(saved);
    assert.deepEqual(restored.state.gameRules.bonuses, {firstCity: 4, otherCities: 2, allColors: 3});
    assert.deepEqual(restored.state.randomDiscards, []);
    assert.deepEqual(restored.state.previousRandomDiscards, []);
    game.clearTurnTimer(); restored.clearTurnTimer();
});

test("form drafts are ignored by the server without storing or broadcasting them", () => {
    const {game, messages} = createRoom();
    const value = setup.getDefaultSetup(4);
    for (const user of ["host", "player-1", "spectator"]) {
        const before = JSON.stringify(game.getSnapshot());
        game.userEvent(user, "update-setup", [value, true]);
        assert.equal(JSON.stringify(game.getSnapshot()), before);
    }
    assert.equal(messages.length, 0);
    assert.equal(game.room.setupDraft, undefined);
});

test("setup is sent only to joining users and once to all participants at each game start", () => {
    const {game, messages} = createRoom();
    const join = userId => game.userJoin({userId, userName: userId});
    join("host"); join("player-1"); join("spectator");
    assert.deepEqual(messages.filter(message => message.event === "game-setup").map(message => [message.target, message.data]),
        [["host", null], ["player-1", null], ["spectator", null]]);
    const value = setup.getDefaultSetup(4);
    value.rules.bonuses.allColors = 6;
    messages.length = 0;
    game.userEvent("host", "start-game", [chars, [], null, timer, value.districts.basic, {starting: value.starting, rules: value.rules}]);
    const broadcast = messages.filter(message => message.event === "game-setup");
    assert.equal(broadcast.length, 1);
    assert.ok(broadcast[0].target.has("host"));
    assert.ok(broadcast[0].target.has("player-1"));
    assert.ok(broadcast[0].target.has("spectator"));
    assert.equal(broadcast[0].data.rules.bonuses.allColors, 6);
    assert.ok(!("players" in broadcast[0].data));
    assert.ok(messages.some(message => message.event === "state"));
    assert.ok(messages.filter(message => message.event === "state").every(message =>
        !("gameSetup" in message.data) && !("setupDraft" in message.data)));

    messages.length = 0;
    game.userEvent("host", "toggle-lock", []);
    assert.equal(messages.filter(message => message.event === "game-setup").length, 0);
    game.userLeft("player-1");
    messages.length = 0;
    join("player-1"); join("late-spectator");
    const reconnects = messages.filter(message => message.event === "game-setup");
    assert.deepEqual(reconnects.map(message => message.target), ["player-1", "late-spectator"]);
    reconnects.forEach(message => assert.deepEqual(message.data, game.room.gameSetup));

    game.userEvent("host", "abort-game", []);
    value.rules.bonuses.allColors = 9;
    messages.length = 0;
    game.userEvent("host", "start-game", [chars, [], null, timer, value.districts.basic, {starting: value.starting, rules: value.rules}]);
    assert.equal(messages.filter(message => message.event === "game-setup").length, 1);
    assert.equal(messages.find(message => message.event === "game-setup").data.rules.bonuses.allColors, 9);
    game.clearTurnTimer();
});

test("restoring a snapshot drops obsolete form drafts but preserves the last game setup", () => {
    const {game} = playingRoom({starting: {gold: 7}, rules: {citySize: 10}});
    game.userEventHandlers["abort-game"]("host");
    const snapshot = JSON.parse(JSON.stringify(game.getSnapshot()));
    snapshot.room.setupDraft = {malformed: true};
    snapshot.room.setupDraftAutomatic = false;
    snapshot.room.setupDraftInvalid = true;
    snapshot.room.setupDraftPreserveCharacters = true;
    const {game: restored, messages} = createRoom();
    restored.setSnapshot(snapshot);
    for (const field of ["setupDraft", "setupDraftAutomatic", "setupDraftInvalid", "setupDraftPreserveCharacters"])
        assert.ok(!(field in restored.getSnapshot().room));
    restored.userJoin({userId: "host", userName: "Host"});
    const message = messages.find(message => message.event === "game-setup");
    assert.equal(message.data.starting.gold, 7);
    assert.equal(message.data.rules.citySize, 10);
    assert.ok(messages.filter(message => message.event === "state").every(message => !("gameSetup" in message.data)));
    game.clearTurnTimer(); restored.clearTurnTimer();
});
