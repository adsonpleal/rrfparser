/**
 * The Items container (type 8) — the item snapshot taken at recording start.
 *
 * Each container is read separately. Merging them into one map keyed by slot,
 * which two of the three upstream forks did, is wrong: inventory and cart both
 * number their slots from zero, so a cart item at slot 4 disappears behind the
 * bag item at slot 4 — or leaks into the bag when only the cart has that slot.
 *
 * A record is not a flat struct: it is a **TLV chain**, `tag u16 | len u32 |
 * value[len]`, running from byte 0 to the record's last byte. The reference
 * parser (`Tokeiburu/Rrf-Parser`, `ReplayService.cs:154-184`) hardcoded the
 * absolute offsets each field happens to land on, which is why it stops at the
 * fields it knew about:
 *
 *   +22  pos        i16      slot index, with a -2 base   (tag 285)
 *   +42  equipped   i32      equipLocation bitmask        (tag 286)
 *   +52  qty        i16                                   (tag 287)
 *   +82  card[0..3] i32 × 4                               (tag 290)
 *   +104 nameid     i32                                   (tag 291)
 *   +134 refine     u8                                    (tag 295)
 *   +190 random options                                   (tag 301 = 0x012d)
 *
 * Walking the chain instead reaches the fields past `refine` that no fork ever
 * read — in particular the **enchant grade** (tag 299), which sits between the
 * item's sprite number (298) and the random-option count (300). Those absolute
 * offsets are kept as a fallback for any record whose chain does not close
 * exactly on the record boundary, so an unknown layout decodes no worse than it
 * did before.
 */

import {
  ContainerType,
  findContainer,
  type AnyContainer,
} from "./containers.js";
import type {
  InventoryRecord,
  ItemContainerKind,
  ItemContainers,
  ItemRecord,
  RandomOption,
} from "./types.js";

/**
 * Which container each chunk comes from.
 *
 * - 4510: the main bag.
 * - 4516/4518: the merchant cart. Confirmed by decoding a recording with a
 *   loaded cart — both chunks carry identical bytes, so the second mirrors the
 *   first and the merge is first-writer-wins.
 * - 4601: gear currently worn (headgear, weapon, armor…).
 * - 4603: costume and shadow gear currently worn.
 */
const CHUNK_KIND: Record<number, ItemContainerKind> = {
  4510: "inventory",
  4516: "cart",
  4518: "cart",
  4601: "equipped",
  4603: "equipped-costume",
};

/**
 * 4602/4604 are the equip-switch presets: same shape, but not actually worn.
 * 4605/4606 are phantom slots (qty=0). None of the four describes current state.
 */
const SKIP_CHUNKS = new Set([4602, 4604, 4605, 4606]);

/** Known EQUIPITEM_INFO widths, newest first. */
const RECORD_SIZES = [221, 172] as const;
const NAMEID_OFFSET = 104;
const OPTIONS_OFFSET = 190;
const MAX_OPTIONS = 5;
const CARD_OFFSETS = [82, 86, 90, 94] as const;

/**
 * The TLV field ids we read, in the order they appear in the record.
 *
 * 281 and 282 bracket the chain as zero-length start/end markers, and the gaps
 * are fields nothing here needs: 288/289 (always 0), 292-294 (the
 * identified/damaged flags), 296/297 (bind-on-equip and hire expiry) and 298
 * (`wItemSpriteNumber`, the view id a garment renders with).
 *
 * **300 is not the grade.** It is the random-option count, and it is the one
 * field that can be mistaken for the grade: on the only graded item in the
 * fixtures it also reads 2. What tells them apart is the rest of the corpus —
 * across 847 records, 300 equals the number of populated option entries in
 * every single one, while 299 stays 0 through the 58 records that have options
 * but no grade.
 */
const TAG = {
  pos: 285,
  wearState: 286,
  qty: 287,
  cards: 290,
  nameid: 291,
  refine: 295,
  grade: 299,
  options: 0x012d, // 301
} as const;

/** Header size of one TLV entry: `tag u16 | len u32`. */
const TLV_HEADER = 6;

type TlvField = { offset: number; length: number };

/**
 * Work out a chunk's record stride.
 *
 * Validates EVERY record, not just the first few: the equipment chunks open with
 * empty filler records (`nameid` 0), so checking only the start would reject the
 * right stride and skip the whole chunk — losing all the worn gear. With the
 * correct stride every `nameid` reads as either 0 or a plausible id, and at
 * least one is a real item; with the wrong stride most land in garbage.
 */
