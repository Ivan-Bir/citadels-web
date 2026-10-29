'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {playingRoom, district} = require('../test-support/game.cjs');

function fixture() {
    const result = playingRoom();
    const {game, messages} = result;
    for (const slot of Object.keys(game.state.players)) {
        game.state.players[slot].hand = [];
        game.state.players[slot].action = null;
        game.state.players[slot].choose = null;
        game.state.players[slot].chooseSource = null;
        game.room.playerHand[slot] = 0;
        game.room.playerDistricts[slot] = [];
        game.room.playerGold[slot] = 20;
    }
    game.room.turnId = 5;
    game.room.buildDistricts = 3;
    game.state.alchemistCoins = 0;
    game.room.playerDistricts[0] = [district('flea_market')];
    setHand(game, [district('manor')]);
    game.state.districtDeck = [district('church'), district('temple'), district('market')];
    game.state.districtDiscard = [];
    messages.length = 0;
    return result;
}
function setHand(game, cards, slot = 0) {
    game.state.players[slot].hand = cards;
    game.room.playerHand[slot] = cards.length;
}
const exchange = (game, cardIndex = 0, sourceIndex = 0, slot = 0) =>
    game.slotEventHandlers['flea-market-action'](slot, cardIndex, sourceIndex);
const snapshot = game => JSON.stringify(game.getSnapshot());

function assertRejected(setup, invoke = game => exchange(game)) {
    const {game, messages} = fixture();
    setup(game);
    const before = snapshot(game);
    invoke(game);
    assert.equal(snapshot(game), before);
    assert.equal(messages.length, 0);
}

test('Flea Market moves the chosen card before one private draw without spending gold, resources or builds', () => {
    const {game, messages} = fixture();
    const chosen = {...district('secret_vault'), buildDiscount: 2};
    const next = {...district('church'), buildDiscount: 1};
    setHand(game, [district('manor'), chosen]);
    game.state.districtDeck = [next, district('temple')];
    game.room.playerGold[0] = 0;
    exchange(game, 1);
    assert.equal(game.state.districtDiscard[0], chosen);
    assert.equal(game.state.players[0].hand[1], next);
    assert.equal(game.room.playerHand[0], 2);
    assert.equal(game.room.playerGold[0], 0);
    assert.equal(game.room.tookResource, false);
    assert.equal(game.room.buildDistricts, 3);
    assert.equal(game.state.alchemistCoins, 0);
    assert.equal(game.room.playerDistricts[0].length, 1);
    assert.equal(game.room.playerDistricts[0][0].actionsUsed.flea_market, 5);
    assert.equal(game.room.districtDeckCount, 1);
    assert.equal(game.room.districtDiscardCount, 1);
    assert.equal(game.room.playerScore[0], 2);
    const publicState = messages.find(message => message.event === 'state').data;
    assert.equal(publicState.districtDeck, undefined);
    assert.equal(publicState.districtDiscard, undefined);
    assert.equal(publicState.hand, undefined);
    const privateStates = messages.filter(message => message.event === 'player-state');
    assert.equal(privateStates.length, 1);
    assert.equal(privateStates[0].target, 'host');
    assert.deepEqual(privateStates[0].data.hand, game.state.players[0].hand);
    const before = snapshot(game);
    exchange(game);
    assert.equal(snapshot(game), before);
    game.slotEventHandlers['take-resources'](0, 'coins');
    assert.equal(game.room.playerGold[0], 2);
    assert.equal(game.room.tookResource, true);
});

test('Flea Market rejects invalid hand and source indexes atomically, including omitted indexes', () => {
    for (const bad of [undefined, null, '0', -1, .5, NaN, Infinity, true, {}, [], 99]) {
        assertRejected(() => {}, game => game.slotEventHandlers['flea-market-action'](0, bad, 0));
        assertRejected(() => {}, game => game.slotEventHandlers['flea-market-action'](0, 0, bad));
    }
    assertRejected(game => setHand(game, []));
    assertRejected(game => {game.room.playerDistricts[0] = [district('laboratory')];});
    assertRejected(game => {game.room.playerDistricts[1] = game.room.playerDistricts[0]; game.room.playerDistricts[0] = [];});
    assertRejected(game => {game.room.playerDistricts[0][0].actionsUsed = {flea_market: 5};});
});

test('Flea Market rejects foreign turns, non-main phases and mandatory responses atomically', () => {
    assertRejected(game => {game.room.currentPlayer = 1;});
    for (const phase of [0, 1, 1.5, 3]) assertRejected(game => {game.room.phase = phase;});
    for (const action of ['magistrate-open', 'seer-return', 'blackmailed-response', 'blackmailed-open', 'emperor-nores-action'])
        assertRejected(game => {game.state.players[0].action = action;});
    assertRejected(game => {game.room.blackmailed = [game.room.currentCharacter];});
    assertRejected(game => {game.room.witched = game.room.currentCharacter; game.room.witchedstate = 2;});
    assertRejected(game => {
        game.room.phase = 3;
        game.state.players[0].chooseSource = 'districtDeck';
        game.state.players[0].choose = [district('castle')];
    });
});

