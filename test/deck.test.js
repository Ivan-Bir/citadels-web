"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const setup = require("../public/setup");
const {createDeck, dealStartingHands, drawDistrictCards, discardDistrictCards} = require("../utils");

for (const players of [2,3,4,5,6,7,8]) {
    test("starting hands reserve specials for every one of " + players + " players", () => {
        const unique = setup.uniqueIds.filter(id => !["theater", "conspirators_house"].includes(id)).slice(0, players * 2);
        const deck = createDeck(players, unique), all = deck.slice();
        const hands = dealStartingHands(deck, players, {handSize: 5, minUnique: 2});
        assert.equal(hands.length, players);
        hands.forEach(hand => {
            assert.equal(hand.length, 5);
            assert.equal(hand.filter(card => card.kind === 9).length, 2);
        });
        const after = hands.flat().concat(deck);
        assert.equal(after.length, all.length);
        assert.equal(new Set(after).size, all.length);
        all.forEach(card => assert.ok(after.includes(card)));
    });
}
test("zero minimum allows extra specials and zero hand size consumes nothing", () => {
    const deck = createDeck(4, setup.uniqueIds, true);
    const hands = dealStartingHands(deck, 4, {handSize: 4, minUnique: 0});
    hands.forEach(hand => assert.equal(hand.filter(card => card.kind === 9).length, 4));
    const before = deck.slice();
    assert.deepEqual(dealStartingHands(deck, 4, {handSize: 0}), [[],[],[],[]]);
    assert.deepEqual(deck, before);
});
test("impossible or malformed deals do not alter the deck", () => {
    for (const starting of [{handSize: 99}, {handSize: 4, minUnique: 1}, {handSize: -1}, {gold: -1}]) {
        const deck = createDeck(4, []), before = deck.slice();
        assert.throws(() => dealStartingHands(deck, 4, starting));
        assert.deepEqual(deck, before);
    }
});
test("discard is separate, is consumed on reshuffle, and a draw crosses the boundary", () => {
    const a = {id: 'top'}, b = {id: 'b'}, c = {id: 'c'}, d = {id: 'd'};
    const state = {districtDeck: [a], districtDiscard: []};
    const rejected = [b,c,d];
    discardDistrictCards(state, rejected);
    assert.deepEqual(rejected, []);
    assert.deepEqual(state.districtDeck, [a]);
    const drawn = drawDistrictCards(state, 3);
    assert.equal(drawn[0], a);
    assert.equal(drawn.length, 3);
    assert.equal(state.districtDeck.length, 1);
    assert.deepEqual(state.districtDiscard, []);
    assert.deepEqual(new Set(drawn.concat(state.districtDeck)), new Set([a,b,c,d]));
});
test("draws stop safely when both piles are empty and do not recycle eagerly", () => {
    const a = {}, b = {};
    const state = {districtDeck: [a], districtDiscard: [b]};
    assert.deepEqual(drawDistrictCards(state, 0), []);
    assert.deepEqual(drawDistrictCards(state, 1), [a]);
    assert.deepEqual(state.districtDiscard, [b]);
    assert.deepEqual(drawDistrictCards(state, 100), [b]);
    assert.deepEqual(drawDistrictCards(state, 2), []);
    for (const value of [-1, NaN, Infinity, .5, '2'])
        assert.throws(() => drawDistrictCards(state, value));
});

test("omitted starting settings deal four cards per player without shared hands", () => {
    const deck = createDeck(2, []), original = deck.slice();
    const hands = dealStartingHands(deck, 2);
    assert.deepEqual(hands.map(hand => hand.length), [4, 4]);
    assert.notStrictEqual(hands[0], hands[1]);
    assert.equal(deck.length, original.length - 8);
    const remaining = hands.flat().concat(deck);
    assert.equal(remaining.length, original.length);
    assert.deepEqual(new Set(remaining), new Set(original));
});

