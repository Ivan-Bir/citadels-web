"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const setup = require("../public/setup");
const {createDeck, dealStartingHands, takeRandomCharacters} = require("../utils");

test("new defaults preserve legacy scoring, full starting resources and unrestricted random discards", () => {
    const value = setup.getDefaultSetup(3);
    assert.deepEqual(value.rules, {citySize: null, bonuses: {firstCity: 4, otherCities: 2, allColors: 3}, preventRepeatedRandomDiscard: false, duplicateLimit: 0, diplomatCompleteCity: false, magistrateOverLimit: false});
    assert.deepEqual(value.starting.firstCrownReduction, {cards: 0, gold: 0});
    assert.equal(value.characters.length, 9);
    assert.equal(setup.getDefaultSetup(2).characters.length, 8);
    assert.equal(setup.getDefaultSetup(8).characters.length, 9);
    assert.equal(setup.getDeckSummary(value.districts.basic, value.districts.unique).total, 65);
    value.rules.bonuses.firstCity = 0;
    value.starting.firstCrownReduction.cards = 1;
    assert.equal(setup.getDefaultSetup().rules.bonuses.firstCity, 4);
    assert.equal(setup.normalizeStarting().firstCrownReduction.cards, 0);
});

test("all new settings survive export and import without mutating the source", () => {
    const value = setup.getDefaultSetup(4);
    value.starting = setup.normalizeStarting({handSize: 5, minUnique: 2, exactUnique: true, gold: 3, firstCrownReduction: {cards: 3, gold: 3}});
    value.rules = setup.normalizeRules({citySize: 10, bonuses: {firstCity: 8, otherCities: 0, allColors: 5}, preventRepeatedRandomDiscard: true});
    const before = JSON.stringify(value);
    assert.deepEqual(setup.parseSetup(setup.serializeSetup(value)), value);
    assert.equal(JSON.stringify(value), before);
    assert.deepEqual(setup.getStartingResources(value.starting, true), {handSize: 2, gold: 0});
    assert.deepEqual(setup.getStartingResources(value.starting, false), {handSize: 5, gold: 3});
});

test("existing v1 sections without new fields receive independent defaults", () => {
    const value = setup.getDefaultSetup();
    value.starting = {handSize: 4, minUnique: 1, gold: 2, exactUnique: true};
    value.rules = {citySize: 2};
    const result = setup.parseSetup(JSON.stringify(value));
    assert.deepEqual(result.starting.firstCrownReduction, {cards: 0, gold: 0});
    assert.deepEqual(result.rules.bonuses, {firstCity: 4, otherCities: 2, allColors: 3});
    assert.equal(result.rules.preventRepeatedRandomDiscard, false);
    assert.equal(result.starting.exactUnique, true);
    assert.equal(result.rules.citySize, 2);
});

test("bonus and reduction fields reject fractions, coercion and unsafe integers", () => {
    for (const bad of [-1, .5, NaN, Infinity, "1", null, true, undefined, Number.MAX_SAFE_INTEGER + 1]) {
        for (const key of ["firstCity", "otherCities", "allColors"])
            assert.throws(() => setup.normalizeRules({bonuses: {[key]: bad}}));
        for (const key of ["cards", "gold"])
            assert.throws(() => setup.normalizeStarting({firstCrownReduction: {[key]: bad}}));
    }
    for (const bad of [null, [], 1, "", {unknown: 1}]) {
        assert.throws(() => setup.normalizeRules({bonuses: bad}));
        assert.throws(() => setup.normalizeStarting({firstCrownReduction: bad}));
    }
    for (const bad of [null, undefined, 0, 1, "false", {}])
        assert.throws(() => setup.normalizeRules({preventRepeatedRandomDiscard: bad}));
    assert.deepEqual(setup.normalizeRules({bonuses: {firstCity: 0, otherCities: 0, allColors: 0}}).bonuses,
        {firstCity: 0, otherCities: 0, allColors: 0});
});

for (const exactUnique of [false, true]) {
    test("crown hand respects the special minimum in " + (exactUnique ? "exact" : "minimum") + " mode", () => {
        assert.throws(() => setup.normalizeStarting({minUnique: 1, exactUnique, firstCrownReduction: {cards: 4}}), /первого владельца короны/);
        assert.throws(() => setup.normalizeStarting({firstCrownReduction: {cards: 5}}), /превышать/);
        assert.throws(() => setup.normalizeStarting({firstCrownReduction: {gold: 3}}), /превышать/);
        const boundary = setup.normalizeStarting({minUnique: 1, exactUnique, firstCrownReduction: {cards: 3, gold: 2}});
        assert.deepEqual(setup.getStartingResources(boundary, true), {handSize: 1, gold: 0});
        const empty = setup.normalizeStarting({exactUnique, firstCrownReduction: {cards: 4, gold: 2}});
        assert.deepEqual(setup.getStartingResources(empty, true), {handSize: 0, gold: 0});
    });
}

