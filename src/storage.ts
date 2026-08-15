/**
 * What a storage held at the end of a recording.
 *
 * {@link Replay.storages} is a log, not a state: one listing per time the player
 * opened the window, and {@link Replay.storageChanges} separately holds every
 * deposit and withdrawal. Turning that into "what is in the Kafra storage" takes
 * three pieces of protocol knowledge that have nothing to do with what any
 * consumer is trying to do:
 *
 *   - the **last** listing of a kind wins, because the server relists the whole
 *     contents on every open, so changes from before it are already reflected
 *     there and reapplying them would count the same deposit twice;
 *   - `index` is the server's handle for a stack, not a storage position, so it
 *     is what a change event correlates on;
 *   - a withdrawal carries only that index, so a change for an index the listing
 *     never mentioned cannot be resolved and must be dropped rather than added
 *     as a phantom item with `itemId` 0.
 *
 * Until 1.2 this module did not exist and the docs told every consumer to do it
 * themselves. Three of them started to, which is the same duplication that
 * putting the parser in one library was meant to end — so it lives here, once.
 */

import type {
  Replay,
  StorageChangeEvent,
  StorageItem,
  StorageKind,
  StorageSnapshot,
} from "./types.js";

/**
 * Apply deposits and withdrawals to a storage listing, in the order they came.
 *
 * Pure and independent of {@link Replay} so it can be driven with hand-built
 * input: no recording we have moves an item with the window open, and this is
 * the path that would otherwise go untested.
 *
 * The input is not mutated. A change for an index the listing does not hold is
 * treated as an insert when it is a deposit (the packet carries the item) and
 * ignored when it is a withdrawal (it does not).
 */
export function applyStorageChanges(
  items: readonly StorageItem[],
  changes: readonly StorageChangeEvent[],
): StorageItem[] {
  const byIndex = new Map(items.map((i) => [i.index, { ...i }]));

  for (const change of changes) {
    const current = byIndex.get(change.index);

    if (change.added) {
      if (current) current.qty += change.amount;
      else {
        byIndex.set(change.index, {
          index: change.index,
          itemId: change.itemId,
          qty: change.amount,
          equipped: 0,
          refine: change.refine,
          grade: change.grade,
          cards: change.cards,
          options: change.options,
        });
      }
      continue;
    }

    if (!current) continue;
    current.qty -= change.amount;
    if (current.qty <= 0) byIndex.delete(change.index);
  }

  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

/**
 * The contents of one storage at the end of the recording, or `null` when the
 * player never opened that window.
 *
 * `null` and empty are different answers: `null` is "the recording cannot say",
 * and a storage that was opened while empty comes back as a snapshot with no
 * items. Collapsing the two turns "you never visited a Kafra" into "your storage
 * is empty".
 *
 * The returned snapshot keeps the listing's own `time`, `usedSlots` and
 * `maxSlots` — they describe the moment the window opened, so after changes are
 * applied `usedSlots` can disagree with `items.length`. That disagreement is
 * worth reading rather than smoothing over: on a listing with no changes after
 * it, the two differing means the list arrived split across packets and one was
 * lost, so the contents are short of what is really stored.
 */
export function storageAt(
  replay: Replay,
  kind: StorageKind,
): StorageSnapshot | null {
  const last = replay.storages.filter((s) => s.kind === kind).at(-1);
  if (!last) return null;

  // `>=`, not `>`: a listing and a movement can land in the same millisecond,
  // and in that tie the movement is the later of the two — there is no
  // depositing into a window that has already closed.
  const after = replay.storageChanges.filter(
    (c) => c.kind === kind && c.time >= last.time,
  );

  return { ...last, items: applyStorageChanges(last.items, after) };
}

/**
 * Every storage the recording can speak for, at the end of it.
 *
 * The shorthand for consumers that just want to show what the player has, with
 * the kinds that were never opened left out entirely rather than present as
 * `null`.
 *
 * Ordered by kind — Kafra, then clan — and **not** by when each was opened. The
 * order is fixed so a UI's columns do not move between recordings; for the
 * chronology, read `time` or {@link Replay.storages}.
 */
export function storagesAt(replay: Replay): StorageSnapshot[] {
  const kinds: StorageKind[] = ["storage", "guildStorage"];
  return kinds
    .map((kind) => storageAt(replay, kind))
    .filter((s): s is StorageSnapshot => s !== null);
}
