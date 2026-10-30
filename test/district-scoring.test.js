"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {calculateDistrictScore, calculateDistrictScoreDetails} = require("../district-scoring");

test("nominal costs include legacy and numeric decorations plus the shared decoration bonus", () => {
    const city = [
        {type: "castle", cost: 4, kind: 4, decoration: true},
        {type: "market", cost: 2, kind: 6, decoration: 2},
        {type: "temple", cost: 1, kind: 5}
    ];
    assert.equal(calculateDistrictScore(city), 11);
});

test("each Dragon Gate, Map Room, Imperial Treasury and Memorial gives its own bonus", () => {
    const city = [
        {type: "dragon_gate", cost: 6, kind: 9},
        {type: "dragon_gate", cost: 6, kind: 9},
        {type: "map_room", cost: 5, kind: 9},
        {type: "map_room", cost: 5, kind: 9},
        {type: "imperial_treasury", cost: 5, kind: 9},
        {type: "imperial_treasury", cost: 5, kind: 9},
        {type: "memorial", cost: 3, kind: 9},
        {type: "memorial", cost: 3, kind: 9}
    ];
    assert.equal(calculateDistrictScore(city, {handCount: 4, gold: 3, crowned: true}), 68);
    assert.equal(calculateDistrictScore(city, {handCount: 4, gold: 3}), 58);
});

test("every Museum scores its own exhibition without adding those cards to the hand", () => {
    const city = [
        {type: "museum", cost: 4, kind: 9, exposition: [{type: "palace", cost: 5, kind: 4}]},
        {type: "museum", cost: 4, kind: 9, exposition: [{type: "temple", cost: 1, kind: 5}, {type: "theater", cost: 6, kind: 9}]},
        {type: "museum", cost: 4, kind: 9},
        {type: "map_room", cost: 5, kind: 9}
    ];
    assert.equal(calculateDistrictScore(city, {handCount: 2}), 22);
});

test("each Basilica counts odd nominal costs after decorations, including other Basilicas", () => {
    const city = [
        {type: "basilica", cost: 4, kind: 9, decoration: true},
        {type: "basilica", cost: 4, kind: 9},
        {type: "tavern", cost: 1, kind: 6},
        {type: "market", cost: 2, kind: 6, decoration: 1}
    ];
    assert.equal(calculateDistrictScore(city), 20);
});

test("each Stone Bridge and Catacombs scores a bonus, and Wineries mature independently after five rounds", () => {
    const city = [
        {type: "stone_bridge", cost: 3, kind: 0},
        {type: "stone_bridge", cost: 3, kind: 0},
        {type: "catacombs", cost: 2, kind: 9},
        {type: "catacombs", cost: 2, kind: 9},
        {type: "winery", cost: 3, kind: 9},
        {type: "winery", cost: 3, kind: 9, wineAge: 4},
        {type: "winery", cost: 3, kind: 9, wineAge: 5},
        {type: "winery", cost: 3, kind: 9, wineAge: 8}
    ];
    assert.equal(calculateDistrictScore(city), 36);
});

test("the configured all-colors bonus requires the five game colors and excludes colorless bridges", () => {
    const city = [
        {type: "manor", cost: 3, kind: 4},
        {type: "temple", cost: 1, kind: 5},
        {type: "tavern", cost: 1, kind: 6},
        {type: "watchtower", cost: 1, kind: 8},
        {type: "stone_bridge", cost: 3, kind: 0}
    ];
    assert.equal(calculateDistrictScore(city, {allColorsBonus: 7}), 11);
    const allColors = city.concat({type: "keep", cost: 3, kind: 9});
    assert.equal(calculateDistrictScore(allColors, {allColorsBonus: 7}), 21);
    assert.equal(calculateDistrictScore(allColors), 17);
    assert.equal(calculateDistrictScore(allColors, {allColorsBonus: 0}), 14);
});

