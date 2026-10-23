"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const setup = require("../public/setup");
const {createRoom, playingRoom, district, chars, timer} = require("../test-support/game.cjs");

function actingRoom(action, rules = {}) {
    const result = playingRoom({rules});
    const {game} = result;
    game.state.characterRoles = {};
    for (const slot of [0, 1, 2, 3]) {
        game.state.players[slot].hand = [];
        game.state.players[slot].action = null;
        game.room.playerHand[slot] = 0;
        game.room.playerGold[slot] = 20;
        game.room.playerDistricts[slot] = [];
    }
    game.state.players[0].action = action;
    game.room.ender = null;
    result.messages.length = 0;
    return result;
}
const snapshot = game => JSON.stringify(game.getSnapshot());

test("Marshal can acquire the second copy at X=1 but cannot increase the city to three copies", () => {
    const {game} = actingRoom("marshal-action", {duplicateLimit: 1});
    const received = district("tavern");
    game.room.playerDistricts[0] = [district("tavern")];
    game.room.playerDistricts[1] = [received, district("tavern")];
    game.userEvent("host", "seize-district", [1, 0]);
    assert.equal(game.room.playerDistricts[0].length, 2);
    assert.equal(game.room.playerDistricts[0][1], received);
    assert.equal(game.room.playerGold[0], 19);
    game.state.players[0].action = "marshal-action";
    const before = snapshot(game);
    game.userEvent("host", "seize-district", [1, 0]);
    assert.equal(snapshot(game), before);
    game.clearTurnTimer();
});
test("Diplomat applies X to both receiving cities after removing the outgoing cards", () => {
    const {game} = actingRoom("diplomat-action", {duplicateLimit: 1});
    game.room.playerDistricts[0] = [district("manor"), district("tavern")];
    game.room.playerDistricts[1] = [district("tavern"), district("manor")];
    game.userEvent("host", "exchange-districts", [0, 1, 0]);
    assert.deepEqual(game.room.playerDistricts[0].map(card => card.type), ["tavern", "tavern"]);
    assert.deepEqual(game.room.playerDistricts[1].map(card => card.type), ["manor", "manor"]);
    for (const [mine, theirs] of [
        [["manor", "tavern", "tavern"], ["tavern", "castle"]],
        [["manor", "castle"], ["tavern", "manor", "manor"]]
    ]) {
        game.state.players[0].action = "diplomat-action";
        game.room.playerDistricts[0] = mine.map(district);
        game.room.playerDistricts[1] = theirs.map(district);
        const before = snapshot(game);
        game.userEvent("host", "exchange-districts", [0, 1, 0]);
        assert.equal(snapshot(game), before);
    }
    game.state.gameRules.duplicateLimit = 0;
    game.state.players[0].action = "diplomat-action";
    const replacement = {...district("tavern"), decoration: 1};
    game.room.playerDistricts[0] = [district("tavern"), district("tavern")];
    game.room.playerDistricts[1] = [replacement];
    game.userEvent("host", "exchange-districts", [0, 1, 0]);
    assert.equal(game.room.playerDistricts[0][0], replacement);
    game.clearTurnTimer();
});
test("Diplomat's completed-city flag removes only the opponent's completed-city protection", () => {
    const {game} = actingRoom("diplomat-action", {citySize: 2});
    const enemy = district("market");
    game.room.playerDistricts[0] = [district("manor")];
    game.room.playerDistricts[1] = [enemy, district("tavern")];
    const before = snapshot(game);
    game.userEvent("host", "exchange-districts", [0, 1, 0]);
    assert.equal(snapshot(game), before);
    game.state.gameRules.diplomatCompleteCity = true;
    game.userEvent("host", "exchange-districts", [0, 1, 0]);
    assert.equal(game.room.playerDistricts[0][0], enemy);
    for (const protection of ["bishop", "keep"]) {
        game.state.players[0].action = "diplomat-action";
        game.room.playerDistricts[0] = [district("manor")];
        game.room.playerDistricts[1] = [district(protection === "keep" ? "keep" : "market"), district("tavern")];
        game.state.characterRoles = protection === "bishop" ? {"5_1": 1} : {};
        const protectedState = snapshot(game);
        game.userEvent("host", "exchange-districts", [0, 1, 0]);
        assert.equal(snapshot(game), protectedState);
    }
    game.clearTurnTimer();
});
test("rank-eight costs include every Great Wall, including a targeted Wall itself", () => {
    for (const [action, event, target, expectedGold, args] of [
        ["warlord-action", "destroy", "great_wall", 13, [1, 0]],
        ["diplomat-action", "exchange-districts", "great_wall", 15, [0, 1, 0]],
        ["marshal-action", "seize-district", "tavern", 17, [1, 0]]
    ]) {
        const {game} = actingRoom(action);
        game.room.playerDistricts[0] = [district("manor")];
        game.room.playerDistricts[1] = [district(target), district("great_wall")];
        if (target !== "great_wall") game.room.playerDistricts[1].push(district("great_wall"));
        game.userEvent("host", event, args);
        assert.equal(game.room.playerGold[0], expectedGold, event);
        assert.equal(game.state.players[0].action, null, event);
        game.clearTurnTimer();
    }
});
test("rank-eight district actions reject stale actors, invalid targets and self-acquisition atomically", () => {
    for (const [action, event, args] of [
        ["warlord-action", "destroy", [2, 0]],
        ["diplomat-action", "exchange-districts", [0, 2, 0]],
        ["marshal-action", "seize-district", [2, 0]]
    ]) {
        const {game} = actingRoom(null, {duplicateLimit: 1});
        game.state.players[1].action = action;
        game.room.playerDistricts[1] = [district("manor")];
        game.room.playerDistricts[2] = [district("tavern")];
        let before = snapshot(game);
        game.userEvent("player-1", event, args);
        assert.equal(snapshot(game), before, event + " stale actor");
        game.state.players[0].action = action;
        game.room.playerDistricts[0] = [district("market")];
        for (const target of [undefined, null, "2", -1, 99]) {
            before = snapshot(game);
            assert.doesNotThrow(() => game.userEvent("host", event,
                event === "exchange-districts" ? [0, target, 0] : [target, 0]));
            assert.equal(snapshot(game), before, event + " invalid target");
        }
        if (event !== "destroy") {
            before = snapshot(game);
            game.userEvent("host", event, event === "exchange-districts" ? [0, 0, 0] : [0, 0]);
            assert.equal(snapshot(game), before, event + " self-acquisition");
        }
        game.clearTurnTimer();
    }
});
test("Marshal and Diplomat reset transferred Wine Cellars while preserving other instance state", () => {
    const {game} = actingRoom("marshal-action");
    const cellar = {...district("wine_cellar"), wineAge: 5, buildDiscount: 1, actionsUsed: {workshop: 3}};
    const chamber = {...district("judicial_chamber"), judicialUsed: true, actionsUsed: {judicial: 2}};
    game.room.playerDistricts[1] = [cellar, chamber];
    game.userEvent("host", "seize-district", [1, 0]);
    assert.equal(cellar.wineAge, 0);
    assert.equal(cellar.buildDiscount, 1);
    assert.deepEqual(cellar.actionsUsed, {workshop: 3});
    game.state.players[0].action = "marshal-action";
    game.userEvent("host", "seize-district", [1, 0]);
    assert.equal(game.room.playerDistricts[0][1], chamber);
    assert.equal(chamber.judicialUsed, true);
    assert.deepEqual(chamber.actionsUsed, {judicial: 2});
    const second = {...district("wine_cellar"), wineAge: 4};
    cellar.wineAge = 5;
    game.room.playerDistricts[0] = [cellar];
    game.room.playerDistricts[1] = [second];
    game.state.players[0].action = "diplomat-action";
    game.userEvent("host", "exchange-districts", [0, 1, 0]);
    assert.equal(game.room.playerDistricts[0][0], second);
    assert.equal(game.room.playerDistricts[1][0], cellar);
    assert.equal(cellar.wineAge, 0);
    assert.equal(second.wineAge, 0);
    assert.deepEqual(cellar.actionsUsed, {workshop: 3});
    game.clearTurnTimer();
});
test("exchanging a Monument announces whichever city newly completes and preserves the first finisher", () => {
    for (const [mine, theirs, previousEnder, expectedEnder] of [
        [["tavern", "market"], ["monument"], null, 0],
        [["monument"], ["tavern", "market"], null, 1],
        [["tavern", "market"], ["monument", "castle"], 1, 1]
    ]) {
        const {game, messages} = actingRoom("diplomat-action", {citySize: 3, diplomatCompleteCity: true});
        game.room.playerDistricts[0] = mine.map(district);
        game.room.playerDistricts[1] = theirs.map(district);
        game.room.ender = previousEnder;
        game.userEvent("host", "exchange-districts", [0, 1, 0]);
        assert.equal(game.room.ender, expectedEnder);
        assert.ok(messages.some(message => message.event === "state" && message.data.sound === "city-complete"));
        assert.equal(game.room.phase, 2);
        game.clearTurnTimer();
    }
});
function pendingMagistrate(rules = {}, building = district("tavern")) {
    const result = actingRoom("magistrate-open", rules);
    const {game} = result;
    game.room.currentCharacter = "8_1";
    game.state.characterRoles = {"1_3": 0, "8_1": 1};
    game.room.targetSlot = 1;
    game.room.magistrated = ["8_1", "7_1"];
    game.state.trueMagistrated = "8_1";
    game.state.magistrateAction = {cost: 1, action: "warlord-action"};
    game.state.alchemistCoins = 1;
    game.room.playerDistricts[1] = [building];
    return result;
}