test("requirements count the smaller crown hand while reserving specials for every player", () => {
    const starting = {handSize: 4, minUnique: 1, firstCrownReduction: {cards: 3}};
    assert.deepEqual(setup.getStartingRequirements(starting, 4), {cards: 13, unique: 4, basic: 9});
    for (const players of [undefined, 0, 1, 9, 2.5, "4"])
        assert.throws(() => setup.getStartingRequirements(starting, players));
    const value = setup.getDefaultSetup(4);
    value.rules.citySize = 2;
    value.starting = setup.normalizeStarting({...starting, exactUnique: true});
    value.districts.basic = {manor: 9};
    value.districts.unique = ["library", "stable", "keep", "laboratory"];
    assert.deepEqual(setup.getStartErrors(value, 4), []);
    value.districts.basic.manor--;
    assert.ok(setup.getStartErrors(value, 4).some(error => /базовых.*9.*8/.test(error)));
    value.districts.basic.manor++;
    value.districts.unique.pop();
    assert.ok(setup.getStartErrors(value, 4).some(error => /особых кварталов.*4.*3/.test(error)));
});

for (const exactUnique of [false, true]) {
    test("unequal starting hands preserve all cards and the minimum for any crown seat: " + exactUnique, () => {
        for (const players of [2, 3, 8]) {
            for (let crown = 0; crown < players; crown++) {
                const deck = createDeck(players, setup.uniqueIds.filter(id => !["theater", "conspirators_house"].includes(id)));
                const all = deck.slice();
                const hands = dealStartingHands(deck, players, {handSize: 4, minUnique: 1, exactUnique, firstCrownReduction: {cards: 3}}, crown);
                hands.forEach((hand, index) => {
                    assert.equal(hand.length, index === crown ? 1 : 4);
                    assert.ok(hand.filter(card => card.kind === 9).length >= 1);
                    if (exactUnique) assert.equal(hand.filter(card => card.kind === 9).length, 1);
                });
                const after = deck.concat(...hands);
                assert.equal(after.length, all.length);
                assert.equal(new Set(after).size, all.length);
                assert.ok(all.every(card => after.includes(card)));
                assert.equal(deck.length, all.length - players * 4 + 3);
            }
        }
    });
}

test("an empty crown hand leaves four extra cards undealt and invalid crown deals are atomic", () => {
    const deck = createDeck(2, []), all = deck.slice();
    const hands = dealStartingHands(deck, 2, {firstCrownReduction: {cards: 4}}, 1);
    assert.deepEqual(hands[1], []);
    assert.equal(hands[0].length, 4);
    assert.equal(deck.length, all.length - 4);
    for (const crown of [-1, 2, 0.5, "0"])
        assert.throws(() => dealStartingHands(deck, 2, undefined, crown));
    const before = deck.slice();
    assert.throws(() => dealStartingHands(deck, 2, {minUnique: 1, firstCrownReduction: {cards: 4}}));
    assert.deepEqual(deck, before);
});

test("random character selection excludes previous discards and protects every rank-four variant", () => {
    for (const crown of ["4_1", "4_2", "4_3"]) {
        const deck = ["1_1", "2_1", "3_1", crown, "5_1", "6_1", "7_1", "8_1"];
        const original = deck.slice();
        const selected = takeRandomCharacters(deck, 4, ["1_1", "8_1"], true);
        assert.equal(selected.length, 4);
        assert.ok(!selected.includes(crown));
        assert.ok(!selected.includes("1_1") && !selected.includes("8_1"));
        assert.deepEqual(deck, original.filter(id => !selected.includes(id)));
        assert.equal(new Set(deck.concat(selected)).size, 8);
    }
});

test("face-down discards can include the crown and impossible random discards leave the pool untouched", () => {
    const deck = ["4_2"];
    assert.deepEqual(takeRandomCharacters(deck, 0, ["4_2"], true), []);
    for (const count of [-1, .5, "1", undefined])
        assert.throws(() => takeRandomCharacters(deck, count));
    assert.throws(() => takeRandomCharacters(deck, 1, ["4_2"]));
    assert.throws(() => takeRandomCharacters(deck, 1, [], true));
    assert.deepEqual(deck, ["4_2"]);
    assert.deepEqual(takeRandomCharacters(deck, 1), ["4_2"]);
    assert.deepEqual(deck, []);
});
