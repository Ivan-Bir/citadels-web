"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {createRoom, playingRoom, district} = require("../test-support/game.cjs");

const oldMonument = () => ({...district("monument"), cost: 4});
const snapshotOf = game => JSON.parse(JSON.stringify(game.getSnapshot()));

test("an active snapshot updates Monument cards in every pile and choice without charging for past builds", t => {
    const {game} = playingRoom();
    const restored = createRoom().game;
    t.after(() => game.clearTurnTimer());
    t.after(() => restored.clearTurnTimer());
    const left = ["temple", "church", "monastery", "catacombs"].map(district);
    game.room.playerDistricts[0] = [...left, {...oldMonument(), decoration: 1, buildDiscount: 2}];
    game.room.playerDistricts[1] = [...left, district("cathedral"), oldMonument()];
    game.state.players[0].hand = [oldMonument()];
    game.state.players[0].choose = [{...oldMonument(), instanceId: "district-99"}];
    game.state.players[1].choose = ["1_1", "2_1"];
    game.state.districtDeck = [{...district("museum"), exposition: [
        {...district("museum"), exposition: [oldMonument()]}
    ]}, oldMonument()];
    game.state.districtDiscard = [oldMonument()];
    game.room.playerGold[0] = 7;
    game.state.magistrateAction = {cost: 2};
    game.state.alchemistCoins = 2;

    restored.setSnapshot(snapshotOf(game));

    const {room, state} = restored;
    assert.deepEqual(room.playerDistricts[0].at(-1), {...district("monument"), decoration: 1, buildDiscount: 2});
    assert.equal(room.playerScoreDetails[0].nominal, 5 + left.reduce((total, card) => total + card.cost, 0));
    assert.equal(room.playerScoreDetails[0].citySize, 5);
    assert.equal(room.playerScoreDetails[1].citySize, 5);
    const museumExhibit = state.districtDeck[0].exposition[0].exposition[0];
    for (const card of [state.players[0].hand[0], state.players[0].choose[0], museumExhibit, state.districtDeck[1], state.districtDiscard[0]])
        assert.equal(card.cost, 5);
    assert.deepEqual(state.players[1].choose, ["1_1", "2_1"]);
    assert.equal(state.nextDistrictId, 99);
    assert.equal(room.playerGold[0], 7);
    assert.equal(state.magistrateAction.cost, 2);
    assert.equal(state.alchemistCoins, 2);
});

for (const hasDetails of [true, false]) {
    test("a finished snapshot retains the former fifth-position Monument bonus " + (hasDetails ? "in" : "without") + " its saved breakdown", t => {
        const {game} = playingRoom({rules: {citySize: 6, bonuses: {otherCities: 3}}});
        const restored = createRoom().game;
        t.after(() => game.clearTurnTimer());
        t.after(() => restored.clearTurnTimer());
        game.room.ender = 1;
        game.userEvent("host", "abort-game", []);
        const saved = snapshotOf(game);
        const city = ["temple", "church", "monastery", "cathedral"].map(district).concat(oldMonument());
        const nominal = city.reduce((sum, card) => sum + card.cost, 0);
        const details = {citySize: 6, nominal, bonuses: [
            {id: "completed_city", label: "Завершённый город", points: 3},
            {id: "secret_vault", label: "Тайное убежище", points: 3}
        ], total: nominal + 6};
        delete saved.room.gameEndReason;
        saved.room.winnerPlayer = 0;
        saved.room.winnerPlayers = [0];
        saved.room.playerDistricts[0] = city;
        saved.state.players[0].hand = [district("secret_vault")];
        saved.room.playerHand[0] = 1;
        saved.room.playerScore[0] = details.total;
        if (hasDetails) saved.room.playerScoreDetails[0] = details;
        else delete saved.room.playerScoreDetails;

        restored.setSnapshot(saved);
        assert.equal(restored.room.playerDistricts[0][4].cost, 4);
        assert.equal(restored.room.playerScore[0], details.total);
        assert.deepEqual(restored.room.playerScoreDetails[0], details);
        assert.deepEqual(restored.room.winnerPlayers, [0]);
        assert.equal(restored.room.winnerPlayer, 0);
    });
}

test("an archived total survives reconstruction when an older snapshot omitted its custom bonus settings", t => {
    const {game} = playingRoom({rules: {bonuses: {firstCity: 7}}});
    const restored = createRoom().game;
    t.after(() => game.clearTurnTimer());
    t.after(() => restored.clearTurnTimer());
    game.room.ender = 0;
    game.room.playerDistricts[0] = [oldMonument()];
    game.state.players[0].hand = [];
    game.room.playerHand[0] = 0;
    game.userEvent("host", "abort-game", []);
    const saved = snapshotOf(game);
    delete saved.room.playerScoreDetails;
    delete saved.room.gameSetup;
    delete saved.state.gameRules;

    restored.setSnapshot(saved);
    const details = restored.room.playerScoreDetails[0];
    assert.deepEqual(details.bonuses.map(bonus => [bonus.id, bonus.points]), [["first_city", 4]]);
    assert.equal(details.total, 8);
    assert.equal(restored.room.playerScore[0], 11);
});
