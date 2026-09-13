import { describe, expect, it } from "vitest";
import { decodePacket, type Entity } from "../src/index.js";
import { resolveOwners } from "../src/decode.js";

/**
 * A 0x09ff (idle unit) packet as the wire carries it, with only the fields these
 * tests read filled in. Offsets are from the packet id: objecttype @4, AID @5,
 * GID @9, job @23, name from @88 to the end.
 */
function idlePacket(objectType: number, aid: number, gid: number, job: number, name: string) {
  const nameBytes = new TextEncoder().encode(name);
  const buf = new Uint8Array(88 + nameBytes.length);
  const dv = new DataView(buf.buffer);
  dv.setUint16(0, 0x09ff, true);
  dv.setUint16(2, buf.length, true);
  buf[4] = objectType;
  dv.setUint32(5, aid, true);
  dv.setUint32(9, gid, true);
  dv.setInt16(23, job, true);
  buf.set(nameBytes, 88);
  return buf;
}

function entity(aid: number, kind: Entity["kind"]): Entity {
  return { aid, kind, view: 0, name: "", isBoss: false, level: 0, maxHp: 0, firstSeenMs: 0, lastHp: 0 };
}

describe("summon spawns", () => {
  // Bytes lifted from a real recording: Dudazou's (AID 1063912) ABR Curandeira.
  it("classifies object type 0x0d as an ABR and keeps the master's AID in gid", () => {
    const d = decodePacket(idlePacket(0x0d, 73074, 1063912, 20836, "x"), 0);
    expect(d?.type).toBe("entity");
    if (d?.type !== "entity") return;
    expect(d.data.kind).toBe("abr");
    expect(d.data.gid).toBe(1063912);
    expect(d.data.view).toBe(20836);
  });

  it("classifies object type 0x0e as a bionic (Biolo summon)", () => {
    const d = decodePacket(idlePacket(0x0e, 80000, 1664292, 20848, "x"), 0);
    expect(d?.type === "entity" && d.data.kind).toBe("bionic");
  });

  it("leaves 0x0c (hidden script NPCs) unknown", () => {
    const d = decodePacket(idlePacket(0x0c, 50926, 0, 20994, "#boss_control_06j"), 0);
    expect(d?.type === "entity" && d.data.kind).toBe("unknown");
  });
});

describe("resolveOwners", () => {
  it("stamps the owner only when the GID is a player in the recording", () => {
    const entities = new Map<number, Entity>([
      [1063912, entity(1063912, "pc")],
      [73074, entity(73074, "abr")],
      [50926, entity(50926, "unknown")],
      [55538, entity(55538, "mob")],
      [9000, entity(9000, "elem")],
    ]);
    const gids = new Map([
      [73074, 1063912], // summon → its master
      [55538, 50926], // boss → the script NPC that spawned it, not an owner
      [9000, 424242], // master never seen
    ]);
    resolveOwners(entities, gids, 1063912);
    expect(entities.get(73074)!.ownerAid).toBe(1063912);
    expect(entities.get(55538)!.ownerAid).toBeUndefined();
    expect(entities.get(9000)!.ownerAid).toBeUndefined();
  });

  it("gives the recorder their own elemental from the Companions container", () => {
    const entities = new Map<number, Entity>([
      [1, entity(1, "pc")],
      [19008, entity(19008, "elem")],
    ]);
    resolveOwners(entities, new Map(), 1, 19008);
    expect(entities.get(19008)!.ownerAid).toBe(1);
  });

  it("ignores a Companions elemental AID that never spawned or is not an elemental", () => {
    const entities = new Map<number, Entity>([
      [1, entity(1, "pc")],
      [22492, entity(22492, "mob")],
    ]);
    resolveOwners(entities, new Map(), 1, 22492);
    expect(entities.get(22492)!.ownerAid).toBeUndefined();
  });
});
