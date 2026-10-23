"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const setup = require("../public/setup");
const utils = require("../utils");

const characters = players => Array.from({length: [3, 8].includes(players) ? 9 : 8}, (_, i) => (i + 1) + "_1");
const config = (players = 4) => ({
    format: setup.FORMAT, version: setup.VERSION,
    districts: {basic: setup.getDefaultBasicCounts(), unique: []},
    characters: characters(players),
    timer: setup.normalizeTimerSettings({enabled: false}),
    starting: setup.normalizeStarting(), rules: setup.normalizeRules()
});
const minimalCounts = players => {
    const city = setup.getCitySize(players);
    const counts = {};
    setup.basicIds.slice(0, city).forEach(id => counts[id] = 1);
    counts.manor += city * players - city;
    return counts;
};

test("catalog keeps 54 standard basic cards among 23 available non-special kinds", () => {
    assert.equal(setup.basicIds.length, 23);
    assert.deepEqual(setup.getDeckSummary(undefined, []), {
        basic: 54, unique: 0, total: 54,
        byType: {0: 0, 4: 12, 5: 11, 6: 20, 8: 11}, buildableKinds: 17
    });
    const first = setup.getDefaultBasicCounts();
    first.manor = 0;
    assert.equal(setup.getDefaultBasicCounts().manor, 5);
});
test("shared utilities load in a browser without CommonJS", () => {
    const context = {self: {}};
    vm.runInNewContext(fs.readFileSync(require.resolve("../public/setup"), "utf8"), context);
    assert.equal(context.self.CitadelsSetup.getDeckSummary(undefined, []).total, 54);
    const storage = new Map();
    const store = context.self.CitadelsSetup.createDraftStore(() => ({
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value)
    }), "host");
    const draft = {setup: context.self.CitadelsSetup.getDefaultSetup(), preserveCharacters: true, creatorMode: false};
    assert.equal(store.write("room", draft), true);
    assert.equal(JSON.stringify(store.read("room")), JSON.stringify(draft));
});
test("explicit counts omit cards; undefined retains legacy defaults", () => {
    assert.equal(setup.normalizeBasicCounts().manor, 5);
    assert.equal(setup.normalizeBasicCounts({}).manor, 0);
    assert.equal(setup.normalizeBasicCounts({manor: 0, tavern: 99}).tavern, 99);
    assert.equal(setup.normalizeBasicCounts({manor: 1}).castle, 0);
    const inherited = Object.create({manor: 99});
    assert.equal(setup.normalizeBasicCounts(inherited).manor, 0);
});
for (const bad of [-1, 100, 1.5, NaN, Infinity, "2", "", null, true]) {
    test("reject invalid copy count: " + String(bad), () => {
        assert.throws(() => setup.normalizeBasicCounts({manor: bad}), /0.*99/);
    });
}
test("reject malformed maps and unknown or special IDs in basic counts", () => {
    for (const value of [null, [], 5, "deck", new Date()])
        assert.throws(() => setup.normalizeBasicCounts(value));
    for (const value of [{new_card: 1}, {theater: 1}, JSON.parse('{"__proto__":3}')])
        assert.throws(() => setup.normalizeBasicCounts(value), /неизвестное поле/);
    assert.equal({}.polluted, undefined);
});
test("all 38 selected unique districts reach the deck, without a 14-card cap", () => {
    const deck = utils.createDeck(4, setup.uniqueIds);
    assert.equal(deck.length, 92);
    for (const id of setup.uniqueIds)
        assert.equal(deck.filter(card => card.type === id).length, 1, id);
});
test("selected unique counts of 0, 10, 14, 30 and 38 all match the final deck", () => {
    for (const count of [0, 10, 14, 30, 38]) {
        const selected = setup.uniqueIds.slice(0, count);
        assert.equal(utils.createDeck(4, selected).length, 54 + count);
        assert.equal(setup.getDeckSummary(undefined, selected).total, 54 + count);
    }
});
test("custom counts determine card multiplicities, prices and kinds", () => {
    const counts = {manor: 2, temple: 0, tavern: 99};
    const before = JSON.stringify(setup.districts);
    const deck = utils.createDeck(4, ["library", "arsenal"], false, counts);
    assert.equal(deck.length, 103);
    assert.equal(deck.filter(card => card.type === "manor").length, 2);
    assert.equal(deck.filter(card => card.type === "tavern").length, 99);
    assert.equal(deck.filter(card => card.type === "temple").length, 0);
    assert.deepEqual(deck.find(card => card.type === "manor"), {type: "manor", cost: 3, kind: 4});
    const copies = deck.filter(card => card.type === "manor");
    copies[0].cost = 42;
    assert.equal(copies[1].cost, 3);
    assert.equal(JSON.stringify(setup.districts), before);
    assert.deepEqual(counts, {manor: 2, temple: 0, tavern: 99});
    assert.equal(utils.createDeck(4, []).length, 54);
});
test("debug onlyFilter continues to return just the requested unique cards", () => {
    assert.deepEqual(utils.createDeck(4, ["necropolis"], true), [{type: "necropolis", cost: 5, kind: 9}]);
});
test("unavailable Theater is rejected rather than silently removed", () => {
    for (const players of [2, 3])
        assert.throws(() => utils.createDeck(players, ["theater"]), /Театр/);
    assert.equal(utils.createDeck(4, ["theater"]).length, 55);
});
test("bad special lists and characters fail predictably", () => {
    for (const value of [null, {}, "library", [null], ["fake"], ["manor"], ["library", "library"], Array(1)])
        assert.throws(() => setup.normalizeUniqueDistricts(value));
    for (const value of [null, {}, [], Array(8), characters(4).reverse(), [1,2,3,4,5,6,7,8], characters(4).map(() => "1_1")])
        assert.throws(() => setup.normalizeCharacters(value));
});
test("character availability is checked for starting, independently from JSON structure", () => {
    for (const players of [2, 3, 4, 5, 6, 7, 8])
        assert.deepEqual(setup.normalizeCharacters(characters(players), players), characters(players));
    assert.throws(() => setup.normalizeCharacters(characters(3), 2));
    assert.throws(() => setup.normalizeCharacters(characters(4), 3));
    assert.throws(() => setup.normalizeCharacters(characters(4), 8));
    const emperor = characters(2); emperor[3] = "4_2";
    assert.throws(() => setup.normalizeCharacters(emperor, 2));
    const queen = characters(3); queen[8] = "9_2";
    assert.throws(() => setup.normalizeCharacters(queen, 4));
    assert.deepEqual(setup.normalizeCharacters(queen, 5), queen);
});

