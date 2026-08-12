/**
 * @vitest-environment jsdom
 *
 * The library claims to run unmodified in a browser. This re-runs the core
 * decode under jsdom, where the Node globals a browser lacks are absent from
 * the document/window surface — a `Buffer`, `process` or `fs` reference that
 * crept into src/ shows up here rather than in a consumer's bundle.
 *
 * The fixture is read with node:fs (the test harness is allowed to be
 * Node-only) and handed to the parser as a plain ArrayBuffer, which is exactly
 * what `File.arrayBuffer()` gives a browser caller.
 */
import { describe, expect, it } from "vitest";
import { decodeInventory, decodeReplay } from "../src/index.js";
import { loadReplayFixture } from "./load-fixture.js";

describe("decoding under a browser-like environment", () => {
  it("decodes a full replay", () => {
    const r = decodeReplay(loadReplayFixture("mergulho-test.rrf"));
    expect(r.sessionInfo.player).toBe("Preá");
    expect(r.initialInventory.size).toBe(71);
    expect(r.damage).toHaveLength(4);
  });

  it("decodes an inventory through the packet-free entry point", () => {
    const items = decodeInventory(loadReplayFixture("equip-test-2.rrf"));
    expect(items.inventory).toHaveLength(34);
    expect(items.cart).toHaveLength(17);
  });

  it("decodes a euc-kr name without the Node ICU path", () => {
    const pet = decodeReplay(loadReplayFixture("nw-mira-pet.rrf")).pet;
    expect(pet!.name).toBe("Orc Herói");
  });
});
