import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Read a binary replay fixture as an ArrayBuffer (what `decodeReplay` expects). */
export function loadReplayFixture(name: string): ArrayBuffer {
  const buf = readFileSync(resolve(here, "fixtures", name));
  // `Buffer` is a view onto a shared pool — without the slice, a DataView built
  // over it would read bytes from other files Node loaded into the same pool.
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

export const FIXTURES = [
  "mergulho-test.rrf",
  "nw-mira-pet.rrf",
  "nw-ult-mira.rrf",
  "nw-ult.rrf",
  "sn-buffs-potion.rrf",
  "em-endow-learned-not-active.rrf",
  "hn-magic-lv1.rrf",
  "equip-test-2.rrf",
  "wh-ilimitar.rrf",
  "storage-kafra-clan.rrf",
  "sx-traits-maploaded.rrf",
] as const;
