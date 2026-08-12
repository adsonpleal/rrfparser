# rrfparser

Read Ragnarok Online `.rrf` replay files from TypeScript. The same code runs in Node and in the browser — no `Buffer`, no `fs`, no DOM, no dependencies.

```bash
npm i rrfparser
```

## Quick start

**Browser**

```ts
import { decodeReplay } from "rrfparser";

const buf = await file.arrayBuffer(); // file: File, from an <input type="file">
const replay = decodeReplay(buf);

console.log(replay.sessionInfo.player, "on", replay.sessionInfo.map);
```

**Node**

```ts
import { readFileSync } from "node:fs";
import { decodeReplay } from "rrfparser";

const b = readFileSync("session.rrf");
// The slice matters. A Node `Buffer` is a view onto a shared pool, so without
// it the parser's DataView reads bytes belonging to other files Node happened
// to load into the same pool. This is the single most common integration bug.
const replay = decodeReplay(
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
);
```

If you only care about the state at the start of the recording, use `decodeSnapshot` instead. It reads the header, containers, character and items and never touches the packet stream, so a bundler drops every packet decoder from your build: 6.2 KB minified against 21.4 KB for `decodeReplay`.

```ts
import { decodeSnapshot } from "rrfparser";

const { session, items, pet } = decodeSnapshot(buf);
console.log(session.player, items.cart.length);
```

`decodeInventory(buf)` is the same thing narrowed to `items`.

## What it decodes

A `.rrf` file is two things: a set of **containers** holding a snapshot of the character at the moment recording began, and a **packet stream** of everything the server sent afterwards. `decodeReplay` reads both and returns them merged into one `Replay`.

| From the snapshot | |
| --- | --- |
| `sessionInfo` | name, map, account id, job, base/job level, sex, hair and clothes palette, allocated STR/AGI/VIT/INT/DEX/LUK, starting cell, duration |
| `items` | the item snapshot, split per container: `inventory`, `cart`, `equipped`, `equippedCostume`, plus `unknown` |
| `pet` | the pet that was out, including **intimacy** — which appears in no packet anywhere |
| `learnedSkills` | the full skill tree (`ZC_SKILLINFO_LIST`) |
| `statusEvents` (t=0) | buffs applied *before* recording started, which never emit a packet |

| From the packet stream | |
| --- | --- |
| `damage` | auto-attacks and skill hits, with hit type, hit count and skill level |
| `skillUses` / `skillCasts` | skill activations and cast bars |
| `entities` | every player, mob and NPC seen, with worn-gear sprite ids |
| `moves` / `positions` | walk commands and forced position snaps |
| `groundSkillUnits` | AoE ground units, attributed back to the skill that placed them |
| `mobHp`, `vanishes`, `kills` | health updates and despawns |
| `itemAdds` / `itemDeletes` / `equipChanges` | inventory changes over time |
| `paramChanges`, `statusEvents`, `optionChanges`, `notifyEffects`, `chats` | stats, buffs, mounts, effects, chat |

The item snapshot is the state at recording **start**. Items picked up afterwards arrive as `itemAdds`.

### Card sockets are positional

`InventoryRecord.cards` is always four entries, with `0` for an empty socket:

```ts
rec.cards; // [300732, 29537, 29539, 29539]  card + three enchants
rec.cards; // [0, 29660, 0, 0]               socket 0 empty, enchant in socket 1
```

Do not filter the zeros. Which socket an enchant occupies is meaningful, and `[0, 29660, 0, 0]` collapsing to `[29660]` silently moves that enchant into socket 0 — 415 records in a 564-replay corpus have exactly this shape. If you just want a list of names, filter at your own edge.

### `equipped` means "worn" only in the worn containers

The bitmask is present on bag and cart records too, where it is the item's equip *location* rather than its state. Read what is actually worn from `items.equipped` and `items.equippedCostume`. Merging every container into one list — which is what the forks this library replaces did — makes a cart full of cannonballs look like the equipped ammo.

