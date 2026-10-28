"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const setup = require("../public/setup");
const {calculateDistrictScoreDetails} = require("../district-scoring");
const {district} = require("../test-support/game.cjs");

function legacyRoom(overrides = {}) {
    const data = {
        phase: 2, king: 0, ender: null, citySize: 7, winnerPlayer: null,
        playerSlots: ["host", "guest", "guest-2", "guest-3", null, null, null, null],
        playerDistricts: {0: []}, playerHand: {0: 0}, playerGold: {0: 0}, playerScore: {0: 0},
        gameSetup: {rules: setup.normalizeRules()},
        ...overrides
    };
    Object.defineProperty(data, "player", {get() {throw new Error("Private player state was read");}});
    Object.defineProperty(data, "state", {get() {throw new Error("Private server state was read");}});
    return data;
}

test("legacy public state explains every visible bonus without requiring a private hand", () => {
    const city = [
        {...district("stone_bridge"), decoration: 2, buildDiscount: 3},
        district("catacombs"), district("monument"), district("map_room"),
        district("imperial_treasury"), district("memorial")
    ];
    const data = legacyRoom({
        playerDistricts: {0: city}, playerHand: {0: 4}, playerGold: {0: 5},
        ender: 0, citySize: 6,
        gameSetup: {rules: setup.normalizeRules({bonuses: {firstCity: 9, otherCities: 6, allColors: 7}})}
    });
    const expected = calculateDistrictScoreDetails(city, {handCount: 4, gold: 5, crowned: true, allColorsBonus: 7, firstCityBonus: 9});
    data.playerScore[0] = expected.total;
    assert.deepEqual(setup.getPlayerScoreDetails(data, 0), expected);
    assert.equal(setup.getPlayerScoreDetails(data, "0").citySize, 6);
    assert.equal(setup.getPlayerScoreDetails(data, 0).nominal, 22);
});

test("server score explanations take precedence without reading legacy fields", () => {
    const details = {citySize: 1, nominal: 3, bonuses: [], total: 3};
    const data = {playerScoreDetails: {0: details}};
    Object.defineProperty(data, "playerDistricts", {get() {throw new Error("Legacy data was read");}});
    assert.equal(setup.getPlayerScoreDetails(data, 0), details);
});

test("legacy completion uses the saved threshold and leaves the first finisher's bonus after city shrinkage", () => {
    const rules = setup.normalizeRules({citySize: 9, bonuses: {firstCity: 8, otherCities: 5, allColors: 0}});
    const data = legacyRoom({ender: 1, citySize: 2, gameSetup: {rules}, playerDistricts: {0: [district("monument")]}});
    assert.deepEqual(setup.getPlayerScoreDetails(data, 0).bonuses.map(b => [b.id, b.points]), [["completed_city", 5]]);
    data.ender = 0;
    data.playerDistricts[0] = [district("temple")];
    assert.deepEqual(setup.getPlayerScoreDetails(data, 0).bonuses.map(b => [b.id, b.points]), [["first_city", 8]]);
});

test("legacy final score derives only a possible Secret Vault bonus from the already public total", () => {
    const data = legacyRoom({playerDistricts: {0: [district("temple")]}, playerHand: {0: 2}, playerScore: {0: 7}});
    assert.deepEqual(setup.getPlayerScoreDetails(data, 0).bonuses, []);
    data.phase = 0;
    assert.deepEqual(setup.getPlayerScoreDetails(data, 0).bonuses, []);
    data.winnerPlayer = 0;
    const details = setup.getPlayerScoreDetails(data, 0);
    assert.deepEqual(details.bonuses.map(b => [b.id, b.points]), [["secret_vault", 6]]);
    assert.equal(details.total, 7);
    assert.equal(data.playerDistricts[0].length, 1);
    for (const publicScore of [0, 1, 2, 10]) {
        data.playerScore[0] = publicScore;
        assert.deepEqual(setup.getPlayerScoreDetails(data, 0).bonuses, []);
    }
});

test("legacy empty cities have an explanation and missing city state stays unavailable", () => {
    assert.deepEqual(setup.getPlayerScoreDetails(legacyRoom(), 0), {citySize: 0, nominal: 0, bonuses: [], total: 0});
    assert.equal(setup.getPlayerScoreDetails({}, 0), null);
    const data = legacyRoom({playerDistricts: {0: [district("temple"), district("church")]}, citySize: undefined, gameSetup: {rules: setup.normalizeRules({citySize: 2})}});
    assert.deepEqual(setup.getPlayerScoreDetails(data, 0).bonuses.map(b => [b.id, b.points]), [["completed_city", 2]]);
});

test("the existing browser entry point exposes the same scorer without CommonJS or another script", () => {
    const context = vm.createContext({});
    vm.runInContext(fs.readFileSync(require.resolve("../public/setup"), "utf8"), context);
    const city = [district("capitol"), district("capitol"), district("manor"), district("temple"), district("tavern"), district("haunted_quarter")];
    const data = legacyRoom({playerDistricts: {0: city}, gameSetup: {rules: setup.normalizeRules({bonuses: {allColors: 7}})}});
    const browserResult = context.CitadelsSetup.getPlayerScoreDetails(data, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(browserResult)), setup.getPlayerScoreDetails(data, 0));
    assert.deepEqual(browserResult.bonuses.map(b => b.id).join(","), "all_colors");
    assert.equal(context.CitadelsSetup.calculateDistrictScore(city, {allColorsBonus: 7}), 25);
});

test("legacy snapshots without historical rules never identify a custom-score difference as Secret Vaults", () => {
    const data = legacyRoom({
        phase: 0, winnerPlayer: 0, ender: 0,
        gameSetup: undefined,
        playerDistricts: {0: [district("temple")]},
        playerHand: {0: 1},
        playerScore: {0: 8}
    });
    // This snapshot originally used firstCity=7 and contains an ordinary hand card.
    // Default firstCity=4 leaves a difference of three, but its cause is unknown.
    const details = setup.getPlayerScoreDetails(data, 0);
    assert.ok(!details.bonuses.some(bonus => bonus.id === "secret_vault"));
    assert.equal(details.total, 5);
});
