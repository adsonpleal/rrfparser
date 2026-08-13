# Changelog

## 1.0.0-rc.2

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
