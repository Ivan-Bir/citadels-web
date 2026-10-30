"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const setup = require("../public/setup");
const {createRoom, playingRoom, district, chars, timer} = require("../test-support/game.cjs");

function event(game, slot, name, ...args) {
    game.userEvent(game.room.playerSlots[slot], name, args);
}

function finishDraft(game) {
    let selections = 0;
    while (game.room.phase === 1) {
        assert.ok(selections++ < 12, "draft must reach a playable character");
        event(game, game.room.currentPlayer, "take-character", 0);
    }
}

test("a new game starts round one and each playable character begins a separate turn", t => {
    const {game} = createRoom();
    t.after(() => game.clearTurnTimer());
    game.userEvent("host", "start-game", [chars, [], null, timer]);
    assert.equal(game.room.roundNumber, 1);
    assert.equal(game.room.turnId, 0);
    assert.equal(game.room.buildingBan, false);
    assert.equal(game.room.nextRoundBuildingBan, false);
    for (const slot of Object.keys(game.state.players)) game.room.playerDistricts[slot] = [district("manor")];
    finishDraft(game);
    assert.equal(game.room.turnId, 1);
    assert.equal(game.state.turnStartCitySize, 1);
    const slot = game.room.currentPlayer;
    event(game, slot, "take-resources", "coins");
    event(game, slot, "end-turn");
    assert.equal(game.room.turnId, 2);
});

test("final scoring counts every Secret Vault in hand without creating a built district", t => {
    const {game} = playingRoom();
    t.after(() => game.clearTurnTimer());
    for (const slot of Object.keys(game.state.players)) {
        game.state.players[slot].hand = [];
        game.room.playerHand[slot] = 0;
    }
    game.state.players[0].hand = [district("secret_vault"), district("secret_vault")];
    game.room.playerHand[0] = 2;
    game.room.playerDistricts[0] = [district("temple")];
    game.userEvent("host", "abort-game", []);
    assert.equal(game.room.playerScore[0], 7);
    assert.deepEqual(game.room.playerDistricts[0], [district("temple")]);
    assert.equal(game.state.players[0].hand.length, 2);
});

test("Wineries age once when a round ends, even when the Emperor delays its completion", t => {
    const {game} = playingRoom();
    t.after(() => game.clearTurnTimer());
    game.room.roundNumber = 6;
    game.state.lastAgedRound = 5;
    game.room.characterInGame[3] = "4_2";
    game.room.assassined = "4_2";
    game.state.characterRoles["4_2"] = 1;
    game.state.players[1].character = ["4_2"];
    game.state.emperorAction = false;
    game.room.king = 0;
    const mature = {...district("winery"), wineAge: 4};
    const young = district("winery");
    game.room.playerDistricts[0] = [mature, young];
    event(game, 0, "take-resources", "coins");
    event(game, 0, "end-turn");
    assert.equal(game.state.players[1].action, "emperor-nores-action");
    assert.equal(mature.wineAge, 5);
    assert.equal(young.wineAge, 1);
    event(game, 1, "emperor-crown", 2, "coin");
    assert.equal(game.room.roundNumber, 7);
    assert.equal(mature.wineAge, 5);
    assert.equal(young.wineAge, 1);
});

test("the next round applies the latest distinct conspiracy targets within its discard capacity and keeps them hidden", t => {
    const {game} = playingRoom();
    t.after(() => game.clearTurnTimer());
    game.state.pendingConspiracies = [
        {ownerSlot: 0, sourceId: "a", characterId: "1_1"},
        {ownerSlot: 1, sourceId: "b", characterId: "2_1"},
        {ownerSlot: 0, sourceId: "c", characterId: "1_1"},
        {ownerSlot: 2, sourceId: "d", characterId: "3_1"},
        {ownerSlot: 3, sourceId: "e", characterId: "4_1"}
    ];
    event(game, 0, "take-resources", "coins");
    event(game, 0, "end-turn");
    assert.equal(game.room.phase, 1);
    assert.deepEqual(game.state.characterDeck, ["2_1", "5_1", "6_1", "7_1", "8_1"]);
    assert.deepEqual(game.room.characterFace, []);
    assert.deepEqual(game.state.randomDiscards, []);
    assert.deepEqual(game.state.pendingConspiracies, []);
    assert.deepEqual(game.room.conspiratorEffects, []);
    assert.ok(Object.values(game.state.players).every(player => player.conspiratorTargets.length === 0));
    finishDraft(game);
    assert.equal(Object.keys(game.state.characterRoles).length, 4);
});

