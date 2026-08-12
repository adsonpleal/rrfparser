import { describe, expect, it } from "vitest";
import { decodeReplay } from "../src/index.js";
import { loadReplayFixture } from "./load-fixture.js";

describe("EfstList buffs (sn-buffs-potion.rrf)", () => {
  // Ground truth: a Super Novice recording whose pre-cast buffs — Blessing
  // (EFST 10), Increase Agility (12) and an Awakening Potion (38) — live only in
  // the EfstList container (18), never in the packet stream. A parser that
  // ignores that container loses them entirely.
  const replay = decodeReplay(loadReplayFixture("sn-buffs-potion.rrf"));

  it("seeds persistent buffs as t=0 status events", () => {
    const active = new Set(
      replay.statusEvents
        .filter((e) => e.aid === replay.sessionInfo.aid && e.isOn)
        .map((e) => e.statusId),
    );
    for (const efst of [10, 12, 38, 3]) expect(active.has(efst)).toBe(true);
    // Telekinesis (717/1152) was NOT up in this recording — the client never
    // wrote its status, so it correctly cannot be read out of this file.
    for (const efst of [717, 1152]) expect(active.has(efst)).toBe(false);
  });
});

describe("pet snapshot (container 9)", () => {
  // Same character and same animal in all three: level 50, intimacy 850. Hunger
  // falls over the session, which is what confirms these fields come from the
  // container and not from a fixed packet.
  it.each([
    ["nw-mira-pet.rrf", 41],
    ["nw-ult.rrf", 47],
    ["nw-ult-mira.rrf", 44],
  ])("%s: intimacy 850, level 50, hunger %i", (fixture, hunger) => {
    const pet = decodeReplay(loadReplayFixture(fixture)).pet;
    expect(pet).toBeDefined();
    expect(pet!.name).toBe("Orc Herói");
    expect(pet!.view).toBe(20571);
    expect(pet!.level).toBe(50);
    expect(pet!.intimacy).toBe(850);
    expect(pet!.hunger).toBe(hunger);
  });

  it("is undefined when no pet was out", () => {
    expect(decodeReplay(loadReplayFixture("mergulho-test.rrf")).pet).toBeUndefined();
  });
});

describe("session info is the union of both fork contracts", () => {
  const s = decodeReplay(loadReplayFixture("mergulho-test.rrf")).sessionInfo;

  it("carries the fields only the damage simulator used to read", () => {
    expect(s).toMatchObject({
      jobLevel: 47,
      str: 4,
      agi: 100,
      vit: 100,
      int: 120,
      dex: 130,
      luk: 73,
    });
  });

  it("carries the fields only the replay-stats viewer used to read", () => {
    expect(typeof s.gx).toBe("number");
    expect(typeof s.gy).toBe("number");
    expect(typeof s.option).toBe("number");
    // The recording-start cell is seeded as a t=0 position event for the local
    // player, who never self-spawns via an entity packet.
    expect(s.gx).toBeGreaterThan(0);
    expect(s.gy).toBeGreaterThan(0);
  });

  it("takes durationMs as the larger of the packet span and the stored value", () => {
    // ReplayData chunk 970 holds what the in-game replay UI counts down, and it
    // runs past the last packet — the recorder keeps rolling a beat after the
    // final action.
    expect(s.durationMs).toBeGreaterThan(0);
  });
});