test('Flea Market works after resources, under a building ban, and despite a completed Wizard stale choice', () => {
    const {game} = fixture();
    game.room.tookResource = true;
    game.room.buildingBan = true;
    game.room.buildDistricts = 0;
    game.room.currentCharacter = '3_2';
    game.state.players[0].action = 'wizard-player-action';
    setHand(game, [district('market')], 1);
    game.slotEventHandlers['wizard-choose-player'](0, 1);
    game.slotEventHandlers['wizard-choose-card'](0, 0);
    assert.ok(game.state.players[0].choose);
    exchange(game);
    assert.equal(game.room.playerDistricts[0][0].actionsUsed.flea_market, 5);
    assert.equal(game.room.playerHand[0], 2);
    assert.equal(game.room.playerGold[0], 20);
    assert.equal(game.room.tookResource, true);
    assert.equal(game.room.buildDistricts, 0);
});

test('Flea Market recycles the entire discard including its own payment and conserves every card', () => {
    const {game} = fixture();
    const chosen = {...district('manor'), buildDiscount: 3};
    const oldDiscard = [district('temple'), district('market')];
    setHand(game, [chosen]);
    game.state.districtDeck = [];
    game.state.districtDiscard = oldDiscard.slice();
    exchange(game);
    const remaining = [...game.state.players[0].hand, ...game.state.districtDeck, ...game.state.districtDiscard];
    assert.equal(remaining.length, 3);
    assert.equal(new Set(remaining).size, 3);
    for (const card of [chosen, ...oldDiscard]) assert.ok(remaining.includes(card));
    assert.equal(chosen.buildDiscount, 3);
    assert.equal(game.state.districtDeck.length, 2);
    assert.equal(game.state.districtDiscard.length, 0);
});

test('Flea Market with both piles empty returns the exact discarded card and consumes its use', () => {
    const {game} = fixture();
    const chosen = {...district('secret_vault'), buildDiscount: 4};
    setHand(game, [chosen]);
    game.state.districtDeck = [];
    exchange(game);
    assert.equal(game.state.players[0].hand[0], chosen);
    assert.equal(chosen.buildDiscount, 4);
    assert.equal(game.room.playerHand[0], 1);
    assert.equal(game.room.districtDeckCount, 0);
    assert.equal(game.room.districtDiscardCount, 0);
    assert.equal(game.room.playerDistricts[0][0].actionsUsed.flea_market, 5);
    const before = snapshot(game);
    exchange(game);
    assert.equal(snapshot(game), before);
});

test('each Flea Market has its own use; a second character turn of the same player renews both', () => {
    const {game} = fixture();
    game.room.playerDistricts[0].push(district('flea_market'));
    exchange(game);
    exchange(game, 0, 1);
    assert.equal(game.state.districtDiscard.length, 2);
    const before = snapshot(game);
    exchange(game, 0, 1);
    assert.equal(snapshot(game), before);
    game.room.currentCharacter = '7_2';
    game.state.currentIndCharacter = 7;
    game.state.characterRoles = {'7_2': 0, '8_1': 0};
    game.state.players[0].character = ['7_2', '8_1'];
    game.room.playerCharacter[0] = ['7_2', '8_1'];
    game.room.tookResource = true;
    game.slotEventHandlers['end-turn'](0);
    assert.equal(game.room.turnId, 6);
    assert.equal(game.room.currentPlayer, 0);
    assert.equal(game.room.currentCharacter, '8_1');
    exchange(game);
    exchange(game, 0, 1);
    assert.ok(game.room.playerDistricts[0].every(card => card.actionsUsed.flea_market === 6));
});

test('a newly built Flea Market resets old use and combines Factory and permanent discounts', () => {
    const {game} = fixture();
    game.room.playerDistricts[0] = [district('factory')];
    setHand(game, [{...district('flea_market'), buildDiscount: 2, actionsUsed: {flea_market: 5}}, district('manor')]);
    game.slotEventHandlers.build(0, 0);
    const source = game.room.playerDistricts[0][1];
    assert.equal(source.actionsUsed, undefined);
    assert.equal(source.cost, 2);
    assert.equal(source.buildDiscount, 2);
    assert.equal(game.room.playerGold[0], 20);
    exchange(game, 0, 1);
    assert.equal(source.actionsUsed.flea_market, 5);
    assert.equal(game.room.buildDistricts, 2);
});

