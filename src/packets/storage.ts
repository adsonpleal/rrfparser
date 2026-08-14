/**
 * The item-list packets — the only place the Kafra and clan storages ever show
 * up.
 *
 * The Items container (type 8) holds the bag, the cart and the worn gear, and
 * nothing else: chunks 4511-4515, 4517 and 4519-4522 were long assumed to be the
 * storage tabs, but they are empty (or a single stray record) even in a
 * recording taken with both storages open. The storages are not part of the
 * snapshot at all — they only exist on record when the player opened the window
 * during the recording and the server answered with a list.
 *
 * That list is one bracketed group of packets:
 *
 *   0x0b08  ZC_INVENTORY_START      invType — which container follows
 *   0x0b09  ZC_ITEMLIST_NORMAL      stackables, 34 bytes per record
 *   0x0b0a  ZC_ITEMLIST_EQUIP       gear, 67 bytes per record
 *   0x0b39  ZC_ITEMLIST_EQUIP (v2)  gear, 68 bytes — the newer client build
 *   0x0b0b  ZC_INVENTORY_END        invType again
 *
 * Every part repeats the `invType` byte, so a group never has to be attributed
 * from context. The same group serves the bag (invType 0) and the cart (1) after
 * a map load — those are ignored here, the container snapshot already has them.
 *
 * Both equip variants appear in the wild: 0x0b0a on recordings up to mid-2026,
 * 0x0b39 after. The newer one moved `RefiningLevel` from in front of the card
 * block to the tail and added a byte for the enchant grade — the record layouts
 * are otherwise identical.
 */

import { ByteReader } from "../reader.js";
import type { RandomOption, StorageItem } from "../types.js";

/**
 * `enum inventory_type` — which of the four item containers a list describes.
 */
export const InventoryListType = {
  Inventory: 0,
  Cart: 1,
  /** Kafra storage ("armazém"). */
  Storage: 2,
  /** Guild / clan storage. */
  GuildStorage: 3,
} as const;

/** Record widths, one per list packet. */
export const NORMAL_RECORD_SIZE = 34;
export const EQUIP_RECORD_SIZE = 67;
/** 0x0b39: the 67-byte record plus the enchant-grade byte. */
export const EQUIP_V2_RECORD_SIZE = 68;

/** The 5 fixed-width random-option entries every equip record carries. */
function readOptions(r: ByteReader): RandomOption[] {
  const out: RandomOption[] = [];
  for (let i = 0; i < 5; i++) {
    const id = r.u16();
    const value = r.i16();
    const param = r.u8();
    if (id === 0) continue;
    out.push({ id, value, param });
  }
  return out;
}

/**
 * The four card sockets.
 *
 * Four **u32** slots, not the u16 of older clients: this build carries item ids
 * past 65535 (the 4-digit-and-up enchants, 300xxx/400xxx gear), and the socket
 * ids widened with them. Reading them as u16 turns one card into two.
 */
function readCards(r: ByteReader): [number, number, number, number] {
  return [r.i32(), r.i32(), r.i32(), r.i32()];
}

/**
 * One stackable record (34 bytes).
 *
 *   index u16 | itemId u32 | itemType u8 | qty u16 | wearState u32 |
 *   cards u32×4 | expireTime u32 | flags u8
 *
 * `wearState` is set here too — equipped ammo (EQP_AMMO, 0x8000) is a stackable
 * and is listed by this packet, not the equip one.
 */
function readNormalRecord(r: ByteReader): StorageItem {
  const index = r.u16();
  const itemId = r.i32();
  r.u8(); // itemType (rAthena `item_types`)
  const qty = r.u16();
  const equipped = r.i32();
  const cards = readCards(r);
  r.u32(); // expireTime — unix seconds, non-zero only on rentals
  r.u8(); // flags: bit 0 identified, bit 1 "keep in the ETC tab"
  return { index, itemId, qty, equipped, refine: 0, grade: 0, cards, options: [] };
}

/**
 * One equipment record (67 bytes, or 68 with the grade byte).
 *
 *   index u16 | itemId u32 | itemType u8 | equipLocation u32 | wearState u32 |
 *   [refine u8] | cards u32×4 | expireTime u32 | bindOnEquip u16 |
 *   spriteNumber u16 | u8 | options 5×5 | [refine u8 | grade u8] | flags u8
 *
 * The byte before the options reads 0 on every record in the corpus, including
 * the ones that do carry options, so it is not the option count the client
 * struct calls for — the options are read positionally instead, exactly like the
 * container's own records.
 */
