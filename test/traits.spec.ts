import { describe, expect, it } from "vitest";
import {
  decodePacket,
  decodeReplay,
  traitsFromCoupleStatus,
  type CoupleStatusEvent,
} from "../src/index.js";
import { FIXTURES, loadReplayFixture } from "./load-fixture.js";

/** Build one 0x0141 packet exactly as the wire carries it. */
function coupleStatusPacket(statusId: number, base: number, plus: number) {
  const buf = new Uint8Array(14);
  const dv = new DataView(buf.buffer);
  dv.setUint16(0, 0x0141, true);
  dv.setInt32(2, statusId, true);
  dv.setInt32(6, base, true);
  dv.setInt32(10, plus, true);
  return buf;
}

describe("0x0141 ZC_COUPLESTATUS wire format", () => {
  it("reads statusId, base and plus at fixed offsets", () => {
    // Byte-for-byte the first trait event in hn-magic-lv1.rrf:
    //   41 01 | de 00 00 00 | 64 00 00 00 | 13 00 00 00
    const raw = new Uint8Array([
      0x41, 0x01, 0xde, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0x13, 0x00,
      0x00, 0x00,
    ]);
    const decoded = decodePacket(raw, 26920);
    expect(decoded).toEqual({
      type: "coupleStatus",
      data: { time: 26920, statusId: 222, base: 100, plus: 19 },
    });
  });

  it("returns null rather than throwing on a truncated packet", () => {
    expect(decodePacket(coupleStatusPacket(219, 100, 0).slice(0, 9), 0)).toBe(
      null,
    );
  });
});

describe("traitsFromCoupleStatus", () => {
  const ev = (statusId: number, base: number, time = 0): CoupleStatusEvent => ({
    time,
    statusId,
    base,
    plus: 0,
  });

  it("maps the six rAthena status ids onto the trait names", () => {
    expect(
      traitsFromCoupleStatus([
        ev(219, 1),
        ev(220, 2),
        ev(221, 3),
        ev(222, 4),
        ev(223, 5),
        ev(224, 6),
      ]),
    ).toEqual({ pow: 1, sta: 2, wis: 3, spl: 4, con: 5, crt: 6 });
  });

  it("keeps the LAST base — a point spent mid-recording wins", () => {
    // Ground truth for this shape: ELMUMYVYk3.rrf, where con goes 45 -> 46 at
    // t=633226 and every later burst reports 46.
    const traits = traitsFromCoupleStatus([
      ev(223, 45, 42886),
      ev(223, 46, 633226),
      ev(223, 46, 789534),
    ]);
    expect(traits.con).toBe(46);
  });

  it("ignores `plus` entirely", () => {
    // The same base with a swinging buff delta must not move the trait.
    const traits = traitsFromCoupleStatus([
      { time: 1, statusId: 222, base: 100, plus: 8 },
      { time: 2, statusId: 222, base: 100, plus: 22 },
    ]);
    expect(traits.spl).toBe(100);
  });

  it("leaves an unmentioned trait absent instead of defaulting it to zero", () => {
    const traits = traitsFromCoupleStatus([ev(222, 100)]);
    expect(traits.spl).toBe(100);
    expect(traits.pow).toBeUndefined();
    expect("pow" in traits).toBe(false);
  });

  it("distinguishes a real zero from a missing trait", () => {
    // A non-4th-job character reports all six as a genuine 0.
    const traits = traitsFromCoupleStatus([ev(219, 0), ev(224, 0)]);
    expect(traits.pow).toBe(0);
    expect(traits.sta).toBeUndefined();
  });

  it("skips status ids that are not traits", () => {
    // 225 = SP_PATK, 232 = SP_AP. Both ride 0x00b0, but a stray one here must
    // not become a trait.
    expect(traitsFromCoupleStatus([ev(225, 112), ev(232, 200)])).toEqual({});
  });
});

