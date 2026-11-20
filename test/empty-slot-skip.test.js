"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const setup = require("../public/setup");
const {createRoom, playingRoom, chars, timer, district} = require("../test-support/game.cjs");

for (const role of ["1_2", "2_2"]) {
    const witch = role === "1_2";
    test("skipping the resource step closes it before control passes to the " + (witch ? "Witch" : "Blackmailer"), t => {
        const {game} = playingRoom();
        t.after(() => game.clearTurnTimer());
        const {room, state} = game;
        room.currentCharacter = "3_1";
        room.currentPlayer = 1;
        state.currentIndCharacter = 3;
        state.characterRoles = {[role]: 0, "3_1": 1, "4_1": 2};
        if (witch) {
            room.witched = "3_1";
            room.witchedstate = 2;
        } else {
            room.blackmailed = ["3_1"];
            state.trueBlackmailed = "3_1";
        }
        game.userEvent("host", "toggle-lock", []);
        game.userEvent(room.playerSlots[1], "spectators-join", []);
        game.userEvent("host", "toggle-lock", []);
        const gold = {...room.playerGold}, hand = state.players[0].hand.slice();
        game.userEvent("host", "skip-empty-turn", [1, room.stateRevision]);
        assert.equal(room.currentPlayer, 0);
        assert.equal(room.tookResource, true);
        assert.equal(room.teamsLocked, true);
        const snapshot = JSON.parse(JSON.stringify(game.getSnapshot()));
        snapshot.room.tookResource = false; // Older snapshots could retain the skipped resource step.
        const {game: restored} = createRoom();
        t.after(() => restored.clearTurnTimer());
        restored.setSnapshot(snapshot);
        for (const current of [game, restored]) {
            assert.equal(current.room.tookResource, true);
            const action = current.state.players[0].action;
            current.userEvent("host", "take-resources", ["coins"]);
            current.userEvent("host", "take-resources", ["card"]);
            assert.equal(current.room.phase, 2);
            assert.deepEqual(current.room.playerGold, gold);
            assert.deepEqual(current.state.players[0].hand, hand);
            assert.equal(current.state.players[0].action, action);
            if (witch) current.userEvent("host", "end-turn", []);
            else current.userEvent("host", "blackmailed-open", ["no"]);
            assert.equal(current.room.currentPlayer, 2);
        }
    });
}

test("only the host can skip the current empty seat, once per draft decision", () => {
    const {game, messages} = createRoom(2);
    const send = (user, event, ...args) => game.userEvent(user, event, args);
    const skip = (user, slot, revision) => send(user, "skip-empty-turn", slot, revision);
    send("host", "start-game", chars, [], null, timer, setup.getDefaultBasicCounts());
    game.slotEventHandlers["take-character"](game.room.currentPlayer, 0);
    const slot = game.room.currentPlayer, owner = game.room.playerSlots[slot];
    const origin = game.state.characterDeck.length;
    game.userLeft(owner);
    skip("host", slot, game.room.stateRevision);
    assert.equal(game.state.characterDeck.length, origin, "an offline player still owns the seat");
    game.userJoin({userId: owner, userName: owner});
    send("host", "toggle-lock");
    send(owner, "spectators-join");
    const revision = game.room.stateRevision;
    skip("spectator", slot, revision);
    skip("host", 1 - slot, revision);
    skip("host", slot);
    assert.equal(game.state.characterDeck.length, origin);
    send(owner, "players-join", slot);
    send(owner, "spectators-join");
    skip("host", slot, revision);
    assert.equal(game.state.characterDeck.length, origin, "stale click after someone occupied and freed the seat");
    const current = game.room.stateRevision;
    messages.length = 0;
    skip("host", slot, current);
    assert.equal(game.state.characterDeck.length, origin - 1);
    assert.equal(game.state.players[slot].action, "discard");
    skip("host", slot, current);
    assert.equal(game.state.characterDeck.length, origin - 1);
    skip("host", slot, game.room.stateRevision);
    assert.equal(game.state.characterDeck.length, origin - 2);
    assert.notEqual(game.room.currentPlayer, slot);
    assert.equal(messages.some(m => m.event === "player-state" && m.target === owner), false);
    game.clearTurnTimer();
});

test("a skip declines each Theater in order even with paused timers", () => {
    const {game} = playingRoom();
    const slot = 1;
    Object.assign(game.room, {phase: 1.5, currentPlayer: slot, timersPaused: true});
    game.state.theaterQueue = [{ownerSlot: slot, sourceIndex: 0}, {ownerSlot: slot, sourceIndex: 1}];
    game.state.theaterCursor = 0;
    game.state.players[slot].action = "theater-action";
    game.userEventHandlers["remove-player"]("host", game.room.playerSlots[slot]);
    const revision = game.room.stateRevision;
    game.userEvent("host", "skip-empty-turn", [slot, revision]);
    assert.equal(game.state.theaterCursor, 1);
    assert.equal(game.room.currentPlayer, slot);
    game.userEvent("host", "skip-empty-turn", [slot, revision]);
    assert.equal(game.state.theaterCursor, 1);
    game.clearTurnTimer();
});

test("skipping a card choice cleans up the deck cards and ends the empty character's turn", () => {
    const {game} = playingRoom();
    const slot = 0, card = district("temple");
    game.room.phase = 3;
    Object.assign(game.state.players[slot], {action: "take-card", chooseSource: "districtDeck", choose: [card]});
    game.userEventHandlers["toggle-lock"]("host");
    game.userEventHandlers["spectators-join"]("host");
    game.userEvent("host", "skip-empty-turn", [slot, game.room.stateRevision]);
    assert.equal(game.state.districtDiscard.includes(card), true);
    assert.equal(game.room.phase, 1);
    game.clearTurnTimer();
});