test("a full guaranteed special hand leaves all basic cards in the deck", () => {
    const deck = createDeck(2, ["library", "museum", "park", "stable"]);
    const basic = deck.filter(card => card.kind !== 9);
    const special = deck.filter(card => card.kind === 9);
    const starting = Object.freeze({handSize: 2, minUnique: 2, gold: 0});
    const hands = dealStartingHands(deck, 2, starting);
    assert.deepEqual(hands.map(hand => hand.length), [2, 2]);
    assert.ok(hands.every(hand => hand.every(card => card.kind === 9)));
    assert.deepEqual(new Set(hands.flat()), new Set(special));
    assert.deepEqual(deck, basic);
});

test("a deal can consume the exact available number of cards", () => {
    const deck = createDeck(2, ["library", "museum"], false, {manor: 2, tavern: 2});
    const original = deck.slice();
    const hands = dealStartingHands(deck, 2, {handSize: 3, minUnique: 1});
    assert.deepEqual(hands.map(hand => hand.length), [3, 3]);
    assert.ok(hands.every(hand => hand.filter(card => card.kind === 9).length === 1));
    assert.deepEqual(deck, []);
    assert.equal(hands.flat().length, original.length);
    assert.deepEqual(new Set(hands.flat()), new Set(original));
});

test("being one special card short rejects the deal before consuming any cards", () => {
    const deck = createDeck(2, ["library", "museum", "park"]);
    const original = deck.slice();
    assert.throws(() => dealStartingHands(deck, 2, {handSize: 4, minUnique: 2}), /Недостаточно карт/);
    assert.deepEqual(deck, original);
});

test("invalid player counts leave a populated deck untouched", () => {
    for (const players of [undefined, null, 0, 1, 9, -1, 2.5, "2", NaN, Infinity]) {
        const deck = createDeck(2, []), original = deck.slice();
        assert.throws(() => dealStartingHands(deck, players), /от 2 до 8/);
        assert.deepEqual(deck, original);
    }
});

test("zero-card deals produce separate empty hands even with an empty deck", () => {
    const deck = [];
    const hands = dealStartingHands(deck, 8, {handSize: 0, minUnique: 0});
    assert.equal(hands.length, 8);
    assert.ok(hands.every(hand => Array.isArray(hand) && hand.length === 0));
    assert.equal(new Set(hands).size, 8);
    assert.deepEqual(deck, []);
});

test("discard appends existing card objects, consumes its source and is safe to repeat", () => {
    const top = {id: "top"}, previous = {id: "previous"};
    const first = {id: "first"}, second = {id: "second"};
    const state = {districtDeck: [top], districtDiscard: [previous]};
    const cards = [first, second];
    discardDistrictCards(state, cards);
    assert.deepEqual(cards, []);
    assert.deepEqual(state.districtDeck, [top]);
    assert.equal(state.districtDiscard.length, 3);
    assert.strictEqual(state.districtDiscard[0], previous);
    assert.strictEqual(state.districtDiscard[1], first);
    assert.strictEqual(state.districtDiscard[2], second);
    discardDistrictCards(state, cards);
    discardDistrictCards(state, []);
    assert.deepEqual(state.districtDiscard, [previous, first, second]);
});

test("invalid draw counts do not alter either populated pile", () => {
    for (const count of [-1, .5, NaN, Infinity, "2", null, undefined, true, Number.MAX_SAFE_INTEGER + 1]) {
        const state = {districtDeck: [{id: "top"}], districtDiscard: [{id: "discard"}]};
        const deck = state.districtDeck.slice(), discard = state.districtDiscard.slice();
        assert.throws(() => drawDistrictCards(state, count), /количество карт/);
        assert.deepEqual(state.districtDeck, deck);
        assert.deepEqual(state.districtDiscard, discard);
    }
});

test("drawing zero cards does not recycle a discard into an empty deck", () => {
    const discarded = {id: "discard"};
    const state = {districtDeck: [], districtDiscard: [discarded]};
    assert.deepEqual(drawDistrictCards(state, 0), []);
    assert.deepEqual(state.districtDeck, []);
    assert.strictEqual(state.districtDiscard[0], discarded);
    assert.equal(state.districtDiscard.length, 1);
});