test("Magistrate obeys X unless the explicit over-limit flag is enabled", () => {
    for (const [rules, existing, allowed] of [
        [{duplicateLimit: 0}, 1, false],
        [{duplicateLimit: 1}, 1, true],
        [{duplicateLimit: 1}, 2, false],
        [{duplicateLimit: 0, magistrateOverLimit: true}, 2, true]
    ]) {
        const target = district("tavern");
        const {game} = pendingMagistrate(rules, target);
        game.room.playerDistricts[0] = Array.from({length: existing}, () => district("tavern"));
        const before = snapshot(game);
        game.userEvent("host", "magistrate-open", ["yes"]);
        if (allowed) {
            assert.equal(game.room.playerDistricts[0].at(-1), target);
            assert.equal(game.room.playerDistricts[0].length, existing + 1);
            assert.equal(game.room.playerGold[1], 21);
            assert.equal(game.room.currentPlayer, 1);
        } else assert.equal(snapshot(game), before);
        game.clearTurnTimer();
    }
});
test("only the pending Magistrate can answer for the original builder", () => {
    for (const scenario of ["stale actor", "self target", "missing pending", "missing builder", "wrong target", "wrong Magistrate"]) {
        const {game} = pendingMagistrate();
        let actor = "host";
        if (scenario === "stale actor") {
            actor = "player-2";
            game.state.players[2].action = "magistrate-open";
        }
        if (scenario === "self target") {
            game.state.characterRoles["8_1"] = 0;
            game.room.targetSlot = 0;
        }
        if (scenario === "missing pending") game.state.magistrateAction = null;
        if (scenario === "missing builder") game.room.targetSlot = 7;
        if (scenario === "wrong target") game.room.targetSlot = 2;
        if (scenario === "wrong Magistrate") game.state.characterRoles["1_3"] = 2;
        const before = snapshot(game);
        assert.doesNotThrow(() => game.userEvent(actor, "magistrate-open", ["yes"]), scenario);
        assert.equal(snapshot(game), before, scenario);
        game.clearTurnTimer();
    }
});
test("Magistrate confiscates from the actual Witch builder rather than the bewitched character's owner", () => {
    const target = district("tavern");
    const {game} = pendingMagistrate({}, target);
    game.state.characterRoles["8_1"] = 2;
    game.state.characterRoles["1_2"] = 1;
    game.room.witched = "8_1";
    game.room.witchedstate = 2;
    game.room.playerDistricts[2] = [district("market")];
    game.userEvent("host", "magistrate-open", ["yes"]);
    assert.equal(game.room.playerDistricts[0][0], target);
    assert.equal(game.room.playerDistricts[1].length, 0);
    assert.equal(game.room.playerDistricts[2][0].type, "market");
    assert.equal(game.room.currentPlayer, 1);
    assert.equal(game.room.playerGold[1], 21);
    game.clearTurnTimer();
});
test("confiscation keeps the first completed city even when its last district moves away", () => {
    const {game, messages} = pendingMagistrate({citySize: 2});
    game.room.playerDistricts[0] = [district("market")];
    game.room.playerDistricts[1].unshift(district("temple"));
    game.room.ender = 1;
    game.userEvent("host", "magistrate-open", ["yes"]);
    assert.equal(game.room.ender, 1);
    assert.equal(game.room.playerDistricts[1].length, 1);
    assert.equal(game.room.playerDistricts[0].length, 2);
    assert.equal(game.room.playerScore[1], 5);
    assert.equal(game.room.playerScore[0], 5);
    assert.ok(messages.some(message => message.event === "state" && message.data.sound === "city-complete"));
    assert.equal(game.room.phase, 2);
    game.clearTurnTimer();
});
test("confiscation resets inherited cellar age, keeps one-use state and can finish the receiving city", () => {
    const cellar = {...district("wine_cellar"), wineAge: 5, buildDiscount: 2, actionsUsed: {workshop: 2}};
    const {game, messages} = pendingMagistrate({citySize: 2}, cellar);
    game.room.playerDistricts[0] = [district("market")];
    game.userEvent("host", "magistrate-open", ["yes"]);
    assert.equal(game.room.playerDistricts[0][1], cellar);
    assert.equal(cellar.wineAge, 0);
    assert.equal(cellar.buildDiscount, 2);
    assert.deepEqual(cellar.actionsUsed, {workshop: 2});
    assert.equal(game.room.ender, 0);
    assert.ok(messages.some(message => message.event === "state" && message.data.sound === "city-complete"));
    game.clearTurnTimer();
    const chamber = {...district("judicial_chamber"), judicialUsed: true, actionsUsed: {judicial: 2}};
    const second = pendingMagistrate({}, chamber).game;
    second.userEvent("host", "magistrate-open", ["yes"]);
    assert.equal(second.room.playerDistricts[0][0], chamber);
    assert.equal(chamber.judicialUsed, true);
    assert.deepEqual(chamber.actionsUsed, {judicial: 2});
    second.clearTurnTimer();
});
test("start accepts a disabled local creator mode but rejects enabled or malformed modes without changing the room", () => {
    for (const creatorMode of [true, "true", 0, null, undefined]) {
        const {game, messages} = createRoom();
        const before = snapshot(game);
        game.userEvent("host", "start-game", [chars, [], null, timer, setup.getDefaultBasicCounts(), {creatorMode}]);
        assert.equal(snapshot(game), before);
        assert.equal(messages.at(-1).event, "setup-error");
        if (creatorMode === true) assert.match(messages.at(-1).data, /режим творца/i);
        game.clearTurnTimer();
    }
    const {game} = createRoom();
    game.userEvent("host", "start-game", [chars, [], null, timer, setup.getDefaultBasicCounts(),
        {creatorMode: false, rules: {duplicateLimit: 2, diplomatCompleteCity: true, magistrateOverLimit: true}}]);
    assert.equal(game.room.phase, 1);
    assert.equal(game.state.gameRules.duplicateLimit, 2);
    assert.equal(game.state.gameRules.diplomatCompleteCity, true);
    assert.equal(game.state.gameRules.magistrateOverLimit, true);
    assert.equal(JSON.stringify(game.room.gameSetup).includes("creatorMode"), false);
    game.clearTurnTimer();
});
test("Magistrate response timeout declines a blocked confiscation and returns control to the builder", async () => {
    const target = {...district("wine_cellar"), wineAge: 5};
    const {game} = pendingMagistrate({}, target);
    game.room.playerDistricts[0] = [district("wine_cellar")];
    game.userEvent("host", "magistrate-open", ["yes"]);
    assert.equal(game.room.currentPlayer, 0);
    assert.equal(game.state.players[0].action, "magistrate-open");
    game.room.timer = {kind: "response", ownerSlot: 0, character: "8_1", responseType: "magistrate-open", endsAt: Date.now() - 1};
    game.restoreTurnTimer();
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(game.room.currentPlayer, 1);
    assert.equal(game.state.players[1].action, "warlord-action");
    assert.equal(game.room.playerDistricts[1][0], target);
    assert.equal(target.wineAge, 5);
    assert.equal(game.room.playerGold[1], 20);
    assert.equal(game.room.targetSlot, null);
    assert.equal(game.room.timer, null);
    game.clearTurnTimer();
});