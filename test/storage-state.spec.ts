/**
 * `storageAt` / `storagesAt` — the storages as contents rather than as a log.
 *
 * `storage.spec.ts` covers the decode: that the listings come out of the packet
 * stream with the right items. This covers the layer above it, which is where the
 * protocol's awkward parts live — that the last listing of a kind wins, that a
 * withdrawal for an unlisted index is dropped instead of becoming a phantom, and
 * that "never opened" stays distinguishable from "opened and empty".
 *
 * The fixture only ever looks at the storages, so every case involving movement
 * is hand-built. That is the reason `applyStorageChanges` is exported at all.
 */
import { describe, expect, it } from "vitest";
import {
  applyStorageChanges,
  decodeReplay,
  storageAt,
  storagesAt,
  type Replay,
  type StorageChangeEvent,
  type StorageItem,
  type StorageSnapshot,
} from "../src/index.js";
import { FIXTURES, loadReplayFixture } from "./load-fixture.js";

const replay = decodeReplay(loadReplayFixture("storage-kafra-clan.rrf"));

const item = (index: number, itemId: number, qty: number): StorageItem => ({
  index,
  itemId,
  qty,
  equipped: 0,
  refine: 0,
  grade: 0,
  cards: [0, 0, 0, 0],
  options: [],
});

const change = (
  over: Partial<StorageChangeEvent> & Pick<StorageChangeEvent, "index" | "added">,
): StorageChangeEvent => ({
  time: 0,
  kind: "storage",
  itemId: 0,
  amount: 1,
  refine: 0,
  grade: 0,
  cards: [0, 0, 0, 0],
  options: [],
  ...over,
});

/** A replay with only the fields these functions read. */
const fake = (
  storages: StorageSnapshot[],
  storageChanges: StorageChangeEvent[] = [],
): Replay => ({ storages, storageChanges }) as unknown as Replay;

const snapshot = (
  over: Partial<StorageSnapshot> & Pick<StorageSnapshot, "kind" | "time">,
): StorageSnapshot => ({
  items: [],
  usedSlots: -1,
  maxSlots: 300,
  ...over,
});

describe("applyStorageChanges", () => {
  it("returns the listing untouched when nothing moved", () => {
    const items = [item(2, 501, 10), item(3, 502, 5)];
    expect(applyStorageChanges(items, [])).toEqual(items);
  });

  it("adds to the existing stack on a deposit", () => {
    const out = applyStorageChanges(
      [item(2, 501, 10)],
      [change({ index: 2, added: true, amount: 5 })],
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.qty).toBe(15);
  });

  it("creates the stack when the deposit lands on an unlisted index", () => {
    const out = applyStorageChanges(
      [item(2, 501, 10)],
      [change({ index: 9, added: true, amount: 3, itemId: 909, refine: 4 })],
    );
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.index === 9)).toMatchObject({
      itemId: 909,
      qty: 3,
      refine: 4,
    });
  });

  it("subtracts on a withdrawal and drops the stack when it empties", () => {
    const out = applyStorageChanges(
      [item(2, 501, 10), item(3, 502, 5)],
      [
        change({ index: 2, added: false, amount: 4 }),
        change({ index: 3, added: false, amount: 5 }),
      ],
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ index: 2, qty: 6 });
  });

  it("drops a withdrawal for an index no listing carried", () => {
    // Such an event has itemId 0 — applying it would put a phantom stack, or a
    // negative quantity, into the contents.
    const out = applyStorageChanges(
      [item(2, 501, 10)],
      [change({ index: 77, added: false, amount: 1 })],
    );
    expect(out).toEqual([item(2, 501, 10)]);
  });

  it("applies events in the order given", () => {
    const out = applyStorageChanges(
      [item(2, 501, 10)],
      [
        change({ index: 2, added: false, amount: 10 }),
        change({ index: 2, added: true, amount: 4, itemId: 501 }),
      ],
    );
    // The withdrawal empties and removes the stack; the deposit recreates it.
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ index: 2, itemId: 501, qty: 4 });
  });

  it("sorts the result by index", () => {
    const out = applyStorageChanges(
      [item(5, 501, 1)],
      [change({ index: 2, added: true, amount: 1, itemId: 502 })],
    );
    expect(out.map((r) => r.index)).toEqual([2, 5]);
  });

  it("does not mutate its input", () => {
    const items = [item(2, 501, 10)];
    applyStorageChanges(items, [change({ index: 2, added: true, amount: 5 })]);
    expect(items[0]!.qty).toBe(10);
  });
});