for (const players of [2, 3, 4, 5, 6, 7, 8]) {
    test("minimum and diversity at the exact boundary for " + players + " players", () => {
        const value = config(players);
        value.districts.basic = minimalCounts(players);
        assert.deepEqual(setup.getStartErrors(value, players), []);
        value.districts.basic.manor--;
        assert.ok(setup.getStartErrors(value, players).some(error => error.includes("Недостаточно карт")));
        value.districts.basic = {manor: 99};
        assert.ok(setup.getStartErrors(value, players).some(error => error.includes("разных")));
    });
}
test("unique cards count towards the minimum; Secret Vault is not buildable", () => {
    const value = config(4);
    value.districts.basic = {manor: 21};
    value.districts.unique = ["stable", "keep", "library", "arsenal", "poor_house", "memorial", "secret_vault"];
    assert.deepEqual(setup.getStartErrors(value, 4), []);
    value.districts.unique.splice(0, 1);
    value.districts.basic.manor++;
    assert.ok(setup.getStartErrors(value, 4).some(error => error.includes("разных")));
});
test("invalid player count and malformed setup do not crash validation", () => {
    for (const players of [undefined, 0, 1, 9, 2.5, "4"])
        assert.ok(setup.getStartErrors(config(), players).length);
    assert.ok(setup.getStartErrors(null, 4).length);
});
test("shuffle preserves identity and every element", () => {
    for (const array of [[], [1], [1, 2, 3, 4, 5, 6]]) {
        const before = array.slice().sort();
        assert.equal(utils.shuffle(array), array);
        assert.deepEqual(array.slice().sort(), before);
    }
});
test("legacy timer normalization uses defaults, clamps and preserves zero", () => {
    assert.equal(setup.normalizeTimerSettings().characterDurationMs, 90000);
    assert.equal(setup.normalizeTimerSettings({preset: "short"}).mainDurationMs, 40000);
    const timer = setup.normalizeTimerSettings({preset: "custom", enabled: false, characterDurationMs: 0, mainDurationMs: 1, responseDurationMs: 999999});
    assert.deepEqual(timer, {enabled: false, preset: "custom", characterDurationMs: 0, mainDurationMs: 30000, responseDurationMs: 120000});
    assert.equal(setup.normalizeTimerSettings({characterDurationMs: 0, mainDurationMs: 0, responseDurationMs: 0}).enabled, false);
    assert.equal(setup.normalizeTimerSettings({preset: "toString"}).preset, "normal");
});
test("timer maxima and zeros survive file round trips", () => {
    const value = config();
    value.timer = {enabled: false, preset: "custom", characterDurationMs: 900000, mainDurationMs: 600000, responseDurationMs: 0};
    const result = setup.parseSetup(setup.serializeSetup(value));
    assert.deepEqual(result.timer, value.timer);
    value.timer.characterDurationMs = 0;
    value.timer.mainDurationMs = 0;
    assert.deepEqual(setup.parseSetup(setup.serializeSetup(value)).timer, value.timer);
});
test("strict timer validation rejects values instead of silently changing them", () => {
    for (const change of [{enabled: "false"}, {preset: "toString"}, {newDuration: 10}, {mainDurationMs: 1}, {mainDurationMs: -1}, {mainDurationMs: "75000"}, {responseDurationMs: 120001}, {characterDurationMs: 30000.5}])
        assert.throws(() => setup.normalizeTimerSettings(Object.assign(setup.normalizeTimerSettings(), change), true));
});
test("JSON round trip preserves the entire configuration and does not mutate input", () => {
    const value = config(8);
    value.districts.basic.manor = 0;
    value.districts.basic.tavern = 25;
    value.districts.unique = setup.uniqueIds.slice();
    value.metadata = {presetId: null, futureLabel: "Test deck"};
    const before = JSON.stringify(value);
    assert.deepEqual(setup.parseSetup(setup.serializeSetup(value)), value);
    assert.equal(JSON.stringify(value), before);
    assert.deepEqual(setup.parseSetup("\uFEFF" + setup.serializeSetup(value)), value);
});
test("a partial basic map excludes omitted cards when imported", () => {
    const value = config(); value.districts.basic = {manor: 2};
    assert.equal(setup.parseSetup(JSON.stringify(value)).districts.basic.tavern, 0);
});
test("structurally valid configurations can be saved below the current minimum", () => {
    const value = config(8); value.districts.basic = {};
    assert.doesNotThrow(() => setup.parseSetup(setup.serializeSetup(value)));
    assert.ok(setup.getStartErrors(value, 8).length);
});
test("malformed, incompatible and oversized files are rejected", () => {
    for (const text of ["{", "null", "[]", "", " ".repeat(setup.MAX_FILE_SIZE + 1)])
        assert.throws(() => setup.parseSetup(text));
    for (const change of [{version: 2}, {format: "other-game"}, {rules: {unknown: 2}}, {characters: []}, {timer: null}, {districts: {unique: []}}, {metadata: []}])
        assert.throws(() => setup.parseSetup(JSON.stringify(Object.assign(config(), change))));
});

