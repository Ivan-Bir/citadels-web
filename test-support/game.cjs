"use strict";
const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const init = require("../module");
const setup = require("../public/setup");

function createRoom(players = 4) {
    let GameState;
    const messages = [];
    class RoomState extends EventEmitter {
        constructor() { super(); this.room = {}; this.eventHandlers = {}; }
    }
    const registry = {
        RoomState, handleAppPage() {},
        createRoomManager(path, State) { GameState = State; }
    };
    init({app: {use() {}, get() {}}, users: registry, static() {}}, "/test");
    const game = new GameState("host", {}, {
        send(target, event, data) { messages.push({target, event, data}); }
    }, {games: {citadels: {id: "test"}}, authUsers: {processAchievement() {}},
        achievements: {win100Citadels: {id: "win"}, winGames: {id: "games"}}});
    game.room.playerSlots = Array.from({length: 8}, (_, i) => i < players ? (i === 0 ? "host" : "player-" + i) : null);
    return {game, messages};
}
const chars = Array.from({length: 8}, (_, i) => (i + 1) + "_1");
const timer = setup.normalizeTimerSettings({enabled: false});

const district = type => ({type, cost: setup.districts[type].cost, kind: setup.districts[type].type});
function playingRoom(options) {
    const result = createRoom();
    const {game} = result;
    game.userEventHandlers['start-game']('host', chars, setup.uniqueIds, null, timer, setup.getDefaultBasicCounts(), options);
    assert.equal(game.room.phase, 1);
    game.room.phase = 2;
    game.room.currentPlayer = 0;
    game.room.currentCharacter = '8_1';
    game.state.currentIndCharacter = 8;
    game.state.players[0].action = null;
    game.room.tookResource = false;
    game.room.onlinePlayers.add('host');
    game.room.onlinePlayers.add('spectator');
    return result;
}

module.exports={createRoom,playingRoom,district,chars,timer};
