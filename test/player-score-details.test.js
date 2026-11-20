"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {createRoom, playingRoom, district, chars, timer} = require("../test-support/game.cjs");
const setup = require("../public/setup");

function emptyHands(game) {
    for (const slot of Object.keys(game.state.players)) {
        game.state.players[slot].hand = [];
        game.room.playerHand[slot] = 0;
    }
}

function assertCompleteDetails(game) {
    for (const slot of Object.keys(game.state.players)) {
        const details = game.room.playerScoreDetails[slot];
        assert.equal(details.total, game.room.playerScore[slot]);
        assert.equal(details.total, details.nominal + details.bonuses.reduce((sum, b) => sum + b.points, 0));
        assert.ok(details.bonuses.every(b => b.points !== 0));
    }
}

test("only the host can stop an active match and its final scores have no winners", t => {
    const {game, messages, achievements} = playingRoom();
    t.after(() => game.clearTurnTimer());
    emptyHands(game);
    game.room.playerDistricts[1] = [district("castle")];
    game.state.players[1].hand = [district("secret_vault")];
    game.room.playerHand[1] = 1;
    const before = JSON.stringify(game.getSnapshot());
    game.userEvent("player-1", "abort-game", []);
    assert.equal(JSON.stringify(game.getSnapshot()), before);

    messages.length = 0;
    game.userEvent("host", "abort-game", []);
    assert.equal(game.room.phase, 0);
    assert.equal(game.room.winnerPlayer, null);
    assert.deepEqual(game.room.winnerPlayers, []);
    assert.deepEqual(achievements, []);
    const final = messages.find(message => message.event === "state");
    assert.equal(final.data.gameEndReason, "aborted");
    assert.equal(final.data.playerScore[1], 7);
    for (const user of ["host", "player-1", "spectator"]) assert.ok(final.target.has(user));

    const snapshot = JSON.parse(JSON.stringify(game.getSnapshot()));
    messages.length = 0;
    game.userEvent("host", "abort-game", []);
    assert.deepEqual(JSON.parse(JSON.stringify(game.getSnapshot())), snapshot);
    assert.equal(messages.length, 0);
    const restored = createRoom().game;
    t.after(() => restored.clearTurnTimer());
    restored.setSnapshot(snapshot);
    assert.equal(restored.room.gameEndReason, "aborted");
    assert.deepEqual(restored.room.playerScore, game.room.playerScore);
    const shuffle = t.mock.method(require("../utils"), "shuffle");
    restored.userEvent("host", "start-game", [chars, [], null, timer, setup.getDefaultBasicCounts()]);
    assert.equal(restored.room.phase, 1);
    assert.equal(restored.room.gameEndReason, null);
    assert.ok(shuffle.mock.calls.some(call => call.arguments[0] === restored.room.playerSlots));
});

test("stopping in the lobby keeps the initial state and completed results, including shared wins", t => {
    const lobby = createRoom();
    const before = JSON.stringify(lobby.game.getSnapshot());
    lobby.game.userEvent("host", "abort-game", []);
    assert.equal(JSON.stringify(lobby.game.getSnapshot()), before);
    assert.equal(lobby.messages.length, 0);

    const {game, achievements, messages} = playingRoom({rules: {citySize: 2, bonuses: {firstCity: 0, otherCities: 0}}});
    t.after(() => game.clearTurnTimer());
    emptyHands(game);
    game.room.ender = 0;
    for (const slot of [0, 1]) {
        game.room.playerDistricts[slot] = [district("temple"), district("church")];
        game.room.playerGold[slot] = 2;
    }
    game.room.tookResource = true;
    game.userEvent("host", "end-turn", []);
    assert.equal(game.room.gameEndReason, "completed");
    assert.equal(game.room.winnerPlayer, 0);
    assert.deepEqual(game.room.winnerPlayers, [0, 1]);
    assert.deepEqual(achievements, [
        {user: "host", id: "win"}, {user: "host", id: "games"},
        {user: "player-1", id: "win"}, {user: "player-1", id: "games"}
    ]);
    const completed = JSON.stringify(game.getSnapshot());
    messages.length = 0;
    game.userEvent("host", "abort-game", []);
    assert.equal(JSON.stringify(game.getSnapshot()), completed);
    assert.equal(messages.length, 0);

    const legacy = JSON.parse(completed);
    delete legacy.room.gameEndReason;
    lobby.game.setSnapshot(legacy);
    assert.equal(lobby.game.room.gameEndReason, "completed");
    assert.deepEqual(lobby.game.room.winnerPlayers, [0, 1]);
});