test("old files receive starting defaults and the automatic city size", () => {
    const value = config(); delete value.starting; delete value.rules;
    const parsed = setup.parseSetup(JSON.stringify(value));
    assert.deepEqual(parsed.starting, {handSize: 4, minUnique: 0, gold: 2, exactUnique: false, firstCrownReduction: {cards: 0, gold: 0}});
    assert.deepEqual(parsed.rules, {citySize: null, bonuses: {firstCity: 4, otherCities: 2, allColors: 3}, preventRepeatedRandomDiscard: false, duplicateLimit: 0, diplomatCompleteCity: false, magistrateOverLimit: false});
    assert.deepEqual([2,3,4,5,6,7,8].map(players => setup.getCitySize(players)), [7,8,7,7,7,7,7]);
    for (const citySize of [2,10])
        assert.deepEqual([2,3,8].map(players => setup.getCitySize(players, {citySize})), [citySize,citySize,citySize]);
});
test("custom starting settings and city size round-trip without changing the input", () => {
    const value = config(); value.starting = setup.normalizeStarting({handSize: 6, minUnique: 2, gold: 0}); value.rules.citySize = 10;
    const before = JSON.stringify(value);
    assert.deepEqual(setup.parseSetup(setup.serializeSetup(value)), value);
    assert.equal(JSON.stringify(value), before);
});
test("invalid starting settings and city sizes fail instead of being clamped", () => {
    for (const field of ['handSize','minUnique','gold'])
        for (const bad of [-1, .5, NaN, Infinity, '2', null, true, Number.MAX_SAFE_INTEGER + 1])
            assert.throws(() => setup.normalizeStarting({[field]: bad}));
    for (const value of [null, [], {extra: 0}, {handSize: 0, minUnique: 1}])
        assert.throws(() => setup.normalizeStarting(value));
    for (const value of [null, [], {extra: 0}, ...[0,1,11,2.5,'7',undefined].map(citySize => ({citySize}))])
        assert.throws(() => setup.normalizeRules(value));
    assert.deepEqual(setup.normalizeStarting({handSize: 0, minUnique: 0, gold: 0}), {handSize: 0, minUnique: 0, gold: 0, exactUnique: false, firstCrownReduction: {cards: 0, gold: 0}});
});
test("an incompatible imported character is preserved and gets a named start error", () => {
    const value = config(3); value.characters[8] = '9_2'; value.characters[3] = '4_2';
    const imported = setup.parseSetup(JSON.stringify(value));
    assert.deepEqual(imported.characters, value.characters);
    assert.ok(setup.getStartErrors(imported, 2).some(message => /Королева.*5.*2/.test(message)));
    assert.ok(setup.getStartErrors(imported, 2).some(message => /Император.*3.*2/.test(message)));
    assert.deepEqual(setup.getStartErrors(imported, 5), []);
    assert.deepEqual(imported.characters, value.characters);
    const withoutNine = config(4);
    assert.ok(setup.getStartErrors(withoutNine, 3).some(message => /ранга 9/.test(message)));
});
test("start validation uses hand size, reserved specials and custom city size", () => {
    const value = config(2); value.districts.basic = {manor: 3, castle: 3}; value.rules.citySize = 2;
    assert.ok(setup.getStartErrors(value, 2).some(message => /раздачи/.test(message)));
    value.starting.handSize = 3;
    assert.deepEqual(setup.getStartErrors(value, 2), []);
    value.starting.minUnique = 1;
    assert.ok(setup.getStartErrors(value, 2).some(message => /особых кварталов/.test(message)));
    value.districts.unique = ['library', 'stable'];
    assert.deepEqual(setup.getStartErrors(value, 2), []);
    value.rules.citySize = 10;
    assert.ok(setup.getStartErrors(value, 2).some(message => /минимум 20/.test(message)));
    assert.ok(setup.getStartErrors(value, 2).some(message => /вместимость.*10/.test(message)));
    value.starting.handSize = Number.MAX_SAFE_INTEGER;
    assert.ok(setup.getStartErrors(value, 2).some(message => /раздачи/.test(message)));
});