test("drawing from a nonempty deck preserves its order and leaves the discard alone", () => {
    const cards = Array.from({length: 5}, (_, id) => ({id}));
    const state = {districtDeck: cards.slice(0, 4), districtDiscard: cards.slice(4)};
    const drawn = drawDistrictCards(state, 2);
    assert.strictEqual(drawn[0], cards[0]);
    assert.strictEqual(drawn[1], cards[1]);
    assert.deepEqual(state.districtDeck, cards.slice(2, 4));
    assert.deepEqual(state.districtDiscard, cards.slice(4));
});

test("repeated draw and discard cycles neither clone nor lose cards", () => {
    const cards = Array.from({length: 12}, (_, id) => ({id}));
    const state = {districtDeck: cards.slice(0, 5), districtDiscard: cards.slice(5)};
    for (const count of [3, 7, 12, 20, 1, 12]) {
        const hand = drawDistrictCards(state, count);
        assert.equal(hand.length, Math.min(count, cards.length));
        const all = hand.concat(state.districtDeck, state.districtDiscard);
        assert.equal(all.length, cards.length);
        assert.deepEqual(new Set(all), new Set(cards));
        discardDistrictCards(state, hand);
        assert.deepEqual(hand, []);
        const stored = state.districtDeck.concat(state.districtDiscard);
        assert.equal(stored.length, cards.length);
        assert.deepEqual(new Set(stored), new Set(cards));
    }
});

for (const players of [2, 3, 8]) {
    for (const fixedCount of [0, 1, 3]) {
        test("exact special count " + fixedCount + " for " + players + " players preserves every card", () => {
            const deck = createDeck(players, setup.uniqueIds.filter(id => !["theater", "conspirators_house"].includes(id)));
            // Put excess specials first so unrestricted filling cannot accidentally pass.
            deck.sort((a, b) => Number(b.kind === 9) - Number(a.kind === 9));
            const original = deck.slice();
            const specials = original.filter(card => card.kind === 9).length;
            const hands = dealStartingHands(deck, players, {handSize: 3, minUnique: fixedCount, exactUnique: true});
            hands.forEach(hand => {
                assert.equal(hand.length, 3);
                assert.equal(hand.filter(card => card.kind === 9).length, fixedCount);
            });
            assert.equal(deck.filter(card => card.kind === 9).length, specials - players * fixedCount);
            const all = hands.flat().concat(deck);
            assert.equal(all.length, original.length);
            assert.deepEqual(new Set(all), new Set(original));
        });
    }
}

test("exact dealing rejects a shortage of basic cards atomically even with ample specials", () => {
    const deck = createDeck(2, setup.uniqueIds.filter(id => !["theater", "conspirators_house"].includes(id)), false, {manor: 5});
    const before = deck.slice();
    assert.throws(() => dealStartingHands(deck, 2, {handSize: 4, minUnique: 1, exactUnique: true}), /базовых/);
    assert.deepEqual(deck, before);
    assert.doesNotThrow(() => dealStartingHands(deck, 2, {handSize: 4, minUnique: 1, exactUnique: false}));
});

test("exact mode accepts an empty starting hand and an exact basic-card boundary", () => {
    const deck = createDeck(2, ["museum", "library", "park"], false, {manor: 4});
    const before = deck.slice();
    assert.deepEqual(dealStartingHands(deck, 2, {handSize: 0, minUnique: 0, exactUnique: true}), [[], []]);
    assert.deepEqual(deck, before);
    const hands = dealStartingHands(deck, 2, {handSize: 3, minUnique: 1, exactUnique: true});
    assert.ok(hands.every(hand => hand.length === 3 && hand.filter(card => card.kind === 9).length === 1));
    assert.equal(deck.length, 1);
    assert.equal(deck[0].kind, 9);
});

test("exact dealing still rejects a shortage of special cards before changing the deck", () => {
    const deck = createDeck(2, ["museum"]), before = deck.slice();
    assert.throws(() => dealStartingHands(deck, 2, {handSize: 3, minUnique: 1, exactUnique: true}), /Недостаточно карт/);
    assert.deepEqual(deck, before);
});
