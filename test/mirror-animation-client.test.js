"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const setup = require("../public/setup");
const source = fs.readFileSync(require.resolve("../public/app.jsx"), "utf8");

// Execute the actual Game socket handlers and lifecycle without replacing their logic.
function client(reducedMotion = false) {
    const handlers = {}, timers = new Map();
    let clock = 1000, nextTimer = 0;
    class Component {
        setState(change) {
            Object.assign(this.state, typeof change === "function" ? change(this.state) : change);
        }
    }
    const socket = {on(name, handler) {handlers[name] = handler;}, emit() {}};
    const context = vm.createContext({
        React: {Component}, CitadelsSetup: setup, localStorage: {}, Image: class {},
        Date: class extends Date {static now() {return clock;}},
        setTimeout(callback, duration) {timers.set(++nextTimer, {callback, duration}); return nextTimer;},
        clearTimeout(id) {timers.delete(id);},
        window: {socket, matchMedia: () => ({matches: reducedMotion})},
        document: {body: {style: {}}, title: ""},
        CommonRoom: {
            roomInit(game) {game.socket = socket; game.userId = "host"; return {roomId: "mirror"};},
            processCommonRoom() {}
        }
    });
    const start = source.indexOf("class Game extends React.Component");
    const end = source.indexOf("    render()", start);
    vm.runInContext(source.slice(start, end) + "}\nglobalThis.Game = Game;", context);
    const game = new context.Game();
    game.componentDidMount();
    const state = {
        phase: 2, currentPlayer: 0, playerSlots: ["host", "player"], hostId: "host",
        playerDistricts: {0: [{type: "museum", instanceId: "district-1", exposition: []}], 1: [{type: "museum", instanceId: "district-2"}]}
    };
    const send = change => handlers.state({...state, ...change});
    return {game, timers, handlers, send, state, advance: () => {clock += 700;}};
}

test("Mirror transformation starts only for the transient built instance and survives ordinary state without restarting", () => {
    const {game, send, timers, advance} = client();
    assert.equal(game.mirrorArt.src, setup.districts.mirror_hall.image);
    send(); // An existing copied city on reconnect is not an animation source.
    assert.equal(Object.keys(game.state.mirrorAnimations).length, 0);
    send({mirrorBuild: {slot: 0, instanceId: "district-1"}});
    const animation = game.state.mirrorAnimations["district-1"];
    assert.equal(animation.startedAt, 1000);
    assert.equal(game.state.mirrorBuild, undefined);
    assert.equal(game.state.mirrorAnimations["district-2"], undefined);
    assert.equal(timers.size, 1);
    assert.equal([...timers.values()][0].duration, 2700);
    advance(); send(); send({mirrorBuild: {slot: 0, instanceId: "district-1"}});
    assert.equal(game.state.mirrorAnimations["district-1"], animation);
    assert.equal(timers.size, 1);
    game.finishMirrorAnimation("district-1");
    assert.equal(timers.size, 0);
    send({mirrorBuild: {slot: 0, instanceId: "district-1"}});
    assert.equal(Object.keys(game.state.mirrorAnimations).length, 0);
});

test("Mirror animation follows its instance after city index shifts and cleans up on removal, game end and disconnect", () => {
    for (const ending of ["remove", "end", "disconnect", "unmount", "timeout"]) {
        const {game, send, timers, handlers, state} = client();
        send({mirrorBuild: {slot: 0, instanceId: "district-1"}});
        const animation = game.state.mirrorAnimations["district-1"];
        send({playerDistricts: {...state.playerDistricts, 0: [{type: "temple"}, ...state.playerDistricts[0]]}});
        assert.equal(game.state.mirrorAnimations["district-1"], animation);
        if (ending === "remove") send({playerDistricts: {0: [], 1: state.playerDistricts[1]}});
        if (ending === "end") send({phase: 0});
        if (ending === "disconnect") handlers.disconnect({reason: "test"});
        if (ending === "unmount") game.componentWillUnmount();
        if (ending === "timeout") [...timers.values()][0].callback();
        assert.equal(timers.size, 0, ending);
        if (ending !== "unmount") assert.equal(Object.keys(game.state.mirrorAnimations).length, 0, ending);
    }
});

test("a new game allows reused district IDs while player-state and invalid events never start transformations", () => {
    const {game, send, handlers, timers} = client();
    send({mirrorBuild: {slot: 0, instanceId: "district-1"}});
    handlers["game-setup"](null);
    assert.equal(timers.size, 0);
    handlers["player-state"]({hand: [], mirrorBuild: {slot: 0, instanceId: "district-1"}});
    assert.equal(Object.keys(game.state.mirrorAnimations).length, 0);
    send({mirrorBuild: {slot: 0, instanceId: "district-1"}});
    assert.equal(timers.size, 1);
    send({mirrorBuild: {slot: 1, instanceId: "not-in-city"}});
    send({mirrorBuild: {slot: 0}});
    assert.equal(timers.size, 1);
    game.componentWillUnmount();
});

test("reduced motion shows the target immediately and schedules no animation", () => {
    const {game, send, timers} = client(true);
    send({mirrorBuild: {slot: 0, instanceId: "district-1"}});
    assert.equal(Object.keys(game.state.mirrorAnimations).length, 0);
    assert.equal(timers.size, 0);
});
