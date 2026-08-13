/**
 * The numbers here were measured by decoding the fixture by hand before any
 * parser existed: 34 items in the bag (chunk 4510), 17 in the cart (4516), 6
 * worn (4601) and 2 costume/shadow (4603). If a refactor touches the record
 * stride or the per-container split, this is where it shows up.
 */
import { describe, expect, it } from "vitest";
import {
  decodeInventory,
  decodeReplay,
  decodeSnapshot,
  toInventoryMap,
} from "../src/index.js";
import { FIXTURES, loadReplayFixture } from "./load-fixture.js";

const items = decodeInventory(loadReplayFixture("equip-test-2.rrf"));

describe("decodeInventory (equip-test-2.rrf)", () => {
  it("separates bag, cart and worn gear", () => {
    expect(items.inventory).toHaveLength(34);
    expect(items.cart).toHaveLength(17);
    expect(items.equipped).toHaveLength(6);
    expect(items.equippedCostume).toHaveLength(2);
  });

  it("does not leak a cart item into the bag", () => {
    // Both lists number their slots from zero, and slots 4 and 5 exist only in
    // the cart. Merging by a global slot index — what two of the three upstream
    // forks did — put these two shadow-gear pieces in the bag.
    const bagIds = new Set(items.inventory.map((r) => r.itemId));
    expect(bagIds.has(24076)).toBe(false);
    expect(bagIds.has(24111)).toBe(false);
    expect(items.cart.map((r) => r.itemId)).toContain(24076);
  });

  it("reads quantity, refine and cards", () => {
    expect(items.cart[0]).toMatchObject({ slot: 0, itemId: 1004, qty: 3 });

    const weapon = items.equipped.find((r) => r.itemId === 1398);
    expect(weapon).toBeDefined();
    expect(weapon!.refine).toBe(7);
  });

  it("flags worn gear with its equip-location bitmask", () => {
    expect(items.equipped.every((r) => r.equipped > 0)).toBe(true);
    expect(items.equippedCostume.map((r) => r.itemId)).toContain(440007);
  });

  it("does not double-count a slot repeated within one chunk", () => {
    // Chunk 4601 carries item 1398 twice (a two-handed weapon occupies two
    // locations). Each slot may appear only once in the result.
    const slots = items.equipped.map((r) => r.slot);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it("agrees with the full decodeReplay path", () => {
    const full = decodeReplay(loadReplayFixture("equip-test-2.rrf"));
    expect(full.items).toEqual(items);
  });
});

describe("cart separation on sn-buffs-potion.rrf", () => {
  const replay = decodeReplay(loadReplayFixture("sn-buffs-potion.rrf"));

  it("keeps the cart out of the inventory slot space", () => {
    expect(replay.items.cart.length).toBeGreaterThan(0);
    const merged = toInventoryMap(replay.items);
    // Merging the cart in as well would take this to 117 — the 26 extra entries
    // are cart records that displaced or invented bag slots.
    expect(merged.size).toBe(91);
    expect(replay.initialInventory.size).toBe(91);

    const cartSlots = new Set(replay.items.cart.map((r) => r.slot));
    const bagSlots = new Set(replay.items.inventory.map((r) => r.slot));
    // A cart slot that the bag does not also have must not appear in the merge.
    for (const slot of cartSlots) {
      if (!bagSlots.has(slot)) expect(merged.has(slot)).toBe(false);
    }
  });

  it("prefers the worn record over the bag's view of the same slot", () => {
    const merged = toInventoryMap(replay.items);
    for (const worn of replay.items.equipped) {
      expect(merged.get(worn.slot)).toBe(worn);
    }
  });
});

/**
 * Ground truth: playing wh-ilimitar.rrf back in the client renders the weapon as
 * "+11 [C] Gakkung Primordial-LT" and every other worn piece with no [X] prefix.
 * rAthena's enchantgrade scale is 0=none 1=D 2=C 3=B 4=A, so the weapon must
 * read 2 and the rest 0.
 *
 * The trap this pins down: on that weapon the grade field and the random-option
 * count are BOTH 2, so a single record cannot tell the two TLV tags apart. What
 * separates them is the rest of the corpus — 845 other records where the option
 * count is 1 or 2 and the grade is 0. Hence the second test.
 */
describe("enchant grade (wh-ilimitar.rrf)", () => {
  const worn = decodeInventory(loadReplayFixture("wh-ilimitar.rrf")).equipped;

  it("reads the graded weapon and leaves the ungraded gear at 0", () => {
    const weapon = worn.find((r) => r.itemId === 700046);
    expect(weapon).toBeDefined();
    expect(weapon!.refine).toBe(11);
    expect(weapon!.grade).toBe(2);

    const others = worn.filter((r) => r.itemId !== 700046);
    expect(others.length).toBeGreaterThan(0);
    expect(others.map((r) => r.grade)).toEqual(others.map(() => 0));
  });

  it("does not simply mirror the random-option count", () => {
    // Same weapon, 2 random options and grade C — equal by coincidence. The
    // bag's other Gakkung also carries 2 options, and is ungraded.
    const weapon = worn.find((r) => r.itemId === 700046)!;
    expect(weapon.options).toHaveLength(2);

    const all = decodeInventory(loadReplayFixture("wh-ilimitar.rrf")).inventory;
    const optioned = all.filter((r) => r.options.length > 0);
    expect(optioned.length).toBeGreaterThan(0);
    expect(optioned.map((r) => r.grade)).toEqual(optioned.map(() => 0));
  });
});

describe("every other fixture decodes as ungraded", () => {
  // None of them was recorded with graded gear, so a change that starts reading
  // the wrong TLV tag — the option count being the obvious one — shows up here
  // as a nonzero grade rather than silently in one consumer's damage numbers.
  it.each(FIXTURES.filter((f) => f !== "wh-ilimitar.rrf"))("%s", (name) => {
    const items = decodeInventory(loadReplayFixture(name));
    const every = [
      ...items.inventory,
      ...items.cart,
      ...items.equipped,
      ...items.equippedCostume,
    ];
    expect(every.length).toBeGreaterThan(0);
    expect(every.filter((r) => r.grade !== 0)).toEqual([]);
  });
});

describe("decodeSnapshot", () => {
  it("gives the session and items without decoding the packet stream", () => {
    const snap = decodeSnapshot(loadReplayFixture("mergulho-test.rrf"));
    const full = decodeReplay(loadReplayFixture("mergulho-test.rrf"));
    expect(snap.items).toEqual(full.items);
    expect(snap.pet).toEqual(full.pet);
    // Identical to the full path except durationMs, which needs the stream.
    const { durationMs: _d, ...rest } = full.sessionInfo;
    expect(snap.session).toEqual(rest);
  });
});
