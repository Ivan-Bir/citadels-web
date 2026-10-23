"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const setup = require("../public/setup");
const {createDraftStore: createStore} = setup;

function memoryStorage() {
    const data = new Map();
    return {
        data,
        getItem(key) {return data.get(key) ?? null;},
        setItem(key, value) {data.set(key, value);},
        removeItem(key) {data.delete(key);}
    };
}
const draft = () => ({setup: setup.getDefaultSetup(), preserveCharacters: true, creatorMode: false});

test("draft survives a new store instance and is isolated by room and user", () => {
    const storage = memoryStorage();
    const store = createStore(() => storage, "host");
    const value = draft();
    value.setup.characters.push("9_2");
    value.setup.starting.gold = 7;
    value.setup.rules.citySize = 10;
    assert.equal(store.write("room:1", value), true);
    assert.deepEqual(createStore(() => storage, "host").read("room:1"), value);
    assert.equal(store.read("room:2"), null);
    assert.equal(createStore(() => storage, "other").read("room:1"), null);
    assert.equal(createStore(() => storage, "host:room").read("1"), null);
});

test("a draft remains valid for the browser session even with a legacy timestamp", () => {
    const storage = memoryStorage();
    const store = createStore(() => storage, "host");
    store.write("room", draft());
    const key = [...storage.data.keys()][0];
    storage.setItem(key, JSON.stringify({...JSON.parse(storage.getItem(key)), updatedAt: 1}));
    assert.deepEqual(store.read("room"), draft());
    storage.data.clear();
    assert.equal(store.read("room"), null);
});

test("malformed and obsolete entries are discarded safely", () => {
    const invalidRecords = [
        "{broken", "null", "[]",
        JSON.stringify({version: 2, ...draft()}),
        JSON.stringify({version: 1, ...draft(), setup: {}}),
        JSON.stringify({version: 1, ...draft(), preserveCharacters: "yes"}),
        " ".repeat(setup.MAX_FILE_SIZE + 513)
    ];
    for (const raw of invalidRecords) {
        const storage = memoryStorage();
        const store = createStore(() => storage, "host");
        store.write("room", draft());
        storage.data.set([...storage.data.keys()][0], raw);
        assert.equal(store.read("room"), null);
        assert.equal(storage.data.size, 0);
    }
});

test("invalid unfinished input does not replace the last valid draft", () => {
    const storage = memoryStorage();
    const store = createStore(() => storage, "host");
    const valid = draft();
    store.write("room", valid);
    const invalid = draft(); invalid.setup.starting.gold = "";
    assert.equal(store.write("room", invalid), false);
    assert.deepEqual(store.read("room"), valid);
});

test("unavailable storage, quota errors and missing identity do not break the editor", () => {
    const unavailable = createStore(() => {throw new Error("SecurityError");}, "host");
    assert.equal(unavailable.read("room"), null);
    assert.equal(unavailable.write("room", draft()), false);
    const blocked = createStore(() => ({
        getItem() {throw new Error("Unavailable");},
        removeItem() {throw new Error("Unavailable");},
        setItem() {throw new Error("QuotaExceededError");}
    }), "host");
    assert.equal(blocked.read("room"), null);
    assert.equal(blocked.write("room", draft()), false);
    const noIdentity = createStore(() => {throw new Error("Must not be accessed");}, null);
    assert.equal(noIdentity.write("room", draft()), false);
    assert.equal(noIdentity.read("room"), null);
    assert.equal(unavailable.write("", draft()), false);
});

test("creator mode stays in the local draft and old drafts restore it disabled", () => {
    const storage = memoryStorage();
    const store = createStore(() => storage, "host");
    const value = {...draft(), creatorMode: true};
    assert.equal(store.write("room", value), true);
    assert.equal(createStore(() => storage, "host").read("room").creatorMode, true);
    assert.equal(setup.serializeSetup(store.read("room").setup).includes("creatorMode"), false);
    const key = [...storage.data.keys()][0];
    const old = JSON.parse(storage.getItem(key));
    delete old.creatorMode;
    storage.setItem(key, JSON.stringify(old));
    assert.equal(store.read("room").creatorMode, false);
    old.creatorMode = "true";
    storage.setItem(key, JSON.stringify(old));
    assert.equal(store.read("room"), null);
});