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
    assert.equal(details.nominal, 11);
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