test("each Wishing Well counts itself and every other special district, excluding Stone Bridges", () => {
    const city = [
        {type: "well_of_wishes", cost: 5, kind: 9},
        {type: "well_of_wishes", cost: 5, kind: 9},
        {type: "stone_bridge", cost: 3, kind: 0},
        {type: "catacombs", cost: 2, kind: 9}
    ];
    assert.equal(calculateDistrictScore(city), 25);
});

test("an Ivory Tower scores only while it is the sole special district, including another Tower", () => {
    const city = [
        {type: "ivory_tower", cost: 5, kind: 9},
        {type: "stone_bridge", cost: 3, kind: 0}
    ];
    assert.equal(calculateDistrictScore(city), 15);
    assert.equal(calculateDistrictScore(city.concat({type: "ivory_tower", cost: 5, kind: 9})), 15);
    assert.equal(calculateDistrictScore(city.concat({type: "keep", cost: 3, kind: 9})), 13);
});

test("each Capitol scores once for a qualifying color, regardless of how many color triples exist", () => {
    const city = [
        {type: "capitol", cost: 5, kind: 9},
        {type: "capitol", cost: 5, kind: 9},
        {type: "stone_bridge", cost: 3, kind: 0},
        {type: "stone_bridge", cost: 3, kind: 0},
        {type: "stone_bridge", cost: 3, kind: 0}
    ];
    assert.equal(calculateDistrictScore(city), 25);
    const coloredTriples = city.concat([
        {type: "manor", cost: 3, kind: 4},
        {type: "manor", cost: 3, kind: 4},
        {type: "manor", cost: 3, kind: 4},
        {type: "tavern", cost: 1, kind: 6},
        {type: "tavern", cost: 1, kind: 6},
        {type: "tavern", cost: 1, kind: 6}
    ]);
    assert.equal(calculateDistrictScore(coloredTriples), 43);
    assert.equal(calculateDistrictScore(city.concat({type: "keep", cost: 3, kind: 9})), 34);
});

test("Haunted Quarters choose independent colors to maximize the total bonus at the configured all-colors value", () => {
    const city = [
        {type: "manor", cost: 3, kind: 4},
        {type: "temple", cost: 1, kind: 5},
        {type: "well_of_wishes", cost: 5, kind: 9},
        {type: "haunted_quarter", cost: 3, kind: 9},
        {type: "haunted_quarter", cost: 3, kind: 9}
    ];
    assert.equal(calculateDistrictScore(city), 19);
    assert.equal(calculateDistrictScore(city, {allColorsBonus: 0}), 18);
    const twoWells = city.concat({type: "well_of_wishes", cost: 5, kind: 9});
    assert.equal(calculateDistrictScore(twoWells), 28);
    assert.equal(calculateDistrictScore(twoWells, {allColorsBonus: 7}), 31);
});

test("Haunted Quarters can preserve the Ivory Tower bonus while completing all colors without changing cards", () => {
    const city = Object.freeze([
        Object.freeze({type: "ivory_tower", cost: 5, kind: 9}),
        Object.freeze({type: "haunted_quarter", cost: 3, kind: 9}),
        Object.freeze({type: "haunted_quarter", cost: 3, kind: 9}),
        Object.freeze({type: "manor", cost: 3, kind: 4}),
        Object.freeze({type: "temple", cost: 1, kind: 5}),
        Object.freeze({type: "tavern", cost: 1, kind: 6})
    ]);
    assert.equal(calculateDistrictScore(city), 24);
    assert.equal(calculateDistrictScore(city, {allColorsBonus: 0}), 21);
});

test("Haunted Quarters weigh all-colors against every Capitol and can satisfy both together", () => {
    const city = [
        {type: "capitol", cost: 5, kind: 9},
        {type: "capitol", cost: 5, kind: 9},
        {type: "manor", cost: 3, kind: 4},
        {type: "temple", cost: 1, kind: 5},
        {type: "tavern", cost: 1, kind: 6},
        {type: "haunted_quarter", cost: 3, kind: 9}
    ];
    assert.equal(calculateDistrictScore(city), 24);
    assert.equal(calculateDistrictScore(city, {allColorsBonus: 7}), 25);
    assert.equal(calculateDistrictScore(city.concat({type: "haunted_quarter", cost: 3, kind: 9})), 30);
});