test("eight players still draft one character each when a forced discard cannot return to the last chooser", t => {
    const {game} = createRoom(8);
    t.after(() => game.clearTurnTimer());
    const nineCharacters = chars.concat("9_1");
    game.userEvent("host", "start-game", [nineCharacters, ["library", "museum"], null, timer]);
    game.room.phase = 2;
    game.room.currentPlayer = 0;
    game.room.currentCharacter = "9_1";
    game.state.currentIndCharacter = 9;
    game.state.players[0].action = null;
    game.room.tookResource = true;
    game.state.pendingConspiracies = [{ownerSlot: 0, sourceId: "removed-source", characterId: "3_1"}];
    game.state.randomDiscards = ["3_1"];
    game.state.gameRules.preventRepeatedRandomDiscard = true;
    event(game, 0, "end-turn");
    for (let index = 0; index < 7; index++) event(game, game.room.currentPlayer, "take-character", 0);
    assert.equal(game.room.phase, 1);
    assert.equal(game.state.players[game.room.currentPlayer].choose.length, 1);
    assert.ok(!game.state.players[game.room.currentPlayer].choose.includes("3_1"));
    event(game, game.room.currentPlayer, "take-character", 0);
    assert.equal(game.room.phase, 2);
    assert.ok(Object.values(game.state.players).every(player => player.character.length === 1));
    assert.equal(game.state.characterRoles["3_1"], undefined);
});

test("every Theater acts in draft order with all of one owner's exchanges consecutive", t => {
    const {game} = playingRoom();
    t.after(() => game.clearTurnTimer());
    game.room.king = 2;
    game.room.playerDistricts[2] = [district("theater"), district("manor"), district("theater")];
    game.room.playerDistricts[0] = [district("theater")];
    event(game, 0, "take-resources", "coins");
    event(game, 0, "end-turn");
    finishDraft(game);
    assert.equal(game.room.phase, 1.5);
    assert.equal(game.room.currentPlayer, 2);
    assert.deepEqual(game.room.theaterAction, {sourceIndex: 0, position: 1, total: 3});
    const before = Object.fromEntries(Object.entries(game.state.players).map(([slot, player]) => [slot, player.character.slice()]));
    event(game, 2, "theater-action", 3);
    assert.equal(game.room.phase, 1.5);
    assert.equal(game.room.currentPlayer, 2);
    assert.deepEqual(game.room.theaterAction, {sourceIndex: 2, position: 2, total: 3});
    assert.deepEqual(game.state.players[2].character, before[3]);
    event(game, 2, "theater-action", 3);
    assert.equal(game.room.currentPlayer, 0);
    assert.deepEqual(game.room.theaterAction, {sourceIndex: 0, position: 3, total: 3});
    assert.deepEqual(game.state.players[2].character, before[2]);
    event(game, 0, "theater-action", 0);
    assert.equal(game.room.phase, 2);
    assert.equal(game.room.theaterAction, null);
    for (const [slot, player] of Object.entries(game.state.players)) {
        assert.deepEqual(player.character, before[slot]);
        assert.equal(game.state.characterRoles[player.character[0]], Number(slot));
    }
});

test("legacy snapshots receive round, turn and independent-effect defaults before play resumes", t => {
    const {game} = playingRoom();
    t.after(() => game.clearTurnTimer());
    game.room.playerDistricts[0] = [district("monument"), district("catacombs")];
    const snapshot = JSON.parse(JSON.stringify(game.getSnapshot()));
    for (const key of ["roundNumber", "turnId", "buildingBan", "nextRoundBuildingBan", "theaterAction"]) delete snapshot.room[key];
    for (const key of ["lastAgedRound", "pendingConspiracies", "buildingBanRound", "draftOrder", "theaterQueue", "theaterCursor", "turnStartCitySize", "nextDistrictId"]) delete snapshot.state[key];
    const restored = createRoom().game;
    t.after(() => restored.clearTurnTimer());
    restored.setSnapshot(snapshot);
    assert.equal(restored.room.roundNumber, 1);
    assert.equal(restored.room.turnId, 0);
    assert.equal(restored.room.buildingBan, false);
    assert.equal(restored.room.nextRoundBuildingBan, false);
    assert.equal(restored.state.turnStartCitySize, 2);
    assert.deepEqual(restored.state.pendingConspiracies, []);
    assert.deepEqual(restored.state.theaterQueue, []);
    event(restored, 0, "take-resources", "coins");
    event(restored, 0, "end-turn");
    assert.equal(restored.room.roundNumber, 2);
});