describe("traits from a recording with a map load (sx-traits-maploaded.rrf)", () => {
  // Ground truth: a Shadow Cross (job 4254) at base level 238. The server sent
  // all six traits ~300ms into the recording; the same character in a second
  // recording a day later shows the same total (149) redistributed, which is a
  // respec, not a decode difference.
  const replay = decodeReplay(loadReplayFixture("sx-traits-maploaded.rrf"));

  it("recovers the complete six-trait set", () => {
    expect(replay.traits).toEqual({
      pow: 100,
      sta: 0,
      wis: 0,
      spl: 0,
      con: 11,
      crt: 38,
    });
  });

  it("keeps every raw event, base separate from plus", () => {
    // 27 events in all: 12 traits plus 15 for SP_USTR..SP_ULUK, which ride the
    // same packet.
    expect(replay.coupleStatus).toHaveLength(27);
    const pow = replay.coupleStatus.filter((e) => e.statusId === 219);
    // Two bursts, identical allocation, different buff delta.
    expect(pow.map((e) => e.base)).toEqual([100, 100]);
    expect(pow.map((e) => e.plus)).toEqual([31, 36]);
  });

  it("does not dedupe same-millisecond bursts", () => {
    // The whole first trait burst lands on t=5462 — six ids, then three of them
    // again with a larger `plus`. Collapsing by time would lose half of it.
    expect(replay.coupleStatus.filter((e) => e.time === 5462)).toHaveLength(9);
  });

  it("agrees with the container snapshot on what `base` means", () => {
    // Ids 13-18 (SP_USTR..SP_ULUK) carry the primary stats through the very same
    // packet, and their `base` must equal the allocated STR/AGI/VIT/INT/DEX/LUK
    // the Session container holds. That pins `base` = allocation against an
    // independent source in the same file — the traits then inherit it, since
    // they are the identical field of the identical packet.
    const firstBase = new Map<number, number>();
    for (const e of replay.coupleStatus)
      if (!firstBase.has(e.statusId)) firstBase.set(e.statusId, e.base);
    const s = replay.sessionInfo;
    expect([13, 14, 15, 16, 17, 18].map((id) => firstBase.get(id))).toEqual([
      s.str,
      s.agi,
      s.vit,
      s.int,
      s.dex,
      s.luk,
    ]);
  });
});

describe("traits from a buff-only recording (hn-magic-lv1.rrf)", () => {
  // No map load in this one: the only reason any trait appears is a buff that
  // modified SPL twelve times. A partial result is the correct result here.
  const replay = decodeReplay(loadReplayFixture("hn-magic-lv1.rrf"));

  it("recovers only the trait the stream actually carried", () => {
    expect(replay.traits).toEqual({ spl: 100 });
  });

  it("carries every 0x0141 event with a moving plus", () => {
    expect(replay.coupleStatus).toHaveLength(12);
    expect(new Set(replay.coupleStatus.map((e) => e.base))).toEqual(
      new Set([100]),
    );
    expect(new Set(replay.coupleStatus.map((e) => e.plus))).toEqual(
      new Set([8, 11, 12, 15, 19, 22]),
    );
  });
});

describe("traits are never invented", () => {
  it("is an empty object for every fixture whose stream carried no 0x0141", () => {
    const withoutTraits = FIXTURES.filter(
      (f) => f !== "hn-magic-lv1.rrf" && f !== "sx-traits-maploaded.rrf",
    );
    for (const name of withoutTraits) {
      const replay = decodeReplay(loadReplayFixture(name));
      expect(replay.coupleStatus, name).toEqual([]);
      expect(replay.traits, name).toEqual({});
    }
  });

  it("never reads traits out of the container snapshot", () => {
    // equip-test-2.rrf is a level-26 Merchant: session chunks 1030-1035 hold
    // stat need-points that look trait-shaped (5,2,2,2,3,2). A parser that read
    // them as traits would report six values for a character that has none.
    const replay = decodeReplay(loadReplayFixture("equip-test-2.rrf"));
    expect(replay.traits).toEqual({});
  });
});
