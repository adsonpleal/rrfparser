import { ByteReader } from "../reader.js";
import type { CoupleStatusEvent, StatusEvent, Traits } from "../types.js";

/**
 * 0x0141 — ZC_COUPLESTATUS (14 bytes incl. pkt id).
 *   statusType i32, defaultStatus i32, plusStatus i32
 *
 * rAthena sends this from `clif_couplestatus` for the stats it reports as an
 * allocated/bonus pair — which is how the 4th-job traits (SP_POW 219 …
 * SP_CRT 224) reach the client. `defaultStatus` is `sd->status.<trait>` (the
 * allocation) and `plusStatus` is `battle_status - status` (gear and buffs).
 *
 * The other trait-adjacent ids — SP_PATK..SP_CRATE (225-230), SP_TRAITPOINT
 * (231), SP_AP (232) — come through 0x00b0 instead, as `paramChanges`.
 */
export function decodeStatus0141(
  reader: ByteReader,
  time: number,
): CoupleStatusEvent {
  const statusId = reader.i32();
  const base = reader.i32();
  const plus = reader.i32();
  return { time, statusId, base, plus };
}

/** rAthena `SP_POW`..`SP_CRT` — the six 4th-job traits, in enum order. */
const TRAIT_BY_STATUS_ID = new Map<number, keyof Traits>([
  [219, "pow"],
  [220, "sta"],
  [221, "wis"],
  [222, "spl"],
  [223, "con"],
  [224, "crt"],
]);

/**
 * Last `base` per trait, i.e. the allocation as of the end of the recording.
 *
 * Last rather than first because a player can spend a trait point mid-recording,
 * and the later value is the one that matches the rest of the final state.
 * Events for any other status id are ignored, and a trait the stream never
 * mentioned stays absent — never defaulted to zero, since a character with no
 * traits reports a real zero.
 */
export function traitsFromCoupleStatus(events: CoupleStatusEvent[]): Traits {
  const traits: Traits = {};
  for (const e of events) {
    const key = TRAIT_BY_STATUS_ID.get(e.statusId);
    if (key) traits[key] = e.base;
  }
  return traits;
}

/**
 * 0x0196 — ZC_MSG_STATE_CHANGE (8 bytes).
 *   index u16 (status id), aid u32, isOn u8
 */
export function decodeStatus0196(
  reader: ByteReader,
  time: number,
): StatusEvent {
  const statusId = reader.u16();
  const aid = reader.u32();
  const isOn = reader.u8() !== 0;
  return { time, statusId, aid, isOn, totalMs: 0, leftMs: 0 };
}

/**
 * 0x043f — ZC_MSG_STATE_CHANGE3 (29 bytes incl. pkt id).
 * Order matches rAthena `packet_status_change2`:
 *   index u16, aid u32, isOn u8, left u32, val1 i32, val2 i32, val3 i32
 *
 * `total` field is *not* present in this variant (it's the older one).
 */
export function decodeStatus043f(
  reader: ByteReader,
  time: number,
): StatusEvent {
  const statusId = reader.u16();
  const aid = reader.u32();
  const isOn = reader.u8() !== 0;
  const leftMs = reader.u32();
  reader.skip(4 * 3); // val1, val2, val3
  return { time, statusId, aid, isOn, totalMs: 0, leftMs };
}

/**
 * 0x0983 — ZC_MSG_STATE_CHANGE_TICK (33 bytes incl. pkt id).
 * Order matches rAthena `packet_status_change`:
 *   index u16, aid u32, isOn u8, total u32, left u32, val1 i32, val2 i32, val3 i32
 *
 * Adds the `total` (full duration) compared to 0x043f.
 */
export function decodeStatus0983(
  reader: ByteReader,
  time: number,
): StatusEvent {
  const statusId = reader.u16();
  const aid = reader.u32();
  const isOn = reader.u8() !== 0;
  const totalMs = reader.u32();
  const leftMs = reader.u32();
  reader.skip(4 * 3); // val1, val2, val3
  return { time, statusId, aid, isOn, totalMs, leftMs };
}
