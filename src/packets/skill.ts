import { ByteReader } from "../reader.js";
import type { SkillCast, SkillInfoEntry, SkillUse } from "../types.js";

/**
 * 0x010f — ZC_SKILLINFO_LIST (the learned skill tree, sent once at login).
 * Variable-length: a u16 packet length at +2, then fixed 37-byte records:
 *   +0 id u16, +2 inf u32, +6 level u16, +8 sp u16, +10 range u16,
 *   +12 name 24B, +36 upgradable u8.
 * Verified against LATAM client recordings (AC_OWL=43, WH_NATUREFRIENDLY=5325).
 *
 * Takes the raw packet rather than a ByteReader because it needs the length
 * field at +2 to know where the record array ends.
 */
export function decodeSkillInfoList(raw: Uint8Array): SkillInfoEntry[] {
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const REC = 37;
  const end = Math.min(view.getUint16(2, true), raw.byteLength);
  const entries: SkillInfoEntry[] = [];
  for (let p = 4; p + REC <= end; p += REC) {
    const skillId = view.getUint16(p, true);
    const level = view.getUint16(p + 6, true);
    if (skillId > 0 && level > 0) entries.push({ skillId, level });
  }
  return entries;
}

/** 0x011a — clif_skill_nodamage (older, 15 bytes incl. pkt id). */
export function decodeSkillNoDamage011a(reader: ByteReader, time: number): SkillUse {
  const skillId = reader.u16();
  const skillLevel = reader.u16();
  const target = reader.u32();
  const source = reader.u32();
  // result byte ignored
  return { time, source, target, skillId, skillLevel };
}

/** 0x09cb — clif_skill_nodamage (newer, 17 bytes — skillLevel is i32). */
export function decodeSkillNoDamage09cb(reader: ByteReader, time: number): SkillUse {
  const skillId = reader.u16();
  const skillLevel = reader.i32();
  const target = reader.u32();
  const source = reader.u32();
  // result byte ignored
  return { time, source, target, skillId, skillLevel };
}

/** 0x013e — ZC_USESKILL_ACK (cast started). */
export function decodeSkillCast(reader: ByteReader, time: number): SkillCast {
  const source = reader.u32();
  const target = reader.u32();
  reader.skip(2 + 2); // x, y
  const skillId = reader.u16();
  reader.skip(4); // element
  const castMs = reader.u32();
  return { time, source, target, skillId, castMs };
}

/**
 * 0x07fb — ZC_USESKILL_ACK2 (newer cast-start packet, PACKETVER >= 20080910).
 * Modern clients (kRO 2020+ and the LATAM branch we target) emit this instead
 * of 0x013e for skills with a cast bar. Payload after pkt id is the 0x013e
 * layout + a trailing `disposable` byte we don't need:
 *   srcAID u32, targetID u32, x i16, y i16, skillId u16, property i32,
 *   delayTime u32, disposable u8
 */
export function decodeSkillCast07fb(reader: ByteReader, time: number): SkillCast {
  const source = reader.u32();
  const target = reader.u32();
  reader.skip(2 + 2); // x, y
  const skillId = reader.u16();
  reader.skip(4); // property (element)
  const castMs = reader.u32();
  // trailing disposable u8 — unused
  return { time, source, target, skillId, castMs };
}

