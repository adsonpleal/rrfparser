/**
 * The Items container (type 8) — the item snapshot taken at recording start.
 *
 * Each container is read separately. Merging them into one map keyed by slot,
 * which two of the three upstream forks did, is wrong: inventory and cart both
 * number their slots from zero, so a cart item at slot 4 disappears behind the
 * bag item at slot 4 — or leaks into the bag when only the cart has that slot.
 *
 * The record offsets come from the reference parser (`Tokeiburu/Rrf-Parser`,
 * `ReplayService.cs:154-184`) and are the same in both known record widths —
 * only the stride changes:
 *
 *   +22  pos        i16      slot index, with a -2 base
 *   +42  equipped   i32      equipLocation bitmask (0 = not worn)
 *   +52  qty        i16
 *   +82  card[0..3] i32 × 4
 *   +104 nameid     i32
 *   +134 refine     u8
 *   +190 random options (221-byte record only; TLV tag 0x012d)
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
const OPTIONS_TAG = 0x012d;
const MAX_OPTIONS = 5;
const CARD_OFFSETS = [82, 86, 90, 94] as const;

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
 * Read the record's 5 random options.
 *
 * Re-checks the TLV tag and length 6 and 4 bytes before the value so an
 * unexpected layout fails closed (empty list) rather than inventing bonuses.
 * The 172-byte record ends before this field and takes that path.
 */
function readOptions(
  view: DataView,
  base: number,
  recordSize: number,
): RandomOption[] {
  if (recordSize < OPTIONS_OFFSET + MAX_OPTIONS * 5) return [];
  const tag = view.getUint16(base + OPTIONS_OFFSET - 6, true);
  const len = view.getUint32(base + OPTIONS_OFFSET - 4, true);
  if (tag !== OPTIONS_TAG || len !== MAX_OPTIONS * 5) return [];

  const out: RandomOption[] = [];
  for (let i = 0; i < MAX_OPTIONS; i++) {
    const o = base + OPTIONS_OFFSET + i * 5;
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

function readChunk(data: Uint8Array): ItemRecord[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const stride = detectRecordSize(view, data.byteLength);
  if (!stride) return [];

  const bySlot = new Map<number, ItemRecord>();
  for (let p = 0; p + stride <= data.byteLength; p += stride) {
    const slot = view.getInt16(p + 22, true) - 2;
    const qty = view.getInt16(p + 52, true);
    const itemId = view.getInt32(p + 104, true);
    // Filler records and emptied slots show up with nameid or qty zeroed;
    // neither describes an item.
    if (itemId <= 0 || qty <= 0 || slot < 0) continue;
    // The same slot can repeat within a chunk (the client rewrites the record
    // when the item changes). The first one is the valid state.
    if (bySlot.has(slot)) continue;

    bySlot.set(slot, {
      slot,
      itemId,
      qty,
      equipped: view.getInt32(p + 42, true),
      refine: view.getUint8(p + 134),
      // Positional and zero-padded on purpose — see InventoryRecord.cards.
      cards: [
        view.getInt32(p + CARD_OFFSETS[0], true),
        view.getInt32(p + CARD_OFFSETS[1], true),
        view.getInt32(p + CARD_OFFSETS[2], true),
        view.getInt32(p + CARD_OFFSETS[3], true),
      ],
      options: readOptions(view, p, stride),
    });
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
