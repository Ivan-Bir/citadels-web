"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const setup = require("../public/setup");
const utils = require("../utils");
const card = type => ({type, kind: setup.districts[type].type, cost: setup.districts[type].cost});

test("expansion catalog supplies fifteen opt-in districts while the standard deck stays unchanged", () => {
    const expected = {
        stone_bridge: [0, 3, 0], catacombs: [9, 2, 1], architects_workshop: [9, 5, 1],
        wine_cellar: [9, 3, 1], mirror_hall: [9, 6, 1], conspirators_house: [9, 6, 1],
        divination_tower: [9, 4, 1], artisans_court: [9, 4, 1], judicial_chamber: [9, 3, 1],
        seminary: [5, 4, 0], sloboda: [4, 6, 0], exchange: [6, 6, 0],
        papal_residence: [5, 6, 0], citadel: [8, 6, 0], flea_market: [9, 2, 1]
    };
    assert.equal(Object.keys(setup.districts).length, 62);
    assert.equal(setup.basicIds.length, 23);
    assert.equal(setup.uniqueIds.length, 39);
    for (const [id, values] of Object.entries(expected)) {
        const district = setup.districts[id];
        assert.deepEqual([district.type, district.cost, district.quantity], values, id);
        assert.ok(district.name.length > 0, id);
        if (id !== "flea_market") assert.match(district.image, /^\/citadels\/cards\/placeholders\/d\d\d-.+\.svg$/);
    }
    assert.equal(setup.districts.flea_market.description, "Раз в свой ход можете сбросить 1 карту из руки, чтобы взять 1 карту из колоды.");
    assert.ok(setup.groups.some(group => group.type === 0 && group.name === "Без типа"));
    const standard = setup.getDefaultSetup();
    assert.equal(setup.getDeckSummary(standard.districts.basic, standard.districts.unique).total, 65);
    assert.ok(Object.keys(expected).every(id => !standard.districts.unique.includes(id)));
    assert.deepEqual(utils.createDeck(4, ["catacombs"], false, {stone_bridge: 2, seminary: 1})
        .map(value => [value.type, value.kind, value.cost]).sort(),
        [["catacombs", 9, 2], ["seminary", 5, 4], ["stone_bridge", 0, 3], ["stone_bridge", 0, 3]]);
});
test("building payment combines the card's lasting discount and every existing Factory without changing nominal cost", () => {
    const city = [card("factory"), card("factory")];
    const discounted = {...card("library"), buildDiscount: 1};
    assert.equal(setup.getBuildCost(city, discounted), 3);
    assert.equal(setup.getBuildCost(city, {...discounted, buildDiscount: 9}), 0);
    assert.equal(setup.getBuildCost(city, card("factory")), 3);
    assert.equal(setup.getBuildCost([], card("factory")), 5);
    assert.equal(setup.getBuildCost(city, card("stone_bridge")), 3);
    assert.equal(setup.getBuildCost(city, {...card("stone_bridge"), buildDiscount: 1}), 2);
    assert.equal(setup.getBuildCost(city, {type: "library", cost: 6, buildDiscount: 1}), 3);
    assert.equal(setup.getDistrictType({type: "library", kind: 0}), 0);
    assert.equal(setup.getDistrictType({type: "library"}), 9);
    assert.equal(discounted.cost, 6);
    assert.equal(discounted.buildDiscount, 1);
    assert.equal(setup.countDistricts(city, "factory"), 2);
});
test("city size counts each Monument twice and never counts Catacombs", () => {
    const city = ["monument", "monument", "catacombs", "catacombs", "stone_bridge", "sloboda"].map(card);
    assert.equal(setup.getCityDistrictCount(city), 6);
    assert.equal(setup.getCityDistrictCount([]), 0);
    assert.equal(setup.getCityDistrictCount([card("catacombs")]), 0);
    assert.equal(city.length, 6);
});
test("color income counts independent bonus sources without multiplying city size or ordinary districts", () => {
    const city = ["sloboda", "sloboda", "exchange", "papal_residence", "citadel", "seminary",
        "manor", "school_of_magic", "school_of_magic", "stone_bridge"].map(card);
    assert.deepEqual([4, 5, 6, 8].map(color => setup.getColorIncome(city, color)), [7, 5, 4, 4]);
    assert.equal(setup.getCityDistrictCount(city), 10);
    assert.equal(setup.countDistricts(city, "sloboda"), 2);
    assert.equal(setup.getColorIncome([card("stone_bridge")], 4), 0);
});
test("every Observatory expands the resource choice while Libraries do not", () => {
    assert.equal(setup.getResourceCardCount([]), 2);
    assert.equal(setup.getResourceCardCount(["observatory", "observatory", "library", "library"].map(card)), 4);
});
test("each Great Wall contributes its own rank-eight surcharge", () => {
    assert.equal(setup.getGreatWallCount([]), 0);
    assert.equal(setup.getGreatWallCount(["great_wall", "great_wall", "keep"].map(card)), 2);
});
test("version-one packs default expansion rules and retain explicit settings through export", () => {
    const legacy = setup.getDefaultSetup(4);
    delete legacy.rules.duplicateLimit;
    delete legacy.rules.diplomatCompleteCity;
    delete legacy.rules.magistrateOverLimit;
    const restored = setup.parseSetup(JSON.stringify(legacy));
    assert.equal(restored.rules.duplicateLimit, 0);
    assert.equal(restored.rules.diplomatCompleteCity, false);
    assert.equal(restored.rules.magistrateOverLimit, false);
    restored.rules.duplicateLimit = 2;
    restored.rules.diplomatCompleteCity = true;
    restored.rules.magistrateOverLimit = true;
    assert.deepEqual(setup.parseSetup(setup.serializeSetup(restored)), restored);
    for (const bad of [-1, .5, NaN, Infinity, "1", null, true, undefined, Number.MAX_SAFE_INTEGER + 1])
        assert.throws(() => setup.normalizeRules({duplicateLimit: bad}));
    for (const field of ["diplomatCompleteCity", "magistrateOverLimit"])
        for (const bad of [null, undefined, "false", 0, 1, [], {}])
            assert.throws(() => setup.normalizeRules({[field]: bad}));
    assert.equal(setup.normalizeRules({duplicateLimit: Number.MAX_SAFE_INTEGER}).duplicateLimit, Number.MAX_SAFE_INTEGER);
    assert.throws(() => setup.normalizeRules({creatorMode: true}), /неизвестное поле/);
});
test("duplicate allowance counts additional copies and validates the receiving city after an outgoing exchange", () => {
    const city = ["tavern", "tavern", "quarry"].map(card);
    assert.equal(setup.canAddDistrict(city, "tavern", {duplicateLimit: 1}), false);
    assert.equal(setup.canAddDistrict(city, "tavern", {duplicateLimit: 2}), true);
    assert.equal(setup.canAddDistrict(city, "tavern", {duplicateLimit: 0}), false);
    assert.equal(setup.canAddDistrict(city, "manor", {duplicateLimit: 0}), true);
    assert.equal(setup.canAddDistrict(city, "tavern", {duplicateLimit: 0}, {ignoreLimit: true}), true);
    assert.equal(setup.canAddDistrict(city, "tavern", {duplicateLimit: 0}, {removeIndex: 0}), true);
    assert.equal(setup.canAddDistrict(city, "tavern", {duplicateLimit: 0}, {removeIndex: 2}), false);
    assert.equal(setup.canAddDistrict([], "tavern"), true);
    assert.equal(setup.canAddDistrict([card("tavern")], "tavern"), false);
    assert.equal(city.length, 3);
});
test("restricted districts survive structural import and both report their player requirements before start", () => {
    const value = setup.getDefaultSetup(4);
    value.districts.unique = ["theater", "conspirators_house"];
    const imported = setup.parseSetup(setup.serializeSetup(value));
    assert.deepEqual(imported.districts.unique, ["theater", "conspirators_house"]);
    for (const players of [2, 3]) {
        const errors = setup.getStartErrors(imported, players);
        assert.ok(errors.some(error => /Театр/.test(error)));
        assert.ok(errors.some(error => /Дом заговорщиков/.test(error)));
        assert.throws(() => utils.createDeck(players, ["conspirators_house"]), /Дом заговорщиков/);
    }
    assert.deepEqual(setup.getStartErrors(imported, 4), []);
    assert.equal(utils.createDeck(4, ["conspirators_house"]).length, 55);
});
test("start capacity respects duplicate allowance and available physical copies", () => {
    const value = setup.getDefaultSetup(2);
    value.districts = {basic: {tavern: 4, manor: 4}, unique: []};
    value.rules.citySize = 4;
    value.rules.duplicateLimit = 1;
    assert.deepEqual(setup.getStartErrors(value, 2), []);
    value.rules.duplicateLimit = 0;
    assert.ok(setup.getStartErrors(value, 2).some(error => /вместимость/.test(error)));
    value.rules.duplicateLimit = 1;
    value.districts.basic = {tavern: 99, manor: 1};
    assert.ok(setup.getStartErrors(value, 2).some(error => /вместимость/.test(error)));
    value.rules.duplicateLimit = Number.MAX_SAFE_INTEGER;
    assert.deepEqual(setup.getStartErrors(value, 2), []);
});
test("creator readiness accepts a future compatible composition and rejects packs with no possible start", () => {
    const value = setup.getDefaultSetup(4);
    value.characters.push("9_2");
    value.districts.unique.push("theater", "conspirators_house");
    const before = JSON.stringify(value);
    assert.ok(setup.getStartErrors(value, 2).length > 0);
    assert.deepEqual(setup.getCreatorErrors(value), []);
    assert.equal(JSON.stringify(value), before);
    value.districts = {basic: {manor: 1}, unique: []};
    assert.ok(setup.getCreatorErrors(value).some(error => /раздачи|вместимость|Недостаточно карт/.test(error)));
    value.characters[1] = "1_2";
    assert.ok(setup.getCreatorErrors(value).some(error => /по одному персонажу/.test(error)));
});
test("Catacombs and Secret Vault cannot fill a missing city position during start validation", () => {
    const value = setup.getDefaultSetup(2);
    value.districts = {basic: {tavern: 20}, unique: ["catacombs", "secret_vault"]};
    value.rules.citySize = 2;
    assert.ok(setup.getStartErrors(value, 2).some(error => /вместимость/.test(error)));
    value.districts.unique.push("library");
    assert.deepEqual(setup.getStartErrors(value, 2), []);
});
test("Monument supplies two city positions only when an ordinary final district remains possible", () => {
    const value = setup.getDefaultSetup(2);
    value.districts = {basic: {tavern: 20}, unique: ["monument"]};
    value.rules.citySize = 3;
    assert.deepEqual(setup.getStartErrors(value, 2), []);
    value.rules.citySize = 2;
    assert.ok(setup.getStartErrors(value, 2).some(error => /вместимость/.test(error)));
    value.rules.citySize = 4;
    value.districts.unique.push("catacombs");
    assert.ok(setup.getStartErrors(value, 2).some(error => /вместимость/.test(error)));
    value.districts.basic.manor = 1;
    assert.deepEqual(setup.getStartErrors(value, 2), []);
});
test("Quarry and Wizard preserve their construction exceptions in static city capacity", () => {
    const value = setup.getDefaultSetup(2);
    value.districts = {basic: {tavern: 20}, unique: ["quarry"]};
    value.rules.citySize = 7;
    assert.deepEqual(setup.getStartErrors(value, 2), []);
    value.districts.unique = [];
    assert.ok(setup.getStartErrors(value, 2).some(error => /вместимость/.test(error)));
    value.characters[2] = "3_2";
    assert.deepEqual(setup.getStartErrors(value, 2), []);
    value.districts.basic.tavern = 1;
    assert.ok(setup.getStartErrors(value, 2).some(error => /вместимость/.test(error)));
});
test("legacy active districts have catalog names for choosing individual instances", () => {
    assert.deepEqual(["framework", "museum", "laboratory", "arsenal", "forgery"].map(id => setup.districts[id].name),
        ["Строительные леса", "Музей", "Лаборатория", "Оружейная", "Кузница"]);
    assert.ok(setup.uniqueIds.every(id => typeof setup.districts[id].name === "string" && setup.districts[id].name.length > 0));
});