test("a legacy snapshot with one pending Theater exchange can finish that exchange", t => {
    const {game} = playingRoom();
    t.after(() => game.clearTurnTimer());
    game.room.phase = 1.5;
    game.room.currentPlayer = 2;
    game.room.currentCharacter = "0";
    game.state.currentIndCharacter = 0;
    game.state.players[2].action = "theater-action";
    game.state.players[2].character = ["6_1"];
    game.state.characterRoles = {"6_1": 2};
    game.room.playerDistricts[2] = [district("theater")];
    const snapshot = JSON.parse(JSON.stringify(game.getSnapshot()));
    delete snapshot.state.theaterQueue;
    delete snapshot.state.theaterCursor;
    delete snapshot.room.theaterAction;
    const restored = createRoom().game;
    t.after(() => restored.clearTurnTimer());
    restored.setSnapshot(snapshot);
    assert.deepEqual(restored.room.theaterAction, {sourceIndex: 0, position: 1, total: 1});
    event(restored, 2, "theater-action", 2);
    assert.equal(restored.room.phase, 2);
    assert.equal(restored.room.currentCharacter, "6_1");
});

test("restored districts receive fresh instance IDs above IDs in hands, piles and nested Museum exhibits", t => {
    const {game} = playingRoom();
    t.after(() => game.clearTurnTimer());
    game.room.playerDistricts[0] = [district("conspirators_house"), {...district("museum"), instanceId: "district-7", exposition: [
        {...district("museum"), instanceId: "district-20", exposition: [{...district("theater"), instanceId: "district-99"}]}
    ]}];
    game.state.players[0].hand = [{...district("manor"), instanceId: "district-85"}];
    game.state.districtDeck = [{...district("temple"), instanceId: "district-40"}];
    game.state.districtDiscard = [{...district("market"), instanceId: "district-50"}];
    game.state.nextDistrictId = 1;
    const restored = createRoom().game;
    t.after(() => restored.clearTurnTimer());
    restored.setSnapshot(JSON.parse(JSON.stringify(game.getSnapshot())));
    event(restored, 0, "conspirators-house-action", 0, "2_1");
    assert.equal(restored.room.playerDistricts[0][0].instanceId, "district-100");
});

test("legacy used flags remain spent on the first source while additional copies retain their own actions", t => {
    const {game} = playingRoom();
    t.after(() => game.clearTurnTimer());
    game.room.playerDistricts[0] = ["laboratory", "laboratory", "forgery", "forgery", "museum", "museum"].map(district);
    game.state.players[0].hand = Array.from({length: 6}, () => district("temple"));
    game.room.playerHand[0] = 6;
    game.room.playerGold[0] = 10;
    game.room.laboratoryAction = false;
    game.room.forgeryAction = false;
    game.room.museumAction = false;
    const snapshot = JSON.parse(JSON.stringify(game.getSnapshot()));
    delete snapshot.room.turnId;
    const restored = createRoom().game;
    t.after(() => restored.clearTurnTimer());
    restored.setSnapshot(snapshot);
    event(restored, 0, "laboratory-action", 0, 0);
    assert.equal(restored.state.players[0].hand.length, 6);
    event(restored, 0, "laboratory-action", 0, 1);
    assert.equal(restored.state.players[0].hand.length, 5);
    assert.equal(restored.room.playerGold[0], 12);
    event(restored, 0, "forgery-action", 2);
    assert.equal(restored.state.players[0].hand.length, 5);
    event(restored, 0, "forgery-action", 3);
    assert.equal(restored.state.players[0].hand.length, 8);
    assert.equal(restored.room.playerGold[0], 10);
    event(restored, 0, "museum-action", 0, 4);
    assert.equal(restored.state.players[0].hand.length, 8);
    event(restored, 0, "museum-action", 0, 5);
    assert.equal(restored.state.players[0].hand.length, 7);
    assert.equal(restored.room.playerDistricts[0][5].exposition.length, 1);
});