function readEquipRecord(r: ByteReader, hasGrade: boolean): StorageItem {
  const index = r.u16();
  const itemId = r.i32();
  r.u8(); // itemType
  r.u32(); // equipLocation — where the item CAN be worn
  const equipped = r.i32(); // wearState — where it IS worn (0 in storage)
  const inlineRefine = hasGrade ? 0 : r.u8();
  const cards = readCards(r);
  r.u32(); // expireTime
  r.u16(); // bindOnEquipType
  r.u16(); // wItemSpriteNumber (the view id a weapon/garment renders with)
  r.u8(); // always 0 — see above
  const options = readOptions(r);
  const refine = hasGrade ? r.u8() : inlineRefine;
  const grade = hasGrade ? r.u8() : 0;
  r.u8(); // flags
  return { index, itemId, qty: 1, equipped, refine, grade, cards, options };
}

export type ItemListPacket = {
  /** One of {@link InventoryListType}. */
  listType: number;
  items: StorageItem[];
};

/**
 * 0x0b08 — begin marker: `pktLen u16 | invType u8 | name[]`.
 *
 * Length-prefixed because the container can be named (a rented store); every
 * recording seen so far leaves the name empty, so the packet is 5 bytes.
 */
export function decodeItemListStart(reader: ByteReader): { listType: number } {
  reader.u16(); // pktLen
  return { listType: reader.u8() };
}

/** 0x0b0b — end marker: `invType u8 | result u8`, no length prefix. */
export function decodeItemListEnd(reader: ByteReader): { listType: number } {
  return { listType: reader.u8() };
}

/**
 * The body of a list packet: `pktLen u16 | invType u8 | record[]`.
 *
 * Returns an empty list rather than guessing when the body is not a whole
 * number of records — a build with a different record width decodes as nothing
 * instead of as garbage.
 */
function decodeItemList(
  raw: Uint8Array,
  recordSize: number,
  readRecord: (r: ByteReader) => StorageItem,
): ItemListPacket {
  const reader = new ByteReader(raw);
  reader.seek(2); // packet id
  const declared = reader.u16();
  const listType = reader.u8();
  const end = Math.min(declared, raw.byteLength);
  const bodyLength = end - reader.position;
  const items: StorageItem[] = [];
  if (bodyLength <= 0 || bodyLength % recordSize !== 0) return { listType, items };
  for (let i = 0; i < bodyLength / recordSize; i++) {
    reader.seek(5 + i * recordSize);
    items.push(readRecord(reader));
  }
  return { listType, items };
}

/** 0x0b09 — the stackable half of a list. */
export function decodeItemListNormal(raw: Uint8Array): ItemListPacket {
  return decodeItemList(raw, NORMAL_RECORD_SIZE, readNormalRecord);
}

/** 0x0b0a — the equipment half of a list. */
export function decodeItemListEquip(raw: Uint8Array): ItemListPacket {
  return decodeItemList(raw, EQUIP_RECORD_SIZE, (r) => readEquipRecord(r, false));
}

/** 0x0b39 — the equipment half on newer builds (refine at the tail + grade). */
export function decodeItemListEquipV2(raw: Uint8Array): ItemListPacket {
  return decodeItemList(raw, EQUIP_V2_RECORD_SIZE, (r) => readEquipRecord(r, true));
}

/**
 * 0x00f2 — ZC_NOTIFY_STOREITEM_COUNTINFO (6 bytes incl. pkt id).
 *   curCount u16, maxCount u16
 *
 * Sent right after a storage list closes, and again after every add/withdraw.
 * `max` is the storage's capacity, which is per-account (300 or 600 on the
 * Kafra storage, whatever the guild bought for the clan one).
 */
export function decodeStorageCount(reader: ByteReader): {
  used: number;
  max: number;
} {
  return { used: reader.u16(), max: reader.u16() };
}

export type StorageItemAddPacket = {
  time: number;
  index: number;
  itemId: number;
  amount: number;
  refine: number;
  cards: [number, number, number, number];
  options: RandomOption[];
};

/**
 * 0x0a0a — ZC_ADD_ITEM_TO_STORE (57 bytes incl. pkt id).
 *   index u16, amount u32, itemId u32, itemType u8, identified u8,
 *   damaged u8, refine u8, cards u32×4, options 5×5
 *
 * Sent for both storages — it carries no `invType`, so which one it belongs to
 * is the storage whose list came last. No grade byte: an item deposited
 * mid-recording reports `grade` 0 even when it has one.
 */
export function decodeStorageItemAdd(
  reader: ByteReader,
  time: number,
): StorageItemAddPacket {
  const index = reader.u16();
  const amount = reader.u32();
  const itemId = reader.i32();
  reader.u8(); // itemType
  reader.u8(); // identified
  reader.u8(); // damaged
  const refine = reader.u8();
  const cards = readCards(reader);
  const options = readOptions(reader);
  return { time, index, itemId, amount, refine, cards, options };
}

/**
 * 0x00f6 — ZC_DELETE_ITEM_FROM_STORE (8 bytes incl. pkt id).
 *   index u16, amount u32
 *
 * Only the index: what left is resolved from the running storage contents.
 */
export function decodeStorageItemDelete(
  reader: ByteReader,
  time: number,
): { time: number; index: number; amount: number } {
  const index = reader.u16();
  const amount = reader.u32();
  return { time, index, amount };
}