for (const {id, name, minimum} of [
    {id: "4_2", name: "Император", minimum: 3},
    {id: "9_2", name: "Королева", minimum: 5},
    {id: "9_1", name: "Скульптор", minimum: 3},
    {id: "9_3", name: "Мытарь", minimum: 3}
]) {
    test(name + " is preserved on import and allowed at the exact player threshold", () => {
        const value = config(minimum);
        const rank = Number(id.split("_")[0]);
        value.characters[rank - 1] = id;
        const imported = setup.parseSetup(setup.serializeSetup(value));
        const before = JSON.stringify(imported);
        const errors = setup.getStartErrors(imported, minimum - 1);
        assert.ok(errors.some(error => error.includes(name) && error.includes("минимум " + minimum)));
        assert.deepEqual(setup.getStartErrors(imported, minimum), []);
        assert.equal(JSON.stringify(imported), before);
        assert.equal(imported.characters[rank - 1], id);
    });
}

test("Theater survives JSON normalization but prevents starting with fewer than four players", () => {
    const value = config(4);
    value.districts.unique = ["theater"];
    value.districts.basic.manor++; // Enough cards for the eight-player boundary too.
    const imported = setup.parseSetup(setup.serializeSetup(value));
    const before = JSON.stringify(imported);
    for (const players of [2, 3])
        assert.ok(setup.getStartErrors(imported, players).some(error => error.includes("Театр")));
    for (const players of [4, 5, 6, 7])
        assert.deepEqual(setup.getStartErrors(imported, players), []);
    imported.characters.push("9_1");
    assert.deepEqual(setup.getStartErrors(imported, 8), []);
    imported.characters.pop();
    assert.equal(JSON.stringify(imported), before);
    assert.deepEqual(imported.districts.unique, ["theater"]);
});

test("exact mode is optional in old JSON and survives round trips when explicitly set", () => {
    const old = config(); delete old.starting.exactUnique;
    assert.equal(setup.parseSetup(JSON.stringify(old)).starting.exactUnique, false);
    for (const exactUnique of [false, true]) {
        const value = config(); value.starting.exactUnique = exactUnique;
        const before = JSON.stringify(value);
        assert.deepEqual(setup.parseSetup(setup.serializeSetup(value)), value);
        assert.equal(JSON.stringify(value), before);
    }
});

test("exact special mode requires a boolean instead of truthy coercion", () => {
    for (const exactUnique of [null, undefined, 0, 1, "true", "false", [], {}])
        assert.throws(() => setup.normalizeStarting({exactUnique}), /логическое значение/);
    assert.equal(setup.normalizeStarting({exactUnique: true}).exactUnique, true);
    assert.equal(setup.normalizeStarting().exactUnique, false);
});

test("start validation distinguishes total-card sufficiency from basic-card sufficiency", () => {
    const value = config(4);
    value.rules.citySize = 2;
    value.districts.basic = {};
    value.districts.unique = setup.uniqueIds.slice();
    value.starting = {handSize: 4, minUnique: 1, gold: 2, exactUnique: false};
    assert.deepEqual(setup.getStartErrors(value, 4), []);
    value.starting.exactUnique = true;
    assert.ok(setup.getStartErrors(value, 4).some(error => /базовых.*12.*0/.test(error)));
    value.districts.basic = {manor: 12};
    assert.deepEqual(setup.getStartErrors(value, 4), []);
    value.districts.basic.manor--;
    assert.ok(setup.getStartErrors(value, 4).some(error => /базовых/.test(error)));
});
