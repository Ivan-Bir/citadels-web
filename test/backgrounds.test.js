"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const setup = require("../public/setup");

test("background selection survives remounts and stays isolated by room and host", () => {
    const data = new Map();
    const storage = {getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value)};
    const store = user => setup.createBackgroundStore(() => storage, user);
    assert.equal(store("host").read("room"), "standard");
    assert.equal(store("host").write("room", "waterfront"), true);
    assert.equal(store("host").read("room"), "waterfront");
    assert.equal(store("host").read("other-room"), "standard");
    assert.equal(store("other-host").read("room"), "standard");
    store("host:room").write("other", "royal");
    assert.equal(store("host").read("room:other"), "standard");
    data.clear();
    assert.equal(store("host").read("room"), "standard");
});

test("unavailable storage and missing identities still allow a default background", () => {
    for (const getStorage of [
        () => {throw new Error("SecurityError");},
        () => ({getItem() {throw new Error("Unavailable");}, setItem() {throw new Error("QuotaExceededError");}})
    ]) {
        const store = setup.createBackgroundStore(getStorage, "host");
        assert.equal(store.read("room"), "standard");
        assert.equal(store.write("room", "waterfront"), false);
    }
    const store = setup.createBackgroundStore(() => assert.fail("No storage without identity"), undefined);
    assert.equal(store.read("room"), "standard");
    assert.equal(store.write("room", "waterfront"), false);
});

test("removed and untrusted background identifiers fall back to the standard image", () => {
    for (const id of [undefined, null, {}, ["waterfront"], "removed", "__proto__", "toString", "https://example.com/image.jpg"])
        assert.equal(setup.normalizeBackgroundId(id), "standard");
    const store = setup.createBackgroundStore(() => ({getItem: () => "removed"}), "host");
    assert.equal(store.read("room"), "standard");
    assert.equal(setup.normalizeBackgroundId("royal"), "royal");
});
