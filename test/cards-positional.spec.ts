/**
 * `cards` is a positional, zero-padded 4-tuple, and must stay that way.
 *
 * One of the upstream forks filtered the zeros out, which reads as a tidy-up
 * but is a data corruption: which socket an enchant sits in is meaningful, and
 * a record like `[0, 29660, 0, 0]` collapses to `[29660]`, moving that enchant
 * into socket 0. A damage simulator that maps sockets to model fields by index
 * then attributes the bonus to the wrong slot.
 *
 * This spec exists so that "fix" can never be applied silently.
 */
import { describe, expect, it } from "vitest";
import { decodeReplay } from "../src/index.js";
import { FIXTURES, loadReplayFixture } from "./load-fixture.js";

describe("card sockets are positional", () => {
  it("always reports exactly four entries", () => {
    for (const name of FIXTURES) {
      const replay = decodeReplay(loadReplayFixture(name));
      for (const rec of replay.initialInventory.values()) {
        expect(rec.cards, `${name} item ${rec.itemId}`).toHaveLength(4);
      }
    }
  });

  it("preserves a hole before a populated socket", () => {
    const sparse: Array<{ fixture: string; itemId: number; cards: number[] }> =
      [];
    for (const name of FIXTURES) {
      const replay = decodeReplay(loadReplayFixture(name));
      for (const rec of replay.initialInventory.values()) {
        if (rec.cards[0] === 0 && rec.cards.some((c) => c > 0)) {
          sparse.push({ fixture: name, itemId: rec.itemId, cards: rec.cards });
        }
      }
    }
    // If this ever finds nothing, the fixtures stopped covering the case the
    // spec is guarding — that is a failure, not a pass.
    expect(sparse.length).toBeGreaterThan(0);
    for (const s of sparse) {
      expect(s.cards[0]).toBe(0);
      expect(s.cards).toHaveLength(4);
    }
  });

  it("keeps a fully-socketed record in socket order", () => {
    const replay = decodeReplay(loadReplayFixture("mergulho-test.rrf"));
    const garment = [...replay.initialInventory.values()].find(
      (r) => r.itemId === 480063,
    );
    // Card in socket 0, then three enchants — order is the item's own.
    expect(garment!.cards).toEqual([300732, 29537, 29539, 29539]);
  });
});