/**
 * 0x09ca — ZC_SKILL_ENTRY5 (ground-skill unit placed). Used by skills like
 * Onda Psíquica, Storm Gust, Comet, etc. that drop a "skill unit" entity on
 * the map; subsequent damage events list that unit's AID as the source
 * instead of the caster's. We track unit→caster so the orchestrator can
 * reattribute the damage back to the player.
 *
 * Layout after pkt id (byte offsets from the packet id):
 *   +2  pktLen   u16   always 23 — see "record shape" below
 *   +4  AID      u32   the unit's own AID
 *   +8  creator  u32   the caster's AID
 *   +12 xPos     i16   GAT cell x
 *   +14 yPos     i16   GAT cell y
 *   +16 job      u32   the unit *type* (`unitType` here) — rAthena's
 *                      `e_skill_unit_id` / the client's UNITTYPE table key
 *   +20 radius   u8    the unit's area radius in cells (0 = the single cell)
 *   +21 isVisible u8   0 for a trap hidden from the viewer, else 1
 *   +22 level    u8    the level of the skill that created the unit
 *
 * **Record shape.** One shape only. Across 575 recordings (this repo's 11
 * fixtures plus a 564-file LATAM corpus) all 342,421 0x09ca packets are exactly
 * 23 bytes with `pktLen` = 23, which is the documented `PACKET_ZC_SKILL_ENTRY5`
 * struct for PACKETVER >= 20121212 laid out end to end (2+2+4+4+2+2+4+1+1+1).
 * No other width occurs, so there is no version branch to take: a record that
 * is not 23 bytes is not a shape we have ever seen, and the decoder reads the
 * trailing fields only when the bytes are there.
 *
 * **How the type was verified** (not taken from a layout table — the published
 * ones disagree on whether `job` is u8 or u32):
 *  - Grouping the corpus by `pktLen` fixes the field widths: 23 bytes leaves
 *    exactly 7 bytes after `yPos`, which only the u32-job variant fills.
 *  - `unitType` is constant per skill and distinct between skills. Anchors
 *    against rAthena's `e_skill_unit_id`: MG_SAFETYWALL (12) → 126 = 0x7e,
 *    the enum's first member; MG_FIREWALL (18) → 127; PR_SANCTUARY (70) → 131,
 *    PR_MAGNUS (79) → 132 and AL_PNEUMA (25) → 133 — three consecutive skills
 *    landing on three consecutive ids in the enum's own order; WZ_FIREPILLAR
 *    (80) → 135 (UNT_FIREPILLAR_WAITING). Skills with no ground graphic of
 *    their own (Storm Gust, Meteor Storm, …) all land on 134 = UNT_DUMMYSKILL,
 *    which is exactly what that member is for.
 *  - The id is looked up, not derived: EM_* 5370/5371/5372 give the consecutive
 *    282/283/284, while HN_* 5455/5457/5459 give 301/295/296.
 *  - `isVisible` at +21 is 1 in all 342,421 records except for type 145, which
 *    is HT_ANKLESNARE's unit — the one type in the corpus that is a trap the
 *    server can hide. A wrong offset here would not single out a trap.
 *  - `radius` at +20 is constant per `unitType` (126 → 0, 131 → 1, 266 → 9,
 *    199 → 13), i.e. a property of the unit and not of the cast.
 *  - `level` at +22 only ever holds 1-10, and the fixture named
 *    `hn-magic-lv1.rrf` — a level-1 recording — reads 1 on every record.
 *
 * `unitType` is read unsigned because the enum behind the field is a `uint16`
 * widened into the packet's int32 slot; every value in the corpus fits in 16
 * bits. The client's own table covers roughly the 126-301 range, and a value
 * outside it does occur (21292, 73 records in one replay), so a consumer
 * keying a visual off it needs a fall-through for unknown types.
 *
 * gx/gy are the unit's GAT cell — the anchor the map viewer drops the skill's
 * ground effect (Storm Gust, Arrow Storm, Pneuma, …) onto.
 */
export type GroundSkillEntry = {
  time: number;
  unitAid: number;
  casterAid: number;
  gx: number;
  gy: number;
  /** The unit's type — what the client keys its ground visual off. */
  unitType: number;
  /** Area radius in cells; 0 means the unit covers only its own cell. */
  radius: number;
  /** False only for a trap the server is hiding from the recorder. */
  visible: boolean;
  /** Level of the skill that placed the unit. */
  skillLevel: number;
};

export function decodeSkillEntry09ca(
  reader: ByteReader,
  time: number,
): GroundSkillEntry {
  reader.u16(); // pktLen
  const unitAid = reader.u32();
  const casterAid = reader.u32();
  const gx = reader.u16(); // cell coords (positive; sent as int16)
  const gy = reader.u16();
  // The only shape in the corpus carries all four trailing fields, but a
  // truncated record must not throw — it would drop the unit→caster link.
  const hasTail = reader.remaining >= 7;
  const unitType = hasTail ? reader.u32() : 0;
  const radius = hasTail ? reader.u8() : 0;
  const visible = hasTail ? reader.u8() !== 0 : true;
  const skillLevel = hasTail ? reader.u8() : 0;
  return { time, unitAid, casterAid, gx, gy, unitType, radius, visible, skillLevel };
}