function detectRecordSize(view: DataView, byteLength: number): number {
  const plausible = (id: number) => id > 0 && id < 5_000_000;
  for (const size of RECORD_SIZES) {
    if (byteLength < size || byteLength % size !== 0) continue;
    let anyValid = false;
    let ok = true;
    for (let r = 0; r < byteLength / size; r++) {
      const id = view.getInt32(r * size + NAMEID_OFFSET, true);
      if (id === 0) continue;
      if (!plausible(id)) {
        ok = false;
        break;
      }
      anyValid = true;
    }
    if (ok && anyValid) return size;
  }
  return 0;
}

/**
 * Walk one record's TLV chain into a tag → field map.
 *
 * Returns null unless the chain closes **exactly** on the record boundary. That
 * is the whole validation: a mis-detected stride, an older layout or a garbage
 * record will overrun or stop short, and the caller falls back to the absolute
 * offsets rather than reading a field out of the wrong place.
 */
function readFields(
  view: DataView,
  base: number,
  recordSize: number,
): Map<number, TlvField> | null {
  const fields = new Map<number, TlvField>();
  let o = 0;
  while (o + TLV_HEADER <= recordSize) {
    const tag = view.getUint16(base + o, true);
    const length = view.getUint32(base + o + 2, true);
    if (o + TLV_HEADER + length > recordSize) return null;
    fields.set(tag, { offset: o + TLV_HEADER, length });
    o += TLV_HEADER + length;
  }
  return o === recordSize ? fields : null;
}

/**
 * Read a numeric TLV field, sized by its own length.
 *
 * The recorder does not store a field at its packet width — `refine` is a byte
 * in the client's struct and four bytes here — so the length prefix, not the
 * field's meaning, decides how to read it. Anything unexpected reads as
 * `fallback` instead of reaching past the value.
 */
function readNumber(
  view: DataView,
  base: number,
  fields: Map<number, TlvField>,
  tag: number,
  fallback = 0,
): number {
  const field = fields.get(tag);
  if (!field) return fallback;
  switch (field.length) {
    case 1:
      return view.getUint8(base + field.offset);
    case 2:
      return view.getUint16(base + field.offset, true);
    case 4:
      return view.getInt32(base + field.offset, true);
    default:
      return fallback;
  }
}

/** Decode the 5 fixed-width random-option entries at `offset`. */
function readOptionsAt(
  view: DataView,
  base: number,
  offset: number,
): RandomOption[] {
  const out: RandomOption[] = [];
  for (let i = 0; i < MAX_OPTIONS; i++) {
    const o = base + offset + i * 5;
    const id = view.getUint16(o, true);
    if (id === 0) continue;
    out.push({
      id,
      value: view.getInt16(o + 2, true),
      param: view.getUint8(o + 4),
    });
  }
  return out;
}

/**
 * Read the record's 5 random options without the TLV chain.
 *
 * Re-checks the tag and length 6 and 4 bytes before the value so an unexpected
 * layout fails closed (empty list) rather than inventing bonuses. The 172-byte
 * record ends before this field and takes that path.
 */
function readOptionsAtFixedOffset(
  view: DataView,
  base: number,
  recordSize: number,
): RandomOption[] {
  if (recordSize < OPTIONS_OFFSET + MAX_OPTIONS * 5) return [];
  const tag = view.getUint16(base + OPTIONS_OFFSET - 6, true);
  const len = view.getUint32(base + OPTIONS_OFFSET - 4, true);
  if (tag !== TAG.options || len !== MAX_OPTIONS * 5) return [];
  return readOptionsAt(view, base, OPTIONS_OFFSET);
}

/**
 * One item record, read through the TLV chain when it parses and through the
 * reference parser's absolute offsets when it does not.
 *
 * Both paths agree field for field on every record in the fixture corpus; the
 * TLV path additionally carries `grade`, which has no absolute-offset
 * equivalent to fall back to and so reads 0 on the fallback path.
 */
