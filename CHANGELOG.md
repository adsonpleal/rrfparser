# Changelog

## 1.4.0

### Added

- **Two new `EntityKind`s: `"abr"` and `"bionic"`.** The Meister's ABR robots
  spawn with object type `0x0d` and the Biolo's summons (Wooden Warrior, Wooden
  Fairy, Creeper, Hell Tree) with `0x0e`. Neither is in rAthena's table, so both
  came out as `"unknown"` — and a consumer that filters on kind treated a
  Meister's cannon as a monster that took damage rather than as something that
  dealt it. Established from a 240-replay corpus: `0x0d` only ever carries the
  ABR ids (20834-20837) and `0x0e` only the Biolo summon ids (20848-20851).
  `0x0c`, the hidden script NPCs (traps, a boss's controller), stays `"unknown"`.

- **`Entity.ownerAid` — who a summon belongs to.** The spawn packet's GID field
  holds the master's AID for pets, homunculi, mercenaries, elementals, ABRs,
  bionics and monsters a skill puts on the field (a Mechanic's turret, an Oboro's
  shadow clone). It is set only when that AID is a player the recording saw: a
  boss's GID names the script NPC that spawned it, and a player's own GID is their
  character id. Resolved after the whole stream is read, since the master can
  spawn after the summon. The recorder's own elemental also comes from the
  Companions container (chunk 5401), which names it even when no spawn packet in
  the file does.

  Over the corpus every resolved owner is a class that can have that summon
  (ABR → Meister, bionic → Biolo, elemental → Elemental Master/Sorcerer,
  homunculus → Genetic/Biolo), and 99.9% of the damage dealt by summons lands on
  one with an owner.

### Notes

- Adding members to the `EntityKind` union is a type-level change for a consumer
  with an exhaustive `switch` over it; nothing about existing kinds moved.

## 1.3.0

Traits found and documented by **Kiulg** (ROCalcRE), maintainer of a sibling
fork of the simulator: that `ZC_COUPLESTATUS` (0x0141) is their only carrier,
that no container holds them, and that the six Session chunks which look like
traits are the stat need-points. This release is that write-up implemented and
verified against a 576-replay corpus.

### Added

- **`Replay.traits` — the 4th-job traits, where they actually live.** POW/STA/
  WIS/SPL/CON/CRT are in no container. The six Session chunks that sit right
  after `luk` and look exactly like them are the stat need-points instead: they
  match rAthena's `PC_STATUS_POINT_COST` on every fixture, are populated for a
  level-26 Merchant that cannot have traits at all, and drop to `0` precisely
  when a stat reaches its cap. The only carrier is `ZC_COUPLESTATUS` (0x0141),
  now decoded.

  ```ts
  replay.traits; // { pow: 100, sta: 0, wis: 0, spl: 0, con: 11, crt: 38 }
  replay.traits; // {} — this recording cannot say
  ```

  A missing field means unknown, never zero: a character with no traits reports
  six real zeros, which is a different fact from silence. Nothing is estimated
  or back-derived.

  **Most recordings carry none.** The server sends all six from
  `clif_initialstatus` — at login, which predates the recording, and on every
  map load, which does not. A recording with a teleport in it therefore has all
  six about 300 ms after the `0x0091`; one that never changes map has none, or
  only whichever trait a buff modified mid-recording. Measured over 576
  replays: 11% of all of them, 37% of 4th-job ones, and 100% of 4th-job ones
  containing a map load.

- **`Replay.coupleStatus`** — the raw 0x0141 log, with `base` (the allocation)
  and `plus` (the transient gear/buff delta) kept apart, since a build importer
  and a buff simulator want different halves. `traitsFromCoupleStatus` is
  exported for consumers that collect the events themselves.

  The same packet carries ids 13-18 for the primary stats, which is what
  establishes `base` = "allocated" rather than assuming it: for those ids it
  equals the allocated STR/AGI/VIT/INT/DEX/LUK already in the container
  snapshot of the same file.

### Notes

- The derived stats in `paramChanges` (P.Atk, S.MAtk, Res, MRes, HPlus, CRate,
  ids 225-230) are linear in the traits and look invertible. They are not
  usable for it: they are post-gear values and gear adds without bound. Against
  65 known-good builds the inversion was exact 19-40% of the time and overshot
  by as much as 79, and the obvious internal consistency check
  (`floor(hplus/3) === crate`) passed on 61 of 63 files while being wrong on 42
  of them. Traits come from `base` or not at all.

## 1.2.0

### Added

- **`storageAt(replay, kind)` — the storages as contents, not as a log.** 1.1.0
  shipped them as `Replay.storages` plus `Replay.storageChanges` and told each
  consumer to combine the two themselves. That was the wrong place to draw the
  line: doing it correctly takes three pieces of protocol knowledge that have
  nothing to do with what a consumer is trying to do, and consumers had already
  started writing their own answers to them. It lives here now, once.

  ```ts
  const kafra = storageAt(replay, "storage"); // null when never opened
  const both = storagesAt(replay);            // never-opened ones left out
  ```

  `null` is not an empty storage: it means the recording cannot say, while a
  storage opened while empty comes back as a snapshot with no items.

  The three parts it settles. The **last** listing of a kind is the current one,
  and because the server relists the full contents on every open, movements from
  before it are already counted there — reapplying them silently doubles a stack.
  A movement in the same millisecond as the listing counts as after it, since a
  window that has closed cannot be deposited into. And a withdrawal carries only
  an index, so one for an index no listing mentioned is dropped rather than added
  as a phantom stack with `itemId` 0.

- **`applyStorageChanges(items, changes)`** — the merge by itself, for driving it
  against something other than a decoded `Replay`. Pure, and it does not mutate
  its input.

### Changed

- `Replay.storages` and `Replay.storageChanges` are untouched and still the raw
  log. Only the docs changed: they point at `storageAt` first, because reading
  `storages[0]` directly misses later opens and every deposit.

## 1.1.0

### Added

- **`Replay.storages` — the Kafra and clan storages.** They were assumed to be
  unreachable from a recording, on the theory that the item chunks 4511-4522
  were where they would have lived. They are reachable, just not from the
  containers: a recording taken with both storages open leaves those chunks as
  empty as every other recording does, because the contents arrive over the
  wire. When the player opens a storage, the server sends it as an item-list
  group (`0x0b08` begin / `0x0b09` stackables / `0x0b0a` or `0x0b39` gear /
  `0x0b0b` end), and that is the only place it is on record. `storages` holds
  one snapshot per open, with the same record shape as a bag item — id, qty,
  refine, grade, cards and random options — plus the server's own slot count.
- **`Replay.storageChanges`** — deposits (`0x0a0a`) and withdrawals (`0x00f6`)
  while a storage was open. A withdrawal packet carries only an index, so the
  item that left is resolved from the running storage contents, the same way
  `itemDeletes` resolves against the inventory.

The record layouts were pinned against the same packets sent for the **bag**
(`invType` 0), which the containers also hold: across 29 recordings, 2455 of
2771 records agree field for field, and every disagreement is a stack whose
quantity moved between the snapshot and the packet, or an option list the older
172-byte container record ends too early to carry. As an end-to-end check, every
storage snapshot in the corpus holds exactly as many stacks as the server's own
count packet reports.

## 1.0.0

First stable release — `1.0.0-rc.2` promoted with the prerelease suffix
dropped, no code changes. The two entries below are what the rc line added on
top of `1.0.0-rc.1`, whose notes follow.

### Added

- **`InventoryRecord.grade` — the enchant grade** (`0` none, `1` D, `2` C, `3` B,
  `4` A, as rAthena's `enchantgrade`). This is the `[C]` the client prints in
  front of a refine, and every consumer that rebuilds a character from a
  recording was losing all of its bonuses. Measured on one real build: a Grau C
  Gakkung Primordial-LT imported ungraded put a damage simulation 12.2% low
  unbuffed and 5.9% low under a ranged buff. `EquipChangeEvent.grade` carries
  the same value, resolved from the snapshot like `refine` and `cards`.

### Changed

- **Item records are read through their TLV chain rather than at hardcoded
  offsets.** A record is `tag u16 | len u32 | value[len]` repeated to the end of
  the record; the reference parser this library inherited its offsets from
  hardcoded where each field lands, which is why it stopped at the fields it
  knew about and the grade was never reachable. The absolute offsets remain as a
  fallback for any record whose chain does not close exactly on the record
  boundary, so an unrecognised layout decodes no worse than before. Every field
  of all 847 records in the fixture corpus decodes identically either way.

The grade is the field immediately before the random-option **count**, and on
the one graded item available both read `2` — the weapon is Grau C and happens
to carry 2 random options. They are told apart by the other 845 records, where
the count tracks the populated option entries exactly and the grade stays 0.
`test/items.spec.ts` pins both halves of that.

## 1.0.0-rc.1

First release. Merges the three forked copies of this parser that lived in
[ragreplaystats](https://github.com/adsonpleal/ragreplaystats),
[latam-ro-calc](https://github.com/adsonpleal/latam-ro-calc) and
[latam-market](https://github.com/adsonpleal/latam-market) into one library.

Validated by decoding 566 real recordings with all three original decoders and
the merged one, and accounting for every single difference.

### Fixed

- **The item containers are no longer merged into one map.** Inventory and cart
  both number their slots from zero, so a cart item at slot 4 disappeared behind
  the bag item at slot 4 — or leaked into the bag when only the cart had that
  slot. Across the corpus this moved 3180 records out of the inventory view, 18
  of them ammunition stacks that a damage simulator was reading as the character's
  equipped ammo.
- **Buff durations are no longer discarded.** Buffs that appear both in the
  EfstList container and as a status packet were being collapsed in favour of the
  container's duration-less copy, so a consumer that expires buffs from `leftMs`
  never expired them. 70 real durations recovered across the corpus.

### Added

Each fork knew things the others didn't; the merge is the union.

- `decodeSnapshot` — character and items from the containers, with no packet
  stream, so a consumer that only wants the snapshot tree-shakes every packet
  decoder away. Measured on latam-market: swapping its hand-rolled parser for
  the library grew the bundle by 1.4 KB. `decodeInventory` is the same narrowed
  to the items.
- Packets `0x010f` (learned skill tree), `0x07fb` (cast start), `0x01f3` (visual
  effects), `0x0086`/`0x0087`/`0x0088` (movement), `0x0229` (mount/cloak state)
  are now all decoded regardless of which fork you came from. Across the corpus
  this recovers 126,806 skill casts that one fork was dropping.
- `sessionInfo` gains job level, the six allocated base stats, the starting cell
  and the OPTION bitmask.
- `pet` (including intimacy, which exists in no packet) and `learnedSkills`.
- `items`, `vanishes`, `optionChanges`, `moves`, `positions`, `groundSkillUnits`
  and `notifyEffects`.
- Entities carry the spawn packet's worn-gear sprite ids and OPTION bitmask.
- `durationMs` prefers the duration the recorder stored over the packet span,
  which runs short when the recording keeps rolling past the last action.

### Notes for anyone porting off a fork

- `cards` is a positional, zero-padded 4-tuple everywhere. If your code assumed a
  filtered list, filter at your own edge.
- `initialInventory` is unchanged in shape and is still the merged view, minus
  the cart. `items` is the new, correct, per-container shape.
- `ContainerType.UnknownContainingPet` is now `ContainerType.Companions`.