Inventory and cart also both number their slots from zero, so merging them makes a cart item at slot 4 vanish behind the bag item at slot 4. If you want the old merged shape anyway, `toInventoryMap(items)` builds it (worn, then costume, then bag — cart excluded), and `replay.initialInventory` is that view precomputed.

### `recordedAt` is a wall clock, not an instant

The header stores the recorder's local date and time with no timezone, so `sessionInfo.recordedAt` is a `Date` built from those components in *your* runtime's zone. The wall-clock reading is faithful; the underlying instant is only correct if you are in the same zone as whoever recorded it. Format it with local getters (`getHours()`), not `toISOString()`.

### Character names

Names are `euc-kr`. The decoder tries `euc-kr` first and falls back to Windows-1252, which is how western and Brazilian servers store them — that fallback is why `Preá` decodes correctly. On a runtime that ships without the euc-kr table (Node built with small-icu, some edge runtimes) everything still works; only the Windows-1252 path is taken.

## API

| Export | |
| --- | --- |
| `decodeReplay(buf)` | the whole file → `Replay` |
| `decodeSnapshot(buf)` | the containers only, no packet stream → `ReplaySnapshot` |
| `decodeInventory(buf)` | just the item snapshot → `ItemContainers` |
| `toInventoryMap(items)` | merged single-map view of the item snapshot |
| `readHeader`, `deriveKeys`, `decryptChunk` | the header and its keystream |
| `readContainers`, `findContainer`, `ContainerType` | raw container access |
| `readItemContainers` | items from already-read containers |
| `decodePacket`, `PacketIds` | decode one packet in isolation |
| `ByteReader`, `readKoreanZ`, `readEntityName` | the primitives, for writing your own decoder |
| `inspectContainers`, `inspectPacketStream`, `inspectEntityPackets` | debugging aids. Unstable — the shape may change in a minor release |

All types are exported: `Replay`, `SessionInfo`, `Entity`, `ItemContainers`, `ItemRecord`, `InventoryRecord`, `DamageEvent`, `PetSnapshot`, and the rest.

## Adding a packet

1. Add the id to `PacketIds` in `src/packets/index.ts`.
2. Write the decoder in `src/packets/`, taking a `ByteReader` (or the raw `Uint8Array` if the packet is variable-length and you need its own length field).
3. Add an arm to the `DecodedPacket` union and a `case` to the dispatcher.
4. Accumulate it in `src/decode.ts`.
5. Add a spec backed by a real recording. Offsets guessed from a wiki are how field-shift bugs get in.

## Compatibility

Node 18+ and any modern browser. Ships ESM, CommonJS and type declarations; the declarations resolve under node10, node16 and bundler resolution, so older toolchains (Angular 16 and friends) work without a shim.

Developed against the LATAM client's recordings. The format comes from kRO, so other derived clients should work, but they are untested — the header check rejects anything that is not replay version 5.

## Credit

The container format, the key derivation and the `EQUIPITEM_INFO` field offsets were all worked out by reading **[Tokeiburu/Rrf-Parser](https://github.com/Tokeiburu/Rrf-Parser)**, a C# `.rrf` parser by [Tokeiburu](https://github.com/Tokeiburu). This project is an independent TypeScript implementation, but it would not exist without that one — the record offsets in `src/items.ts` cite `ReplayService.cs:154-184` directly.

## Used by

- **[ragreplaystats](https://github.com/adsonpleal/ragreplaystats)** — RagnaRecap: damage and skill statistics from a replay, in the browser, with a map viewer that plays the session back.
- **[latam-ro-calc](https://github.com/adsonpleal/latam-ro-calc)** — damage simulator for RO LATAM; imports a recording straight into a build.
- **[latam-market](https://github.com/adsonpleal/latam-market)** — market API and MCP server; prices the inventory in a replay.

## License

MIT. The `.rrf` files under `test/fixtures/` are the author's own recordings, included so the parser is tested against real data rather than hand-built bytes.
