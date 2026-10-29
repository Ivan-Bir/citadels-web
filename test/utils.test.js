"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {shuffle, createDeck, getUniqueDistricts, districts} = require("../utils");

test("shuffle preserves object references and repeated occurrences", () => {
    const first = Object.freeze({id: "first"}), second = Object.freeze({id: "second"});
    const cards = [first, second, first, null, null];
    assert.strictEqual(shuffle(cards), cards);
    assert.equal(cards.filter(card => card === first).length, 2);
    assert.equal(cards.filter(card => card === second).length, 1);
    assert.equal(cards.filter(card => card === null).length, 2);
    assert.equal(cards.length, 5);
});

test("shuffle can produce both orders of two cards with controlled randomness", t => {
    let random = 0;
    t.mock.method(Math, "random", () => random);
    const first = {id: "first"}, second = {id: "second"};
    assert.deepEqual(shuffle([first, second]), [second, first]);
    random = 1 - Number.EPSILON;
    assert.deepEqual(shuffle([first, second]), [first, second]);
});

test("unique district lists are independent copies containing only special cards", () => {
    const first = getUniqueDistricts(), second = getUniqueDistricts();
    assert.notStrictEqual(first, second);
    assert.equal(first.length, 39);
    assert.equal(new Set(first).size, first.length);
    assert.ok(first.includes("theater"));
    assert.ok(first.includes("secret_vault"));
    assert.ok(first.every(id => districts[id] && districts[id].type === 9));
    const original = second.slice();
    first.reverse();
    first.pop();
    first.push("manor");
    assert.deepEqual(second, original);
    assert.deepEqual(getUniqueDistricts(), original);
});

test("explicitly empty basic counts produce an empty deck without selected specials", () => {
    assert.deepEqual(createDeck(2, [], false, {}), []);
    assert.deepEqual(createDeck(2, [], false, {manor: 0, tavern: 0}), []);
    assert.equal(createDeck(2, []).length, 54);
});

test("onlyFilter ignores base counts and preserves the selected special list", () => {
    const selected = Object.freeze(["museum", "library"]);
    const counts = Object.freeze({manor: 99});
    const deck = createDeck(4, selected, true, counts);
    assert.deepEqual(deck.map(card => card.type).sort(), ["library", "museum"]);
    assert.ok(deck.every(card => card.kind === 9));
    assert.deepEqual(createDeck(4, [], true, counts), []);
});

test("separate deck builds and duplicate copies never share mutable cards", () => {
    const selected = Object.freeze(["library"]);
    const counts = Object.freeze({manor: 3});
    const first = createDeck(4, selected, false, counts);
    const second = createDeck(4, selected, false, counts);
    assert.equal(first.length, 4);
    assert.equal(new Set(first.concat(second)).size, 8);
    const manor = first.find(card => card.type === "manor");
    manor.cost = 100;
    manor.decoration = true;
    first.find(card => card.type === "library").exposition = [{type: "temple"}];
    assert.ok(first.filter(card => card !== manor && card.type === "manor").every(card => card.cost === 3 && !card.decoration));
    assert.ok(second.filter(card => card.type === "manor").every(card => card.cost === 3 && !card.decoration));
    assert.equal(second.find(card => card.type === "library").exposition, undefined);
    assert.deepEqual(counts, {manor: 3});
    assert.deepEqual(selected, ["library"]);
});
