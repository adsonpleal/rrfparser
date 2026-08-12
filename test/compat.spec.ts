/**
 * The back-compat contract for `initialInventory`.
 *
 * Two of the three upstream forks exposed the item snapshot as one map keyed by
 * a global slot index. That shape is preserved by `toInventoryMap`, minus the
 * cart — which is the bug this library fixes. These numbers were measured
 * against the old forks: five of the seven recordings are unchanged, and the
 * two that shrink lose only cart records that had leaked into the bag, every
 * one of them with `equipped === 0`.
 *
 * If a future change moves any of these counts, it is changing what downstream
 * consumers see. That should be a deliberate decision, not a surprise.
 */
import { describe, expect, it } from "vitest";
import { decodeReplay } from "../src/index.js";
import { loadReplayFixture } from "./load-fixture.js";

/** fixture, initialInventory.size, worn count, bag, cart, equipped, costume */
const EXPECTED = [
  ["mergulho-test.rrf", 71, 20, 54, 0, 9, 8],
  ["nw-mira-pet.rrf", 67, 20, 48, 0, 9, 10],
  ["nw-ult-mira.rrf", 67, 20, 48, 0, 9, 10],
  ["nw-ult.rrf", 67, 20, 48, 0, 9, 10],
  // Loses 26 records versus the old merged map — all cart, all unequipped.
  ["sn-buffs-potion.rrf", 91, 20, 71, 39, 10, 10],
  ["em-endow-learned-not-active.rrf", 98, 1, 97, 0, 1, 0],
  // Loses 3 records versus the old merged map — same story.
  ["hn-magic-lv1.rrf", 85, 20, 65, 3, 10, 10],
  ["equip-test-2.rrf", 42, 8, 34, 17, 6, 2],
] as const;

describe("initialInventory back-compat", () => {
  it.each(EXPECTED)(
    "%s → %i slots, %i worn",
    (name, size, worn, bag, cart, equipped, costume) => {
      const r = decodeReplay(loadReplayFixture(name));
      expect(r.initialInventory.size).toBe(size);
      expect(
        [...r.initialInventory.values()].filter((x) => x.equipped).length,
      ).toBe(worn);
      expect(r.items.inventory).toHaveLength(bag);
      expect(r.items.cart).toHaveLength(cart);
      expect(r.items.equipped).toHaveLength(equipped);
      expect(r.items.equippedCostume).toHaveLength(costume);
    },
  );

  it.each(EXPECTED.map(([name]) => name))(
    "%s: no cart-only slot reaches the compat map",
    (name) => {
      const r = decodeReplay(loadReplayFixture(name));
      const bagSlots = new Set(r.items.inventory.map((x) => x.slot));
      for (const rec of r.items.cart) {
        if (bagSlots.has(rec.slot)) continue;
        expect(r.initialInventory.has(rec.slot)).toBe(false);
      }
    },
  );

  it.each(EXPECTED.map(([name]) => name))(
    "%s: the running inventory does not alias the snapshot",
    (name) => {
      // decodeReplay mutates a copy as item-delete / equip-change events land.
      // If it aliased the snapshot records, a mid-recording consume would
      // retroactively rewrite the start-of-recording state.
      const r = decodeReplay(loadReplayFixture(name));
      for (const [slot, rec] of r.initialInventory) {
        const fromContainer = [
          ...r.items.equipped,
          ...r.items.equippedCostume,
          ...r.items.inventory,
        ].find((x) => x.slot === slot);
        expect(rec).toBe(fromContainer);
      }
    },
  );

  it("finds no records in the unlabelled item chunks", () => {
    // Chunk 4522 and friends are routed to `unknown` rather than into the
    // inventory. Across every fixture they carry no decodable record, which is
    // what makes that routing safe. A fixture that breaks this is worth
    // investigating before the mapping is trusted further.
    for (const [name] of EXPECTED) {
      const r = decodeReplay(loadReplayFixture(name));
      expect(Object.keys(r.items.unknown), name).toEqual([]);
    }
  });
});