test("a restored Theater queue resumes at its saved position and a timer skips only that instance", async t => {
    const {game} = playingRoom();
    t.after(() => game.clearTurnTimer());
    game.room.king = 2;
    game.room.playerDistricts[2] = [district("theater"), district("theater")];
    game.room.playerDistricts[0] = [district("theater")];
    event(game, 0, "take-resources", "coins");
    event(game, 0, "end-turn");
    game.room.timerSettings.enabled = true;
    finishDraft(game);
    event(game, 2, "theater-action", 2);
    const snapshot = JSON.parse(JSON.stringify(game.getSnapshot()));
    assert.equal(snapshot.room.theaterAction.position, 2);
    snapshot.room.timer.endsAt = Date.now() - 1;
    const restored = createRoom().game;
    t.after(() => restored.clearTurnTimer());
    restored.setSnapshot(snapshot);
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(restored.room.phase, 1.5);
    assert.equal(restored.room.currentPlayer, 0);
    assert.deepEqual(restored.room.theaterAction, {sourceIndex: 0, position: 3, total: 3});
    assert.equal(restored.room.timer.ownerSlot, 0);
    assert.ok(restored.room.timer.endsAt > Date.now());
    event(restored, 0, "theater-action", 0);
    assert.equal(restored.room.phase, 2);
});

test("the Witch's controlled turn measures her effective city size without starting another character turn", t => {
    const {game} = playingRoom();
    t.after(() => game.clearTurnTimer());
    game.room.currentPlayer = 2;
    game.room.currentCharacter = "6_1";
    game.state.currentIndCharacter = 6;
    game.state.players[2].action = null;
    game.room.tookResource = true;
    game.room.turnId = 40;
    game.room.witched = "7_1";
    game.room.witchedstate = 2;
    game.state.characterRoles = {"1_2": 0, "7_1": 1};
    game.state.players[0].character = ["1_2"];
    game.state.players[1].character = ["7_1"];
    game.room.playerDistricts[0] = [district("monument"), district("catacombs")];
    event(game, 2, "end-turn");
    assert.equal(game.room.currentPlayer, 1);
    assert.equal(game.room.turnId, 41);
    event(game, 1, "take-resources", "coins");
    assert.equal(game.room.currentPlayer, 0);
    assert.equal(game.room.currentCharacter, "7_1");
    assert.equal(game.room.turnId, 41);
    assert.equal(game.state.turnStartCitySize, 2);
});

test("snapshots preserve a current building ban alongside another scheduled ban, and each expires after its round", t => {
    const {game} = playingRoom();
    t.after(() => game.clearTurnTimer());
    game.room.roundNumber = 3;
    game.room.buildingBan = true;
    game.room.nextRoundBuildingBan = true;
    game.state.buildingBanRound = 4;
    const restored = createRoom().game;
    t.after(() => restored.clearTurnTimer());
    restored.setSnapshot(JSON.parse(JSON.stringify(game.getSnapshot())));
    assert.equal(restored.room.buildingBan, true);
    assert.equal(restored.room.nextRoundBuildingBan, true);
    event(restored, 0, "take-resources", "coins");
    event(restored, 0, "end-turn");
    assert.equal(restored.room.roundNumber, 4);
    assert.equal(restored.room.buildingBan, true);
    assert.equal(restored.room.nextRoundBuildingBan, false);
    restored.room.phase = 2;
    restored.room.currentPlayer = 0;
    restored.room.currentCharacter = "8_1";
    restored.state.currentIndCharacter = 8;
    restored.state.players[0].action = null;
    restored.room.tookResource = true;
    event(restored, 0, "end-turn");
    assert.equal(restored.room.roundNumber, 5);
    assert.equal(restored.room.buildingBan, false);
});

test("Wineries completing their fifth round contribute their bonus to the final score", t => {
    const {game} = playingRoom();
    t.after(() => game.clearTurnTimer());
    for (const slot of Object.keys(game.state.players)) {
        game.state.players[slot].hand = [];
        game.room.playerHand[slot] = 0;
    }
    game.room.roundNumber = 6;
    game.state.lastAgedRound = 5;
    game.room.ender = 0;
    game.room.playerDistricts[0] = [{...district("winery"), wineAge: 4}];
    event(game, 0, "take-resources", "coins");
    event(game, 0, "end-turn");
    assert.equal(game.room.phase, 0);
    assert.equal(game.room.playerDistricts[0][0].wineAge, 5);
    assert.equal(game.room.playerScore[0], 10);
    assert.deepEqual(game.room.winnerPlayers, [0]);
});