describe("storageAt", () => {
  it("reads both storages out of the recording", () => {
    const kafra = storageAt(replay, "storage");
    const clan = storageAt(replay, "guildStorage");
    expect(kafra?.items).toHaveLength(35);
    expect(kafra?.maxSlots).toBe(300);
    expect(clan?.items.map((i) => [i.itemId, i.qty])).toEqual([
      [578, 1],
      [12580, 140],
    ]);
    expect(clan?.maxSlots).toBe(200);
  });

  it("is null for a kind the player never opened", () => {
    // Not an empty snapshot: the recording cannot say what is in there.
    for (const name of FIXTURES.filter((f) => f !== "storage-kafra-clan.rrf")) {
      const r = decodeReplay(loadReplayFixture(name));
      expect(storageAt(r, "storage"), name).toBeNull();
      expect(storageAt(r, "guildStorage"), name).toBeNull();
    }
  });

  it("distinguishes opened-and-empty from never-opened", () => {
    const opened = storageAt(
      fake([snapshot({ kind: "storage", time: 10, usedSlots: 0 })]),
      "storage",
    );
    expect(opened).not.toBeNull();
    expect(opened!.items).toEqual([]);
    expect(storageAt(fake([]), "storage")).toBeNull();
  });

  it("takes the last listing of the kind, not the first", () => {
    const out = storageAt(
      fake([
        snapshot({ kind: "storage", time: 10, items: [item(2, 501, 1)] }),
        snapshot({ kind: "storage", time: 90, items: [item(2, 502, 7)] }),
      ]),
      "storage",
    );
    expect(out!.items).toEqual([item(2, 502, 7)]);
    expect(out!.time).toBe(90);
  });

  it("ignores movements that predate the last listing", () => {
    // The server relists the whole contents on open, so a deposit made before it
    // is already counted there; applying it again would double the stack.
    const out = storageAt(
      fake(
        [
          snapshot({ kind: "storage", time: 10, items: [item(2, 501, 1)] }),
          snapshot({ kind: "storage", time: 90, items: [item(2, 501, 5)] }),
        ],
        [change({ index: 2, added: true, amount: 4, time: 20 })],
      ),
      "storage",
    );
    expect(out!.items[0]!.qty).toBe(5);
  });

  it("applies movements that follow the last listing", () => {
    const out = storageAt(
      fake(
        [snapshot({ kind: "storage", time: 10, items: [item(2, 501, 5)] })],
        [change({ index: 2, added: true, amount: 3, time: 40 })],
      ),
      "storage",
    );
    expect(out!.items[0]!.qty).toBe(8);
  });

  it("counts a movement in the same millisecond as the listing", () => {
    // The tie goes to the movement being later: there is no depositing into a
    // window that has already closed.
    const out = storageAt(
      fake(
        [snapshot({ kind: "storage", time: 40, items: [item(2, 501, 5)] })],
        [change({ index: 2, added: true, amount: 3, time: 40 })],
      ),
      "storage",
    );
    expect(out!.items[0]!.qty).toBe(8);
  });

  it("does not let one storage's movements reach the other", () => {
    const out = storageAt(
      fake(
        [
          snapshot({ kind: "storage", time: 10, items: [item(2, 501, 5)] }),
          snapshot({ kind: "guildStorage", time: 20, items: [item(2, 501, 5)] }),
        ],
        [change({ index: 2, added: true, amount: 3, time: 30, kind: "guildStorage" })],
      ),
      "storage",
    );
    expect(out!.items[0]!.qty).toBe(5);
  });

  it("leaves the listing's own occupancy numbers alone", () => {
    // `usedSlots` describes the moment the window opened. After a deposit it
    // disagrees with `items.length` on purpose — on a listing with no movements
    // after it, that disagreement is how a truncated list shows up.
    const out = storageAt(
      fake(
        [
          snapshot({
            kind: "storage",
            time: 10,
            items: [item(2, 501, 5)],
            usedSlots: 1,
          }),
        ],
        [change({ index: 3, added: true, amount: 1, itemId: 502, time: 40 })],
      ),
      "storage",
    );
    expect(out!.usedSlots).toBe(1);
    expect(out!.items).toHaveLength(2);
  });
});

describe("storagesAt", () => {
  it("gives both storages the recording opened", () => {
    expect(storagesAt(replay).map((s) => s.kind)).toEqual([
      "storage",
      "guildStorage",
    ]);
  });

  it("leaves out the kinds that were never opened", () => {
    expect(
      storagesAt(fake([snapshot({ kind: "guildStorage", time: 5 })])).map(
        (s) => s.kind,
      ),
    ).toEqual(["guildStorage"]);
    expect(storagesAt(fake([]))).toEqual([]);
  });
});
