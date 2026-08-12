import { beforeAll, describe, expect, it } from "vitest";
import { decodeReplay, type Replay } from "../src/index.js";
import { loadReplayFixture } from "./load-fixture.js";

// Ground truth: a real `.rrf` recording of a Windhawk ("Preá") on tra_fild.
// These assertions exercise the binary parser end-to-end against known values.
describe("decodeReplay (mergulho-test.rrf)", () => {
  let replay: Replay;

  beforeAll(() => {
    replay = decodeReplay(loadReplayFixture("mergulho-test.rrf"));
  });

  it("reads the session header, including a non-ASCII player name", () => {
    const s = replay.sessionInfo;
    // "Preá" only decodes correctly if the euc-kr → windows-1252 fallback in
    // reader.ts works; a runtime without the euc-kr table must still get this.
    expect(s.player).toBe("Preá");
    expect(s.map).toBe("tra_fild");
    expect(s.aid).toBe(1031076);
    expect(s.job).toBe(4257); // Windhawk
    expect(s.baseLevel).toBe(230);
    expect(s.jobLevel).toBe(47);
    // Sex comes from ReplayData chunk 963; Preá is male.
    expect(s.sex).toBe(1);
  });

  it("reads the recording character's look from the session snapshot", () => {
    const s = replay.sessionInfo;
    expect(s.hairStyle).toBe(1);
    expect(s.hairColor).toBe(0);
    expect(s.clothesColor).toBe(0);
  });

  it("reads the allocated base stats from the session snapshot", () => {
    const s = replay.sessionInfo;
    expect(s).toMatchObject({
      str: 4,
      agi: 100,
      vit: 100,
      int: 120,
      dex: 130,
      luk: 73,
    });
  });

  it("parses the expected event/entity counts", () => {
    expect(replay.entities.size).toBe(9);
    expect(replay.damage).toHaveLength(4);
    expect(replay.initialInventory.size).toBe(71);
    expect(replay.learnedSkills.size).toBe(48);
  });

  it("reports packet totals (handled <= seen)", () => {
    expect(replay.totals.packetCount).toBe(26);
    // 25, not the 21 the damage-simulator fork reported: this recording carries
    // four 0x07fb (ZC_USESKILL_ACK2) cast-start packets that only the
    // replay-stats fork knew how to decode. The merge picks them up, so the
    // casts below exist where they previously went missing.
    expect(replay.totals.handledPackets).toBe(25);
    expect(replay.totals.handledPackets).toBeLessThanOrEqual(
      replay.totals.packetCount,
    );
    expect(replay.totals.knownPacketIds).toContain(0x07fb);
    expect(replay.skillCasts.length).toBeGreaterThan(0);
  });

  it("decodes the worn equipment with refine and socketed cards", () => {
    const equipped = [...replay.initialInventory.values()].filter(
      (r) => r.equipped,
    );
    expect(equipped).toHaveLength(20);

    // The garment record: refine +10 with four socket ids (card + 3 enchants).
    const garment = equipped.find((r) => r.itemId === 480063);
    expect(garment).toBeDefined();
    expect(garment!.refine).toBe(10);
    expect(garment!.cards).toEqual([300732, 29537, 29539, 29539]);
  });

  it("parses a random-options array on every item record (empty here)", () => {
    for (const rec of replay.initialInventory.values()) {
      expect(Array.isArray(rec.options)).toBe(true);
    }
    // This recording carries no random options, so every parsed list is empty.
    const withOptions = [...replay.initialInventory.values()].filter(
      (r) => r.options.length,
    );
    expect(withOptions).toHaveLength(0);
  });

  it("decodes player damage events with skill id, hit count and hit type", () => {
    expect(replay.damage[0]).toMatchObject({
      source: 1031076,
      target: 4399,
      skillId: 5326,
      skillLevel: 5,
      damage: 573584,
      hits: 2,
      hitType: "double",
      source_packet: "skill",
    });
  });

  it("decodes the learned skill tree (client skill id -> level, level > 0)", () => {
    expect(replay.learnedSkills.get(1)).toBe(9);
    expect(replay.learnedSkills.get(43)).toBe(10);
    for (const level of replay.learnedSkills.values()) {
      expect(level).toBeGreaterThan(0);
    }
  });
});
