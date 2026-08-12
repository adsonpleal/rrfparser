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
/**
 * Local wall-clock rendering. The header stores the recorder's clock with no
 * zone, so the Date is constructed as local time — rendering it as UTC (which
 * is what `Date.prototype.toJSON` does) would make the snapshot depend on the
 * timezone of whatever machine ran the tests.
 */
function localStamp(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

export function canonical(r: Replay): string {
  return JSON.stringify(
    r,
    // Not an arrow function, and the Date is read off `this` rather than from
    // `v`: JSON.stringify calls toJSON() before handing the value to the
    // replacer, so by the time a Date arrives here it is already a UTC string.
    function (this: Record<string, unknown>, k: string, v: unknown) {
      const raw = this[k];
      if (raw instanceof Date) return { $localDate: localStamp(raw) };
      if (typeof v === "bigint") return { $bigint: v.toString() };
      if (v instanceof Map) {
        return {
          $map: [...v.entries()].sort((a, b) => (a[0] > b[0] ? 1 : -1)),
        };
      }
      if (v instanceof Set) return { $set: [...v].sort() };
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