test("the other new districts have no extra scoring bonus and legacy cards resolve colors from the catalog", () => {
    const city = [
        {type: "architects_workshop", cost: 5},
        {type: "mirror_hall", cost: 6},
        {type: "conspirators_house", cost: 6},
        {type: "divination_tower", cost: 4},
        {type: "artisans_court", cost: 4},
        {type: "judicial_chamber", cost: 3},
        {type: "seminary", cost: 4},
        {type: "sloboda", cost: 6},
        {type: "exchange", cost: 6},
        {type: "papal_residence", cost: 6},
        {type: "citadel", cost: 6}
    ];
    assert.equal(calculateDistrictScore(city, {handCount: 99, gold: 99, crowned: true, allColorsBonus: 0}), 56);
    assert.equal(calculateDistrictScore(city), 59);
});

test("a large group of Haunted Quarters preserves every special-district point while optimizing color bonuses", () => {
    const city = [
        {type: "well_of_wishes", cost: 5, kind: 9},
        {type: "well_of_wishes", cost: 5, kind: 9},
        {type: "capitol", cost: 5, kind: 9},
        ...Array.from({length: 30}, () => ({type: "haunted_quarter", cost: 3, kind: 9}))
    ];
    assert.equal(calculateDistrictScore(city), 174);
    assert.equal(calculateDistrictScore(city, {allColorsBonus: 50}), 216);
});

test("score explanations keep nominal cost separate and aggregate only earned bonuses", () => {
    const city = [
        {type: "monument", cost: 4, kind: 9},
        {type: "monument", cost: 4, kind: 9},
        {type: "catacombs", cost: 2, kind: 9, decoration: true},
        {type: "stone_bridge", cost: 3, kind: 0, decoration: 2, buildDiscount: 3},
        {type: "stone_bridge", cost: 3, kind: 0},
        {type: "memorial", cost: 3, kind: 9}
    ];
    const details = calculateDistrictScoreDetails(city, {crowned: true});
    assert.equal(details.nominal, 19);
    assert.equal(details.citySize, 7);
    assert.deepEqual(Object.fromEntries(details.bonuses.map(b => [b.id, b.points])), {
        decorations: 4, catacombs: 2, stone_bridge: 4, memorial: 5
    });
    assert.ok(details.bonuses.every(b => b.label.length > 0 && b.points > 0));
    assert.equal(details.total, 34);
    assert.equal(details.total, calculateDistrictScore(city, {crowned: true}));
    assert.deepEqual(calculateDistrictScoreDetails([]), {citySize: 0, nominal: 0, bonuses: [], total: 0});
});

test("color explanations use one achievable optimal Haunted Quarter assignment", () => {
    const city = [
        {type: "capitol", cost: 5, kind: 9},
        {type: "capitol", cost: 5, kind: 9},
        {type: "manor", cost: 3, kind: 4},
        {type: "temple", cost: 1, kind: 5},
        {type: "tavern", cost: 1, kind: 6},
        {type: "haunted_quarter", cost: 3, kind: 9}
    ];
    assert.deepEqual(calculateDistrictScoreDetails(city).bonuses.map(b => [b.id, b.points]), [["capitol", 6]]);
    assert.deepEqual(calculateDistrictScoreDetails(city, {allColorsBonus: 7}).bonuses.map(b => [b.id, b.points]), [["all_colors", 7]]);
    const both = calculateDistrictScoreDetails(city.concat({type: "haunted_quarter", cost: 3, kind: 9}));
    assert.deepEqual(both.bonuses.map(b => [b.id, b.points]), [["all_colors", 3], ["capitol", 6]]);
    assert.equal(both.total, both.nominal + both.bonuses.reduce((sum, b) => sum + b.points, 0));
});