test("public score details expose only earned public bonuses before final hand scoring", t => {
    const {game, messages} = playingRoom();
    t.after(() => game.clearTurnTimer());
    emptyHands(game);
    game.state.players[0].hand = [district("secret_vault"), district("secret_vault")];
    game.room.playerHand[0] = 2;
    game.room.playerDistricts[0] = [district("map_room"), district("catacombs"), district("monument")];
    game.userEvent("host", "take-resources", ["coins"]);
    const details = game.room.playerScoreDetails[0];
    assert.equal(details.citySize, 3);
    assert.equal(details.nominal, 12);
    assert.deepEqual(details.bonuses.map(b => [b.id, b.points]), [["map_room", 2], ["catacombs", 2]]);
    const publicMessage = messages.filter(message => message.event === "state").at(-1);
    assert.deepEqual(publicMessage.data.playerScoreDetails[0], details);
    assert.ok(!JSON.stringify(publicMessage.data.playerScoreDetails).includes("secret_vault"));
    assertCompleteDetails(game);

    game.userEvent("host", "abort-game", []);
    assert.deepEqual(game.room.playerScoreDetails[0].bonuses.map(b => [b.id, b.points]), [
        ["map_room", 2], ["catacombs", 2], ["secret_vault", 6]
    ]);
    assertCompleteDetails(game);
});

test("score details include configured completion bonuses and retain the first city's bonus after shrinking", t => {
    const {game} = playingRoom({rules: {citySize: 2, bonuses: {firstCity: 9, otherCities: 5, allColors: 0}}});
    t.after(() => game.clearTurnTimer());
    emptyHands(game);
    game.room.ender = 0;
    game.room.playerDistricts[0] = [district("temple")];
    game.room.playerDistricts[1] = [district("temple"), district("church")];
    game.userEvent("host", "abort-game", []);
    assert.equal(game.room.citySize, 2);
    assert.equal(game.room.playerScoreDetails[0].citySize, 1);
    assert.deepEqual(game.room.playerScoreDetails[0].bonuses.map(b => [b.id, b.points]), [["first_city", 9]]);
    assert.deepEqual(game.room.playerScoreDetails[1].bonuses.map(b => [b.id, b.points]), [["completed_city", 5]]);
    assert.deepEqual(game.room.playerScoreDetails[2].bonuses, []);
    assertCompleteDetails(game);
});

test("older snapshots rebuild score details without exposing Secret Vaults before the final score", t => {
    const {game} = playingRoom();
    t.after(() => game.clearTurnTimer());
    emptyHands(game);
    game.state.players[0].hand = [district("secret_vault")];
    game.room.playerHand[0] = 1;
    game.room.playerDistricts[0] = [district("stone_bridge")];
    game.userEvent("host", "take-resources", ["coins"]);
    const snapshot = JSON.parse(JSON.stringify(game.getSnapshot()));
    delete snapshot.room.playerScoreDetails;
    const restored = createRoom().game;
    t.after(() => restored.clearTurnTimer());
    restored.setSnapshot(snapshot);
    assert.deepEqual(restored.room.playerScoreDetails, game.room.playerScoreDetails);
    assertCompleteDetails(restored);

    game.userEvent("host", "abort-game", []);
    const completed = JSON.parse(JSON.stringify(game.getSnapshot()));
    delete completed.room.playerScoreDetails;
    restored.setSnapshot(completed);
    assert.deepEqual(restored.room.playerScoreDetails, game.room.playerScoreDetails);
    assertCompleteDetails(restored);

    restored.userEvent("host", "start-game", [chars, setup.uniqueIds, null, timer, setup.getDefaultBasicCounts()]);
    assert.equal(restored.room.phase, 1);
    for (const details of Object.values(restored.room.playerScoreDetails))
        assert.deepEqual(details, {citySize: 0, nominal: 0, bonuses: [], total: 0});
});
