# Changelog

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