test('seizing and exchanging Flea Markets preserve current-turn use and permit an unused source immediately', () => {
    for (const usedTurn of [undefined, 4, 5]) {
        for (const event of ['seize-district', 'exchange-districts']) {
            const {game} = fixture();
            const source = district('flea_market');
            if (usedTurn !== undefined) source.actionsUsed = {flea_market: usedTurn};
            game.room.playerDistricts[0] = event === 'exchange-districts' ? [district('temple')] : [];
            game.room.playerDistricts[1] = [source];
            game.state.players[0].action = event === 'seize-district' ? 'marshal-action' : 'diplomat-action';
            if (event === 'seize-district') game.slotEventHandlers[event](0, 1, 0);
            else game.slotEventHandlers[event](0, 0, 1, 0);
            assert.equal(game.room.playerDistricts[0][0], source);
            const before = snapshot(game);
            exchange(game);
            if (usedTurn === 5) assert.equal(snapshot(game), before);
            else assert.equal(source.actionsUsed.flea_market, 5);
        }
    }
});

test('Mirror copies Flea Market use without sharing its state; a fresh exact copy can act immediately', () => {
    for (const usedTurn of [4, 5]) {
        const {game} = fixture();
        game.room.playerDistricts[0] = [];
        const original = {...district('flea_market'), actionsUsed: {flea_market: usedTurn}};
        game.room.playerDistricts[1] = [original];
        setHand(game, [district('mirror_hall'), district('manor')]);
        game.slotEventHandlers['build-mirror'](0, 0, 1, 0);
        const copy = game.room.playerDistricts[0][0];
        assert.equal(copy.type, 'flea_market');
        assert.deepEqual(copy.actionsUsed, original.actionsUsed);
        assert.notEqual(copy.actionsUsed, original.actionsUsed);
        assert.equal(game.room.playerGold[0], 14);
        const before = snapshot(game);
        exchange(game);
        if (usedTurn === 5) assert.equal(snapshot(game), before);
        else assert.equal(copy.actionsUsed.flea_market, 5);
        assert.equal(original.actionsUsed.flea_market, usedTurn);
    }
});

test('snapshot restoration and reconnect preserve an already used Flea Market', () => {
    const {game} = fixture();
    exchange(game);
    const saved = JSON.parse(snapshot(game));
    const restored = fixture().game;
    restored.setSnapshot(saved);
    restored.userJoin({userId: 'host', userName: 'Host'});
    assert.equal(restored.room.playerDistricts[0][0].actionsUsed.flea_market, 5);
    const before = snapshot(restored);
    exchange(restored);
    assert.equal(snapshot(restored), before);
});

test('Libraries and Observatories do not amplify exchange and Workshop discounts stay on their own cards', () => {
    const {game} = fixture();
    game.room.playerDistricts[0].push(...['library', 'library', 'observatory', 'observatory', 'architects_workshop'].map(district));
    game.slotEventHandlers['architects-workshop-action'](0, 5);
    const chosen = game.state.players[0].hand[0];
    assert.equal(chosen.buildDiscount, 1);
    const next = game.state.districtDeck[0];
    exchange(game);
    assert.equal(game.state.players[0].hand.length, 1);
    assert.equal(game.state.players[0].hand[0], next);
    assert.equal(next.buildDiscount, undefined);
    assert.equal(game.state.districtDiscard[0], chosen);
    assert.equal(chosen.buildDiscount, 1);
    assert.equal(game.state.districtDeck.length, 2);
    assert.equal(game.room.phase, 2);
    assert.equal(game.state.players[0].choose, null);
});

test('bewitched resource handover keeps the turn id and does not renew a used Flea Market', () => {
    for (const usedTurn of [4, 5]) {
        const {game} = fixture();
        const source = game.room.playerDistricts[0][0];
        source.actionsUsed = {flea_market: usedTurn};
        game.room.currentPlayer = 1;
        game.room.witched = game.room.currentCharacter;
        game.room.witchedstate = 2;
        game.state.characterRoles['1_2'] = 0;
        game.slotEventHandlers['take-resources'](1, 'coins');
        assert.equal(game.room.currentPlayer, 0);
        assert.equal(game.room.turnId, 5);
        const before = snapshot(game);
        exchange(game);
        if (usedTurn === 5) assert.equal(snapshot(game), before);
        else assert.equal(source.actionsUsed.flea_market, 5);
    }
});

test('destroying, drawing and rebuilding the same Flea Market clears its old use', () => {
    const {game} = fixture();
    const source = game.room.playerDistricts[0][0];
    exchange(game);
    game.room.playerDistricts[0].push(district('arsenal'));
    game.slotEventHandlers['arsenal-destroy'](0, 0, 0, 1);
    assert.ok(game.state.districtDiscard.includes(source));
    game.room.playerDistricts[0].push(district('observatory'));
    game.state.districtDeck = [];
    game.slotEventHandlers['take-resources'](0, 'card');
    const choiceIndex = game.state.players[0].choose.indexOf(source);
    assert.ok(choiceIndex >= 0);
    game.slotEventHandlers['take-card'](0, choiceIndex);
    game.slotEventHandlers.build(0, game.state.players[0].hand.indexOf(source));
    assert.equal(game.room.playerDistricts[0][1], source);
    assert.equal(source.actionsUsed, undefined);
    exchange(game, 0, 1);
    assert.equal(source.actionsUsed.flea_market, 5);
});
