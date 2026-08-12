/**
 * A full-output snapshot per fixture.
 *
 * The targeted specs pin the values anyone reasoned about; this one pins
 * everything else. Any packet decoder that starts reading a different offset
 * shows up here even when no named assertion covers that field.
 */
import { describe, expect, it } from "vitest";
import { decodeReplay, type Replay } from "../src/index.js";
import { FIXTURES, loadReplayFixture } from "./load-fixture.js";

/**
 * `Replay` holds Map, Set, Date and bigint, none of which JSON.stringify can
 * represent. Map and Set entries are also sorted: their insertion order is
 * packet order, which is stable, but sorting removes a whole class of false
 * failures if that order ever shifts without the content changing.
 */
export function canonical(r: Replay): string {
  return JSON.stringify(
    r,
    (_k, v: unknown) => {
      if (typeof v === "bigint") return { $bigint: v.toString() };
      if (v instanceof Map) {
        return {
          $map: [...v.entries()].sort((a, b) => (a[0] > b[0] ? 1 : -1)),
        };
      }
      if (v instanceof Set) return { $set: [...v].sort() };
      if (v instanceof Date) return { $date: v.toISOString() };
      return v;
    },
    1,
  );
}

describe("decoded output is stable", () => {
  it.each(FIXTURES)("%s", (name) => {
    expect(canonical(decodeReplay(loadReplayFixture(name)))).toMatchSnapshot();
  });
});
