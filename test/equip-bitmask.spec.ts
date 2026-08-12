/**
 * `equipped` means "worn" only in the worn chunks.
 *
 * The bitmask is present on records in the bag and cart too, where it is the
 * item's equip *location* — where the item could go — not its state. Measured
 * over 564 recordings: ammunition carries the ammo bit (32768) on 414 bag
 * records and 46 cart records, against only 8 records in the worn chunk, and
 * no recording ever has the same ammo both worn and in the cart.
 *
 * This matters because the forks that merged every container into one map fed
 * those cart stacks to a damage simulator as if they were the equipped ammo.
 * Keeping the containers apart is what makes `equipped` trustworthy: read it
 * off `items.equipped` / `items.equippedCostume`, and treat it as a property
 * everywhere else.
 */
import { describe, expect, it } from "vitest";
import { decodeReplay } from "../src/index.js";
import { FIXTURES, loadReplayFixture } from "./load-fixture.js";

describe("equip bitmask", () => {
  it("is set on every worn record", () => {
    for (const name of FIXTURES) {
      const r = decodeReplay(loadReplayFixture(name));
      for (const rec of r.items.equipped) {
        expect(rec.equipped, `${name} item ${rec.itemId}`).toBeGreaterThan(0);
      }
    }
  });

  it("never reports the same slot as worn in two containers", () => {
    for (const name of FIXTURES) {
      const r = decodeReplay(loadReplayFixture(name));
      const wornSlots = r.items.equipped.map((x) => x.slot);
      const costumeSlots = r.items.equippedCostume.map((x) => x.slot);
      const overlap = wornSlots.filter((s) => costumeSlots.includes(s));
      expect(overlap, name).toEqual([]);
    }
  });

  it("keeps the worn record, not the bag's view, in the compat map", () => {
    // The bag lists worn gear too, but with the sockets and options stripped.
    // The compat map must expose the rich record.
    const r = decodeReplay(loadReplayFixture("mergulho-test.rrf"));
    for (const worn of r.items.equipped) {
      const merged = r.initialInventory.get(worn.slot);
      expect(merged?.itemId).toBe(worn.itemId);
      expect(merged?.equipped).toBe(worn.equipped);
    }
  });
});