function readRecord(
  view: DataView,
  base: number,
  recordSize: number,
): Omit<ItemRecord, "slot"> & { pos: number } {
  const fields = readFields(view, base, recordSize);
  if (!fields) {
    return {
      pos: view.getInt16(base + 22, true),
      itemId: view.getInt32(base + NAMEID_OFFSET, true),
      qty: view.getInt16(base + 52, true),
      equipped: view.getInt32(base + 42, true),
      refine: view.getUint8(base + 134),
      grade: 0,
      // Positional and zero-padded on purpose — see InventoryRecord.cards.
      cards: [
        view.getInt32(base + CARD_OFFSETS[0], true),
        view.getInt32(base + CARD_OFFSETS[1], true),
        view.getInt32(base + CARD_OFFSETS[2], true),
        view.getInt32(base + CARD_OFFSETS[3], true),
      ],
      options: readOptionsAtFixedOffset(view, base, recordSize),
    };
  }

  const cards = fields.get(TAG.cards);
  const options = fields.get(TAG.options);
  return {
    pos: readNumber(view, base, fields, TAG.pos),
    itemId: readNumber(view, base, fields, TAG.nameid),
    qty: readNumber(view, base, fields, TAG.qty),
    equipped: readNumber(view, base, fields, TAG.wearState),
    refine: readNumber(view, base, fields, TAG.refine),
    grade: readNumber(view, base, fields, TAG.grade),
    cards:
      cards && cards.length === 16
        ? [
            view.getInt32(base + cards.offset, true),
            view.getInt32(base + cards.offset + 4, true),
            view.getInt32(base + cards.offset + 8, true),
            view.getInt32(base + cards.offset + 12, true),
          ]
        : [0, 0, 0, 0],
    options:
      options && options.length === MAX_OPTIONS * 5
        ? readOptionsAt(view, base, options.offset)
        : [],
  };
}

function readChunk(data: Uint8Array): ItemRecord[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const stride = detectRecordSize(view, data.byteLength);
  if (!stride) return [];

  const bySlot = new Map<number, ItemRecord>();
  for (let p = 0; p + stride <= data.byteLength; p += stride) {
    const { pos, ...rec } = readRecord(view, p, stride);
    const slot = pos - 2;
    // Filler records and emptied slots show up with nameid or qty zeroed;
    // neither describes an item.
    if (rec.itemId <= 0 || rec.qty <= 0 || slot < 0) continue;
    // The same slot can repeat within a chunk (the client rewrites the record
    // when the item changes). The first one is the valid state.
    if (bySlot.has(slot)) continue;

    bySlot.set(slot, { slot, ...rec });
  }
  return [...bySlot.values()].sort((a, b) => a.slot - b.slot);
}

/** Merge `extra` into `into` without letting a repeated slot overwrite. */
function mergeBySlot(into: ItemRecord[], extra: ItemRecord[]): void {
  const seen = new Set(into.map((r) => r.slot));
  for (const rec of extra) {
    if (seen.has(rec.slot)) continue;
    seen.add(rec.slot);
    into.push(rec);
  }
  into.sort((a, b) => a.slot - b.slot);
}

export function readItemContainers(containers: AnyContainer[]): ItemContainers {
  const out: ItemContainers = {
    inventory: [],
    cart: [],
    equipped: [],
    equippedCostume: [],
    unknown: {},
  };

  const itemsContainer = findContainer(containers, ContainerType.Items);
  if (!itemsContainer) return out;

  for (const chunk of itemsContainer.chunks) {
    if (SKIP_CHUNKS.has(chunk.id) || chunk.length === 0) continue;
    const records = readChunk(chunk.data);
    if (records.length === 0) continue;

    switch (CHUNK_KIND[chunk.id]) {
      case "inventory":
        mergeBySlot(out.inventory, records);
        break;
      case "cart":
        mergeBySlot(out.cart, records);
        break;
      case "equipped":
        mergeBySlot(out.equipped, records);
        break;
      case "equipped-costume":
        mergeBySlot(out.equippedCostume, records);
        break;
      default:
        out.unknown[chunk.id] = records;
    }
  }

  return out;
}

/**
 * The inventory slot space as one map — worn gear first, then the bag, with the
 * **cart excluded**.
 *
 * Equipped chunks go in first so the richer worn record (which carries the
 * equipLocation bitmask and the random options) wins over the bag's view of the
 * same slot. This is the shape the packet-stream orchestrator mutates as
 * item-add / item-delete / equip-change events arrive, and the back-compat view
 * consumers of the older forks read.
 */
export function toInventoryMap(
  c: ItemContainers,
): Map<number, InventoryRecord> {
  const out = new Map<number, InventoryRecord>();
  for (const list of [c.equipped, c.equippedCostume, c.inventory]) {
    for (const r of list) {
      if (!out.has(r.slot)) out.set(r.slot, r);
    }
  }
  return out;
}
