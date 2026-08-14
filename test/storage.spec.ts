/**
 * The Kafra and clan storages.
 *
 * They were long assumed to be unreachable from a recording, on the theory that
 * the empty item chunks 4511-4522 were where they would have lived. They are
 * reachable — just not from the containers: the server sends the contents as an
 * item-list group when the player opens the window, so a recording holds
 * whichever storages were opened while it ran.
 *
 * `storage-kafra-clan.rrf` is a recording made for exactly this: open the clan
 * storage, then the Kafra one, and stop.
 */
import { describe, expect, it } from "vitest";
import {
  decodePacket,
  decodeReplay,
  InventoryListType,
  type Replay,
} from "../src/index.js";
import { FIXTURES, loadReplayFixture } from "./load-fixture.js";

const replay = decodeReplay(loadReplayFixture("storage-kafra-clan.rrf"));

describe("storage snapshots (storage-kafra-clan.rrf)", () => {
  it("records one snapshot per storage the player opened, in order", () => {
    expect(replay.storages.map((s) => s.kind)).toEqual([
      "guildStorage",
      "storage",
    ]);
    // The clan storage was opened first, ~12s before the Kafra one.
    expect(replay.storages[0]!.time).toBeLessThan(replay.storages[1]!.time);
  });

  it("reads the clan storage", () => {
    const clan = replay.storages[0]!;
    expect(clan.items).toHaveLength(2);
    expect(clan.items.map((i) => [i.itemId, i.qty])).toEqual([
      [578, 1],
      [12580, 140],
    ]);
  });

  it("reads the Kafra storage", () => {
    const kafra = replay.storages[1]!;
    expect(kafra.items).toHaveLength(35);
    expect(kafra.items[0]).toMatchObject({ index: 8, itemId: 11568, qty: 100 });
    // A 7-digit id: the item ids are u32 here, not the u16 of older clients.
    expect(kafra.items.map((i) => i.itemId)).toContain(1001669);
    // Indices are contiguous within one list, and sorted.
    const indices = kafra.items.map((i) => i.index);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(indices[indices.length - 1]! - indices[0]!).toBe(34);
  });

  it("agrees with the server's own slot count", () => {
    // The count packet (0x00f2) is sent right after each list. It counting the
    // same number of stacks the list carried is the end-to-end check that the
    // record stride is right: a stride off by one byte drops or invents records.
    for (const s of replay.storages) {
      expect(s.usedSlots, s.kind).toBe(s.items.length);
    }
    expect(replay.storages.map((s) => s.maxSlots)).toEqual([200, 300]);
  });

  it("has no deposits or withdrawals — the player only looked", () => {
    expect(replay.storageChanges).toEqual([]);
  });

  it("leaves the bag and the cart out of the storages", () => {
    // The same packets carry the bag (invType 0) and the cart (1) after a map
    // load. Those are already in the container snapshot; only 2 and 3 are here.
    const storedIds = new Set(
      replay.storages.flatMap((s) => s.items.map((i) => i.itemId)),
    );
    for (const rec of replay.items.cart) {
      // Nothing in the cart happens to also be in a storage in this recording,
      // so a cart list leaking in would show up as an extra id.
      expect(storedIds.has(rec.itemId), `cart item ${rec.itemId}`).toBe(false);
    }
    expect(replay.storages.every((s) => s.items.length > 0)).toBe(true);
  });

  it("is empty for a recording where no storage was opened", () => {
    const others = FIXTURES.filter((f) => f !== "storage-kafra-clan.rrf");
    for (const name of others) {
      const r: Replay = decodeReplay(loadReplayFixture(name));
      expect(r.storages, name).toEqual([]);
      expect(r.storageChanges, name).toEqual([]);
    }
  });
});

/**
 * Byte-level checks for the two equipment-record layouts.
 *
 * The fixture's storages hold only stackables, so the 67/68-byte equip records
 * have no fixture to come from. These are real records lifted out of two other
 * recordings' storage lists — the older 0x0b0a build and the newer 0x0b39 one,
 * which moved `RefiningLevel` behind the random options and added the grade
 * byte. Getting either wrong shifts every field after it.
 */
describe("equipment records in an item list", () => {
  /** `pktLen u16 | invType u8` + one record. */
  function listPacket(packetId: number, record: number[]): Uint8Array {
    const length = 5 + record.length;
    return new Uint8Array([
      packetId & 0xff,
      packetId >> 8,
      length & 0xff,
      length >> 8,
      InventoryListType.Storage,
      ...record,
    ]);
  }

  // +4 headgear, one card, three random options.
  const V1_RECORD = [
    0x76, 0x00, 0xca, 0x46, 0x00, 0x00, 0x08, 0x22, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x04, 0x13, 0x12, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x0b, 0x00, 0x00, 0x31, 0x00, 0x0e, 0x00, 0x00, 0x61, 0x00,
    0x0b, 0x00, 0x00, 0x08, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
  ];

  // +7 headgear, the same card in two sockets, two random options.
  const V2_RECORD = [
    0x06, 0x01, 0xfe, 0x46, 0x00, 0x00, 0x08, 0x22, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0xa9, 0x11, 0x00, 0x00, 0xa9, 0x11, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x0b, 0x00, 0x00, 0x11, 0x00, 0x19, 0x00, 0x00, 0x9d, 0x00, 0x01,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x07, 0x00, 0x01,
  ];

  it("reads the 67-byte record (0x0b0a)", () => {
    const decoded = decodePacket(listPacket(0x0b0a, V1_RECORD), 0);
    expect(decoded?.type).toBe("itemList");
    const list = (decoded as { data: { listType: number; items: unknown[] } })
      .data;
    expect(list.listType).toBe(InventoryListType.Storage);
    expect(list.items[0]).toEqual({
      index: 118,
      itemId: 18122,
      qty: 1,
      equipped: 0,
      refine: 4,
      grade: 0,
      cards: [4627, 0, 0, 0],
      options: [
        { id: 49, value: 14, param: 0 },
        { id: 97, value: 11, param: 0 },
        { id: 8, value: 6, param: 0 },
      ],
    });
  });

  it("reads the 68-byte record (0x0b39)", () => {
    const decoded = decodePacket(listPacket(0x0b39, V2_RECORD), 0);
    const list = (decoded as { data: { items: unknown[] } }).data;
    expect(list.items[0]).toEqual({
      index: 262,
      itemId: 18174,
      qty: 1,
      equipped: 0,
      refine: 7,
      grade: 0,
      cards: [4521, 4521, 0, 0],
      options: [
        { id: 17, value: 25, param: 0 },
        { id: 157, value: 1, param: 0 },
      ],
    });
  });

  it("decodes nothing rather than garbage when the stride does not divide", () => {
    // A build with a different record width must come out empty — half-read
    // records would land item ids in the refine field.
    const decoded = decodePacket(listPacket(0x0b0a, V1_RECORD.slice(0, 60)), 0);
    expect((decoded as { data: { items: unknown[] } }).data.items).toEqual([]);
  });
});