test("skipping an empty responder returns control to the character who was building", () => {
    const {game} = playingRoom();
    const builder = 0, responder = 1;
    game.room.currentPlayer = responder;
    game.room.targetSlot = builder;
    game.room.magistrated = [game.room.currentCharacter];
    game.state.characterRoles["1_3"] = responder;
    game.state.players[responder].action = "magistrate-open";
    game.state.magistrateAction = {action: "warlord-action", cost: 2, wasComplete: false};
    game.userEventHandlers["remove-player"]("host", game.room.playerSlots[responder]);
    const turn = game.room.turnId;
    game.userEvent("host", "skip-empty-turn", [responder, game.room.stateRevision]);
    assert.equal(game.room.currentPlayer, builder);
    assert.equal(game.room.turnId, turn);
    assert.equal(game.state.players[builder].action, "warlord-action");
    game.clearTurnTimer();
});

function skipEmptySeat(game, slot) {
    game.userEvent("host", "remove-player", [game.room.playerSlots[slot]]);
    game.userEvent("host", "skip-empty-turn", [slot, game.room.stateRevision]);
}

async function expireMainTimer(game) {
    assert.equal(game.room.timer.kind, "main");
    game.room.timer.endsAt = Date.now() - 1;
    game.restoreTurnTimer();
    await new Promise(resolve => setTimeout(resolve, 20));
}

for (const scenario of ["host skip", "timeout", "already crowned", "blackmailed"]) {
    test("the Emperor's resource card choice on forced turn end: " + scenario, async t => {
        const {game} = playingRoom(), {room, state} = game;
        t.after(() => game.clearTurnTimer());
        room.king = 0;
        room.characterInGame[3] = "4_2";
        room.currentCharacter = "3_1";
        room.tookResource = true;
        state.currentIndCharacter = 3;
        state.characterRoles = {"2_2": 0, "4_2": 1, "5_1": 2};
        state.players[1].character = ["4_2"];
        state.players[2].character = ["5_1"];
        if (scenario === "blackmailed") room.blackmailed = ["4_2"];
        if (scenario === "timeout") room.timerSettings.enabled = true;
        game.userEvent("host", "end-turn", []);
        const emperor = room.playerSlots[1], hand = state.players[1].hand.slice(), gold = {...room.playerGold};
        if (scenario === "already crowned") game.userEvent(emperor, "emperor-crown", [3, "coin"]);
        game.userEvent(emperor, "take-resources", ["card"]);
        assert.equal(room.phase, 3);
        const cards = state.players[1].choose.slice();
        assert.equal(cards.length, 2);
        if (scenario === "timeout") await expireMainTimer(game);
        else skipEmptySeat(game, 1);
        assert.deepEqual(state.districtDiscard.slice(-2), cards);
        assert.deepEqual(state.players[1].hand, hand);
        if (scenario === "blackmailed") {
            assert.equal(room.king, 0);
            assert.equal(state.players[0].action, "blackmailed-open");
            game.userEvent("host", "blackmailed-open", ["no"]);
        }
        assert.ok([2, 3].includes(room.king));
        if (scenario === "already crowned") assert.equal(room.king, 3);
        assert.equal(room.playerGold[1], gold[1] + 1);
        assert.equal(room.playerGold[room.king], gold[room.king] - 1);
        assert.equal(room.currentCharacter, "5_1");
    });
}

for (const decision of ["manual", "host skip", "timeout"]) {
    test("the Queen earns three gold once when the murdered Emperor passes the crown: " + decision, async t => {
        const {game} = createRoom(5), {room, state} = game;
        t.after(() => game.clearTurnTimer());
        const characters = [...chars, "9_2"];
        characters[3] = "4_2";
        game.userEvent("host", "start-game", [characters, [], null, timer]);
        assert.equal(room.phase, 1);
        Object.assign(room, {phase: 2, currentCharacter: "9_2", currentPlayer: 2, assassined: "4_2", king: 0, tookResource: true});
        state.currentIndCharacter = 9;
        state.characterRoles = {"4_2": 1, "9_2": 2};
        state.players[1].character = ["4_2"];
        state.players[2].character = ["9_2"];
        const gold = room.playerGold[2], round = room.roundNumber;
        game.userEvent(room.playerSlots[2], "end-turn", []);
        assert.equal(state.players[1].action, "emperor-nores-action");
        assert.equal(room.playerGold[2], gold + 3);
        const {game: restored} = createRoom(5);
        t.after(() => restored.clearTurnTimer());
        restored.setSnapshot(JSON.parse(JSON.stringify(game.getSnapshot())));
        if (decision === "manual") {
            restored.userEvent(restored.room.playerSlots[1], "emperor-crown", [2, "coin"]);
        } else if (decision === "host skip") {
            skipEmptySeat(restored, 1);
        } else {
            restored.room.timerSettings.enabled = true;
            restored.userEvent("host", "toggle-timers-pause", []);
            restored.userEvent("host", "toggle-timers-pause", []);
            await expireMainTimer(restored);
        }
        assert.equal(restored.room.roundNumber, round + 1);
        assert.equal(restored.room.playerGold[2], gold + 3);
    });
}
