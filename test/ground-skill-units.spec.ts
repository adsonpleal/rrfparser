import { describe, expect, it } from "vitest";
import { decodePacket, decodeReplay, type GroundSkillUnit } from "../src/index.js";
import { loadReplayFixture } from "./load-fixture.js";

/** A 0x09ca record as a real recording carries it, written as the hex dump. */
function record(hex: string): Uint8Array {
  return Uint8Array.from(hex.trim().split(/\s+/).map((b) => parseInt(b, 16)));
}

function entry(hex: string) {
  const d = decodePacket(record(hex), 0);
  expect(d?.type).toBe("groundSkillEntry");
  if (d?.type !== "groundSkillEntry") throw new Error("unreachable");
  return d.data;
}

/**
 * 0x09ca (ZC_SKILL_ENTRY5) has exactly one record shape in every recording we
 * have: 23 bytes, `pktLen` = 23. Each dump below is a verbatim packet lifted
 * from a real `.rrf`; between them they pin every field of that shape.
 * `src/packets/skill.ts` records how the offsets were established.
 */
describe("0x09ca record shape (23 bytes)", () => {
  it("reads MG_SAFETYWALL's unit — type 126, the first id of rAthena's enum", () => {
    // 32taYNjyNS.rrf @4.5s. Safety Wall level 9 on one cell, so radius 0.
    const e = entry("ca 09 17 00 03 70 01 00 73 5c 18 00 13 01 4f 00 7e 00 00 00 00 01 09");
    expect(e).toEqual({
      time: 0,
      unitAid: 94211,
      casterAid: 1596531,
      gx: 275,
      gy: 79,
      unitType: 126,
      radius: 0,
      visible: true,
      skillLevel: 9,
    });
  });

  it("reads MG_FIREWALL's unit — type 127, the enum member right after it", () => {
    // 27N8nzk8Ln.rrf @37.2s.
    const e = entry("ca 09 17 00 7c d6 00 00 f4 ca 00 00 9d 00 ee 00 7f 00 00 00 00 01 01");
    expect(e).toMatchObject({ unitType: 127, gx: 157, gy: 238, radius: 0, visible: true, skillLevel: 1 });
  });

  it("reads isVisible=0 on a hidden trap", () => {
    // Both records are gEpviQEZqR.rrf @131.2s: the same Ranger (AID 1220573)
    // placing two Ankle Snares (type 145) in one burst, one of which the server
    // marks hidden. Nothing but a correct +21 offset separates them.
    const hidden = entry("ca 09 17 00 82 16 01 00 dd 9f 12 00 96 00 b1 00 91 00 00 00 01 00 01");
    const shown = entry("ca 09 17 00 fc e9 00 00 dd 9f 12 00 9e 00 b0 00 91 00 00 00 01 01 01");
    expect(hidden).toMatchObject({ casterAid: 1220573, unitType: 145, radius: 1, visible: false });
    expect(shown).toMatchObject({ casterAid: 1220573, unitType: 145, radius: 1, visible: true });
  });

  it("keeps the unit→caster link when a record arrives short", () => {
    // No recording has ever produced this, but a truncated tail must not throw:
    // losing the packet would lose the reattribution of the unit's damage.
    const e = entry("ca 09 10 00 7c d6 00 00 f4 ca 00 00 9d 00 ee 00");
    expect(e).toMatchObject({ unitAid: 54908, casterAid: 51956, unitType: 0, visible: true });
  });
});

describe("replay.groundSkillUnits carries the unit type", () => {
  const byAid = (units: GroundSkillUnit[]) =>
    new Map(units.map((u) => [u.unitAid, u] as const));

  it("gives each Elemental Master ground skill its own type (em-endow-learned-not-active.rrf)", () => {
    const units = decodeReplay(loadReplayFixture("em-endow-learned-not-active.rrf")).groundSkillUnits;
    expect(units).toHaveLength(4);
    // EM_* 5370/5371/5372 are consecutive skills and land on consecutive unit
    // ids, which is how `e_skill_unit_id` is laid out — the server looks the id
    // up rather than deriving it, so the three must not collapse into one type.
    expect(units.map((u) => [u.skillId, u.unitType])).toEqual([
      [2449, 223],
      [5372, 284],
      [5370, 282],
      [5371, 283],
    ]);
    for (const u of units) {
      expect(u.visible).toBe(true);
      expect(u.skillLevel).toBe(5);
    }
    expect(byAid(units).get(23853)).toMatchObject({ unitType: 284, radius: 4, gx: 67, gy: 70 });
  });

  it("reads the skill level off the packet (hn-magic-lv1.rrf, a level-1 recording)", () => {
    const units = decodeReplay(loadReplayFixture("hn-magic-lv1.rrf")).groundSkillUnits;
    const hn = units.filter((u) => u.skillId !== 0);
    expect(hn.length).toBeGreaterThan(0);
    for (const u of hn) expect(u.skillLevel).toBe(1);
    // The Hyper Novice's three ground skills, each with its own type.
    expect(new Set(hn.map((u) => `${u.skillId}:${u.unitType}`))).toEqual(
      new Set(["5455:301", "5457:295", "5459:296"]),
    );
    // Everything else in this recording is type 134 (UNT_DUMMYSKILL): the
    // no-visual unit the server uses for skills with no ground graphic.
    const dummy = units.filter((u) => u.skillId === 0);
    expect(dummy.length).toBeGreaterThan(0);
    for (const u of dummy) expect(u).toMatchObject({ unitType: 134, radius: 0, skillLevel: 10 });
  });
});
