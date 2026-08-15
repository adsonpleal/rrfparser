import {
  type AnyContainer,
  ContainerType,
  findContainer,
  type GenericContainer,
  type PacketStreamContainer,
  readContainers,
} from "./containers.js";
import { deriveKeys } from "./crypt.js";
import { readHeader } from "./header.js";
import { readItemContainers, toInventoryMap } from "./items.js";
import { decodePacket } from "./packets/index.js";
import { traitsFromCoupleStatus } from "./packets/status.js";
import { readKoreanZ } from "./reader.js";
import type {
  ChatEvent,
  CoupleStatusEvent,
  DamageEvent,
  Entity,
  EntityKind,
  EquipChangeEvent,
  FixPosEvent,
  InventoryRecord,
  ItemAddEvent,
  ItemContainers,
  ItemDeleteEvent,
  MapChange,
  MobHpUpdate,
  MoveEvent,
  NotifyEffectEvent,
  OptionChangeEvent,
  ParamChangeEvent,
  PetSnapshot,
  GroundSkillUnit,
  Replay,
  SessionInfo,
  SkillCast,
  SkillUse,
  StatusEvent,
  StorageChangeEvent,
  StorageItem,
  StorageKind,
  StorageSnapshot,
  VanishEvent,
} from "./types.js";
import { InventoryListType } from "./packets/storage.js";

/**
 * Everything the containers hold, without decoding the packet stream.
 *
 * `durationMs` is absent because it is partly a property of the stream; every
 * other session field comes from the snapshot and is present here.
 */
export type ReplaySnapshot = {
  session: Omit<SessionInfo, "durationMs">;
  items: ItemContainers;
  pet?: PetSnapshot;
};

/**
 * Header, containers, character and item snapshot — without touching the packet
 * stream.
 *
 * A separate entry point rather than a field of {@link decodeReplay} so a
 * consumer that only wants the snapshot can tree-shake every packet decoder out
 * of its bundle. `decodeReplay` transitively references all of them, so reaching
 * for it would pull in the lot.
 */
export function decodeSnapshot(buf: ArrayBuffer): ReplaySnapshot {
  const header = readHeader(buf);
  const keys = deriveKeys(header.recordedAt);
  const containers = readContainers(buf, header.containerTableOffset, keys);
  const recordedAt = new Date(
    header.recordedAt.year,
    header.recordedAt.month - 1,
    header.recordedAt.day,
    header.recordedAt.hour,
    header.recordedAt.minute,
    header.recordedAt.second,
  );
  return {
    session: extractSessionInfo(containers, recordedAt),
    items: readItemContainers(containers),
    pet: extractPet(containers),
  };
}

/** The item snapshot alone. Shorthand for `decodeSnapshot(buf).items`. */
export function decodeInventory(buf: ArrayBuffer): ItemContainers {
  const header = readHeader(buf);
  const keys = deriveKeys(header.recordedAt);
  return readItemContainers(readContainers(buf, header.containerTableOffset, keys));
}

export function inspectEntityPackets(buf: ArrayBuffer, max = 6) {
  const header = readHeader(buf);
  const keys = deriveKeys(header.recordedAt);
  const containers = readContainers(buf, header.containerTableOffset, keys);
  const ps = containers.find(
    (c): c is PacketStreamContainer => c.kind === "packetStream",
  );
  const entries: Array<{ packetId: string; len: number; hex: string; tail: string }> = [];
  if (!ps) return entries;
  for (const chunk of ps.chunks) {
    if (
      chunk.packetId === 0x09fd ||
      chunk.packetId === 0x09fe ||
      chunk.packetId === 0x09ff ||
      chunk.packetId === 0x0915
    ) {
      entries.push({
        packetId: chunk.packetId.toString(16),
        len: chunk.data.length,
        hex: Array.from(chunk.data)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(" "),
        tail: "",
      });
      if (entries.length >= max) break;
    }
  }
  return entries;
}

export function inspectPacketStream(buf: ArrayBuffer) {
  const header = readHeader(buf);
  const keys = deriveKeys(header.recordedAt);
  const containers = readContainers(buf, header.containerTableOffset, keys);
  const ps = containers.find(
    (c): c is PacketStreamContainer => c.kind === "packetStream",
  );
  if (!ps) return [];
  return ps.chunks.map((ch) => ({
    time: ch.time,
    id: ch.packetId,
    len: ch.length,
    hex: Array.from(ch.data)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" "),
  }));
}

export function inspectContainers(buf: ArrayBuffer) {
  const header = readHeader(buf);
  const keys = deriveKeys(header.recordedAt);
  const containers = readContainers(buf, header.containerTableOffset, keys);
  return containers.map((c, i) => ({
    index: i,
    type: c.type,
    kind: c.kind,
    declaredLength: c.declaredLength,
    realLength: c.realLength,
    offset: c.offset,
    chunkCount: c.chunks.length,
    chunkPreview: c.chunks.map((ch) => ({
      id: (ch as { id: number }).id,
      length: (ch as { length: number }).length,
      first16: Array.from((ch as { data: Uint8Array }).data)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" "),
    })),
  }));
}

export function decodeReplay(buf: ArrayBuffer): Replay {
  const header = readHeader(buf);
  const keys = deriveKeys(header.recordedAt);
  const containers = readContainers(buf, header.containerTableOffset, keys);

  const recordedAt = new Date(
    header.recordedAt.year,
    header.recordedAt.month - 1,
    header.recordedAt.day,
    header.recordedAt.hour,
    header.recordedAt.minute,
    header.recordedAt.second,
  );

  const session = extractSessionInfo(containers, recordedAt);

  const entities = new Map<number, Entity>();
  if (session.aid > 0) {
    entities.set(session.aid, {
      aid: session.aid,
      kind: "pc",
      view: session.job,
      name: session.player,
      isBoss: false,
      level: session.baseLevel,
      maxHp: 0,
      firstSeenMs: 0,
      lastHp: 0,
      sex: session.sex === 0 || session.sex === 1 ? session.sex : undefined,
      hairStyle: session.hairStyle || undefined,
      hairColor: session.hairColor || undefined,
      clothesColor: session.clothesColor || undefined,
    });
  }
  const damage: DamageEvent[] = [];
  const kills: VanishEvent[] = [];
  const vanishes: VanishEvent[] = [];
  const optionChanges: OptionChangeEvent[] = [];
  const skillCasts: SkillCast[] = [];
  const skillUses: SkillUse[] = [];
  const mobHp: MobHpUpdate[] = [];
  const mapChanges: MapChange[] = [];
  const itemDeletes: ItemDeleteEvent[] = [];
  const itemAdds: ItemAddEvent[] = [];
  const equipChanges: EquipChangeEvent[] = [];
  // The Kafra / clan storages, which exist nowhere in the containers: each entry
  // is one list the server sent because the player opened the window.
  const storages: StorageSnapshot[] = [];
  const storageChanges: StorageChangeEvent[] = [];
  const paramChanges: ParamChangeEvent[] = [];
  // 0x0141. Not deduped: two bursts can land on the same millisecond with the
  // same `base` and a different `plus`, and both are real.
  const coupleStatus: CoupleStatusEvent[] = [];
  const statusEvents: StatusEvent[] = [];
  const chats: ChatEvent[] = [];
  // Learned skill tree from the 0x010f snapshot the client sends at login.
  // Max level wins: the packet can repeat across map loads.
  const learnedSkills = new Map<number, number>();
  const moves: MoveEvent[] = [];
  const positions: FixPosEvent[] = [];
  // Seed the local player's recording-start cell from the ReplayData container.
  // The client never self-spawns via an entity packet, so without this the map
  // viewer would have nothing to place the player on at t=0 (recordings that
  // start mid-map — no 0x0091 either — leave the player invisible).
  if (session.aid && (session.gx || session.gy)) {
    positions.push({ time: 0, aid: session.aid, gx: session.gx, gy: session.gy });
  }
  // Seed the local player's OPTION at t=0 from the Session snapshot so any
  // mount/summon they already had (falcon, warg, mado gear) is present from the
  // first frame — the packet stream often doesn't re-broadcast their 0x0229
  // until seconds in, which otherwise left companions popping in late.
  if (session.aid) {
    optionChanges.push({ time: 0, aid: session.aid, option: session.option });
  }
  const knownPacketIdSet = new Set<number>();
  // Map from ground-skill-unit AID → caster AID. Skills like Onda Psíquica
  // (Psychic Wave), Storm Gust, Comet, etc. spawn a "skill unit" entity that
  // deals the damage in subsequent ticks; the damage packets list the unit's
  // AID as the source. We rewrite source back to the caster when we see one.
  const groundUnitOwner = new Map<number, number>();
  const groundUnits = new Set<number>();
  // Ground-skill-unit placements (0x09ca) with their cell + the skill they belong
  // to. The packet only carries the unit graphic, not the skill id, so we
  // attribute it from the caster's most recent skill use/cast (the AoE's own
  // activation packet, sent just before its units) — see lastSkillByCaster.
  const groundSkillUnits: GroundSkillUnit[] = [];
  // Server-pushed visual effects (0x01f3) — item-use sparkles + other specialeffects.
  const notifyEffects: NotifyEffectEvent[] = [];
  const lastSkillByCaster = new Map<number, { skillId: number; time: number }>();
  // Widest cast we care to bridge (a long channel like Storm Gust) — beyond this
  // the "last skill" is too stale to trust as this unit's source.
  const GROUND_SKILL_ATTR_MS = 6000;

  // Initial item snapshot from the Items container — used to resolve `itemId`
  // for slots when 0x07fa fires later. Mutated as 0x0a37 / 0x07fa packets
  // stream in.
  const items = readItemContainers(containers);
  const initialInventory = toInventoryMap(items);
  // Copy the records, not just the map: the running inventory mutates `qty`
  // (itemDelete) and `equipped` (equipChange), and those records are shared by
  // reference with `initialInventory` — without a per-record copy those edits
  // would retroactively corrupt the start-of-recording snapshot.
  const inventory = new Map<number, InventoryRecord>(
    [...initialInventory].map(([slot, rec]) => [slot, { ...rec }]),
  );

  // The item list currently arriving (0x0b08 … 0x0b0b). The bag and the cart use
  // the same packets after a map load, so `listType` decides whether the group
  // becomes a storage snapshot or is dropped — the containers already hold both.
  let openList: {
    listType: number;
    time: number;
    items: Map<number, StorageItem>;
  } | null = null;
  // The storage the deposit/withdraw packets belong to. They carry no type of
  // their own, and only one storage window can be open at a time, so they belong
  // to whichever storage the server listed last.
  let lastStorageKind: StorageKind | null = null;
  // Running contents per storage, so a withdrawal — which carries only an index
  // — can name what left. Records are copies: the snapshots must keep reading as
  // the storage looked when it was opened.
  const storageState = new Map<StorageKind, Map<number, StorageItem>>();

  let packetCount = 0;
  let handledPackets = 0;
  let earliestTime = Number.POSITIVE_INFINITY;
  let latestTime = Number.NEGATIVE_INFINITY;

  // Process initial packets first (treat as t=0).
  const initialContainer = findContainer(containers, ContainerType.InitialPackets);
  if (initialContainer) {
    for (const chunk of initialContainer.chunks) {
      handlePacket(chunk.data, 0);
    }
  }

  // Container 15 holds 0x0857 spawn snapshots for entities that were
  // already in view when the recording started — without these, dummies
  // attacked from the recording's first frame have no entity row and
  // render as "Alvo desconhecido".
  const initialEntitiesContainer = findContainer(containers, ContainerType.InitialEntities);
  if (initialEntitiesContainer) {
    for (const chunk of initialEntitiesContainer.chunks) {
      handlePacket(chunk.data, 0);
    }
  }

  const packetStream = containers.find(
    (c): c is PacketStreamContainer => c.kind === "packetStream",
  );
  if (packetStream) {
    for (const chunk of packetStream.chunks) {
      packetCount++;
      knownPacketIdSet.add(chunk.packetId);
      const t = chunk.time;
      if (t < earliestTime) earliestTime = t;
      if (t > latestTime) latestTime = t;
      handlePacket(chunk.data, t);
    }
  }

  // Persistent buffs active at recording start (food, EXP/drop boosts, etc.)
  // live in the EfstList container, NOT the packet stream — they never generate
  // a status-change packet during the recording. Seed each as a synthetic
  // "on" status event at t=0 for the local player so a buff strip shows them.
  //
  // This runs AFTER the packet stream, and the order is load-bearing. A handful
  // of buffs appear in BOTH places, and dedupeNear collapses same-key events
  // within 200ms keeping whichever was pushed first. The packet carries the real
  // `totalMs`/`leftMs`; this seed has neither. Seeding first would therefore
  // throw the durations away and leave a consumer that expires buffs from
  // `leftMs` holding them forever.
  const efstListContainer = findContainer(containers, ContainerType.EfstList);
  if (efstListContainer && session.aid) {
    for (const chunk of efstListContainer.chunks) {
      // Each record is 28 bytes; the first u32 (LE) is the EFST id. Empty
      // begin/end markers (len 0) and any short chunk are skipped.
      if (chunk.data.length < 4) continue;
      const efst = new DataView(
        chunk.data.buffer,
        chunk.data.byteOffset,
        4,
      ).getUint32(0, true);
      if (efst <= 0 || efst > 3000) continue; // guard against non-record chunks
      statusEvents.push({ time: 0, statusId: efst, aid: session.aid, isOn: true, totalMs: 0, leftMs: 0 });
    }
  }

  function ensureEntity(aid: number, kind: EntityKind, time: number): Entity {
    let e = entities.get(aid);
    if (!e) {
      e = {
        aid,
        kind,
        view: 0,
        name: "",
        isBoss: false,
        level: 0,
        maxHp: 0,
        firstSeenMs: time,
        lastHp: 0,
      };
      entities.set(aid, e);
    }
    return e;
  }

  function handlePacket(raw: Uint8Array, time: number) {
    const decoded = decodePacket(raw, time);
    if (!decoded) return;
    handledPackets++;

    switch (decoded.type) {
      case "entity": {
        const ep = decoded.data;
        const e = ensureEntity(ep.aid, ep.kind, time);
        if (ep.kind !== "unknown") e.kind = ep.kind;
        if (ep.view) e.view = ep.view;
        if (ep.name) e.name = ep.name;
        if (ep.level) e.level = ep.level;
        if (ep.maxHp) e.maxHp = ep.maxHp;
        if (ep.hp) e.lastHp = ep.hp;
        if (ep.isBoss) e.isBoss = true;
        // Documented sex field (spawn packets only); authoritative over the
        // session-snapshot fallback used to seed the local player.
        if (ep.sex === 0 || ep.sex === 1) e.sex = ep.sex;
        // Appearance for remote players — the spawn packet's view/look ids feed
        // the map viewer's billboard directly. Only stamp for PCs (mob/NPC
        // spawns reuse the struct but leave these zeroed/garbage).
        if (ep.look && e.kind === "pc") {
          e.hairStyle = ep.look.hairStyle;
          e.hairColor = ep.look.hairColor;
          e.clothesColor = ep.look.clothesColor;
          e.weaponView = ep.look.weapon;
          e.shieldView = ep.look.shield;
          e.headTopView = ep.look.headTop;
          e.headMidView = ep.look.headMid;
          e.headLowView = ep.look.headLow;
          e.robeView = ep.look.robe;
        }
        // Spawn-time OPTION for EVERY kind — the map viewer needs it to know a
        // script NPC starts cloaked (tr_box spawns hidden, shows only at the
        // end), and it seeds the option timeline for mounts/summons. The server
        // re-sends the full spawn (0x09ff) periodically carrying the CURRENT
        // cloak state, so each spawn is also an option-timeline entry (the
        // initial snapshot lands at t=0) — a single `e.option` would only hold
        // the LAST value and miss when the NPC was hidden.
        e.option = ep.option;
        optionChanges.push({ time, aid: ep.aid, option: ep.option });
        // Spawn position → synthetic fix-pos so the map viewer can place the
        // entity at its initial cell before any walk lands. A walking spawn
        // also queues the in-flight step as a move event.
        if (ep.pos) positions.push({ time, aid: ep.aid, gx: ep.pos.gx, gy: ep.pos.gy });
        if (ep.walk) moves.push({ time, aid: ep.aid, from: ep.walk.from, to: ep.walk.to, startTime: 0 });
        break;
      }
      case "moveOther":
        moves.push(decoded.data);
        break;
      case "moveSelfRaw": {
        if (session.aid) {
          const m = decoded.data;
          moves.push({ time: m.time, aid: session.aid, from: m.from, to: m.to, startTime: m.startTime });
        }
        break;
      }
      case "fixPos":
        positions.push(decoded.data);
        break;
      case "vanish":
        // Every vanish drives the map viewer's despawn; only deaths (kind 1)
        // count toward kill stats.
        vanishes.push(decoded.data);
        if (decoded.data.kind === 1) kills.push(decoded.data);
        break;
      case "option":
        optionChanges.push(decoded.data);
        break;
      case "mobHp": {
        const ev = decoded.data;
        mobHp.push(ev);
        const e = entities.get(ev.aid);
        if (e) {
          e.lastHp = ev.hp;
          if (ev.maxHp) e.maxHp = ev.maxHp;
        }
        break;
      }
      case "damage": {
        const d = decoded.data;
        // Skip skill-cast marker packets — the server emits an action=6
        // (DMG_SINGLE) damage=0 packet right before the real splash-damage
        // event (action=5) for the same target. The marker is animation
        // metadata, not a miss.
        if (d.skillId !== 0 && d.damage === 0 && d.rawAction === 6) break;
        // Reattribute ground-skill-unit damage back to the caster.
        const owner = groundUnitOwner.get(d.source);
        if (owner) d.source = owner;
        damage.push(d);
        break;
      }
      case "skillUse": {
        const u = decoded.data;
        const owner = groundUnitOwner.get(u.source);
        if (owner) u.source = owner;
        skillUses.push(u);
        lastSkillByCaster.set(u.source, { skillId: u.skillId, time: u.time });
        break;
      }
      case "skillCast": {
        const c = decoded.data;
        const owner = groundUnitOwner.get(c.source);
        if (owner) c.source = owner;
        skillCasts.push(c);
        lastSkillByCaster.set(c.source, { skillId: c.skillId, time: c.time });
        break;
      }
      case "groundSkillEntry": {
        const ev = decoded.data;
        if (ev.unitAid && ev.casterAid) {
          groundUnitOwner.set(ev.unitAid, ev.casterAid);
        }
        if (ev.unitAid) groundUnits.add(ev.unitAid);
        // Attribute the unit to the caster's most recent skill (its activation
        // packet fires just before its units) so the viewer can pick the right
        // ground effect; 0 when nothing recent enough matched.
        const recent = lastSkillByCaster.get(ev.casterAid);
        const skillId = recent && ev.time - recent.time <= GROUND_SKILL_ATTR_MS ? recent.skillId : 0;
        groundSkillUnits.push({
          time: ev.time,
          unitAid: ev.unitAid,
          casterAid: ev.casterAid,
          gx: ev.gx,
          gy: ev.gy,
          skillId,
        });
        break;
      }
      case "notifyEffect":
        notifyEffects.push(decoded.data);
        break;
      case "chat":
        chats.push(decoded.data);
        break;
      case "mapChange": {
        const mc = decoded.data;
        mapChanges.push(mc);
        // The local player never self-spawns via an entity packet; the map-load
        // packet's (x,y) is the canonical source for their cell, so stamp it as
        // a synthetic position event so the map viewer can place them and
        // follow the camera there.
        if (session.aid && (mc.gx || mc.gy)) {
          positions.push({ time, aid: session.aid, gx: mc.gx, gy: mc.gy });
        }
        break;
      }
      case "itemDelete": {
        const ev = decoded.data;
        const inv = inventory.get(ev.slot);
        if (inv) {
          ev.itemId = inv.itemId;
          // Decrement the running count but DON'T drop the slot from the
          // map at qty=0. The equipped-items chunks (4601-4606) report
          // qty=1 even for ammo-style stacks whose real count lives in the
          // main-bag chunk; if we delete on the first decrement we lose
          // the itemId for the next 13 ammo consumes. The slot only
          // genuinely changes identity when 0x0a37 lands a new itemId.
          inv.qty = Math.max(0, inv.qty - ev.amount);
        }
        itemDeletes.push(ev);
        break;
      }
      case "itemAdd": {
        const ev = decoded.data;
        const existing = inventory.get(ev.slot);
        if (existing && existing.itemId === ev.itemId) {
          existing.qty += ev.amount;
        } else {
          inventory.set(ev.slot, {
            itemId: ev.itemId,
            qty: ev.amount,
            equipped: 0,
            refine: ev.refine,
            grade: 0,
            cards: [0, 0, 0, 0],
            options: [],
          });
        }
        itemAdds.push(ev);
        break;
      }
      case "itemUseAck": {
        // 0x01c8 broadcasts to nearby observers, so most of these aren't
        // for our character. Only act on packets where aid matches.
        const ev = decoded.data;
        if (ev.aid !== session.aid) break;
        // Patch the inventory map so subsequent 0x07fa for the same slot
        // can resolve to itemId.
        inventory.set(ev.slot, {
          itemId: ev.itemId,
          qty: ev.amount,
          equipped: 0,
          refine: 0,
          grade: 0,
          cards: [0, 0, 0, 0],
          options: [],
        });
        // For a successful use, also emit a synthetic delete event so the
        // consumables panel counts it. Stackable consumables only fire
        // 0x01c8 per use; 0x07fa wouldn't fire until the slot drains.
        if (ev.success) {
          itemDeletes.push({
            time: ev.time,
            slot: ev.slot,
            amount: 1,
            reason: 0,
            itemId: ev.itemId,
          });
        }
        break;
      }
      case "equipChange": {
        // 0x0999 / 0x099a are sent only to the acting client, so every one is
        // the recording player's. Resolve the item identity from the running
        // inventory snapshot (same pattern as itemDelete) and keep the snapshot
        // coherent by toggling the record's equipped bits.
        const ev = decoded.data;
        if (!ev.success) break;
        const inv = inventory.get(ev.slot);
        if (inv) {
          if (ev.equipped) inv.equipped |= ev.location;
          else inv.equipped &= ~ev.location;
        }
        equipChanges.push({
          time: ev.time,
          slot: ev.slot,
          location: ev.location,
          equipped: ev.equipped,
          itemId: inv?.itemId ?? 0,
          refine: inv?.refine ?? 0,
          grade: inv?.grade ?? 0,
          cards: inv ? inv.cards.filter((c) => c > 0) : [],
          options: inv?.options ?? [],
        });
        break;
      }
      case "itemListStart":
        openList = { listType: decoded.data.listType, time, items: new Map() };
        break;
      case "itemList": {
        const { listType, items: listed } = decoded.data;
        // Every part of the group repeats its own `invType`, so a list whose
        // begin marker the recording missed still decodes into the right
        // container instead of joining whatever came before it.
        if (!openList || openList.listType !== listType) {
          openList = { listType, time, items: new Map() };
        }
        // A list arrives split over several packets, and one index can repeat
        // across them; the first record is the valid one, as in the containers.
        for (const item of listed) {
          if (!openList.items.has(item.index)) openList.items.set(item.index, item);
        }
        break;
      }
      case "itemListEnd": {
        const list = openList;
        openList = null;
        if (!list || list.listType !== decoded.data.listType) break;
        const kind = storageKindOf(list.listType);
        if (!kind) break; // the bag / the cart — already in the containers
        const items = [...list.items.values()].sort((a, b) => a.index - b.index);
        storages.push({
          kind,
          time: list.time,
          items,
          usedSlots: -1,
          maxSlots: -1,
        });
        lastStorageKind = kind;
        storageState.set(kind, new Map(items.map((i) => [i.index, { ...i }])));
        break;
      }
      case "storageCount": {
        // Sent once with the list and again after every deposit/withdrawal.
        // Only the first belongs to the snapshot — the later ones are the
        // running count, which `storageChanges` already describes.
        const last = storages[storages.length - 1];
        if (last && last.usedSlots < 0) {
          last.usedSlots = decoded.data.used;
          last.maxSlots = decoded.data.max;
        }
        break;
      }
      case "storageItemAdd": {
        const ev = decoded.data;
        if (!lastStorageKind) break;
        const state = storageState.get(lastStorageKind);
        const existing = state?.get(ev.index);
        if (state) {
          if (existing && existing.itemId === ev.itemId) {
            existing.qty += ev.amount;
          } else {
            state.set(ev.index, {
              index: ev.index,
              itemId: ev.itemId,
              qty: ev.amount,
              equipped: 0,
              refine: ev.refine,
              grade: 0,
              cards: ev.cards,
              options: ev.options,
            });
          }
        }
        storageChanges.push({
          time: ev.time,
          kind: lastStorageKind,
          index: ev.index,
          added: true,
          itemId: ev.itemId,
          amount: ev.amount,
          refine: ev.refine,
          // The packet has no grade byte, so a deposit reports 0 even for an
          // item the snapshot would have shown a grade for.
          grade: 0,
          cards: ev.cards,
          options: ev.options,
        });
        break;
      }
      case "storageItemDelete": {
        const ev = decoded.data;
        if (!lastStorageKind) break;
        const rec = storageState.get(lastStorageKind)?.get(ev.index);
        if (rec) rec.qty = Math.max(0, rec.qty - ev.amount);
        storageChanges.push({
          time: ev.time,
          kind: lastStorageKind,
          index: ev.index,
          added: false,
          itemId: rec?.itemId ?? 0,
          amount: ev.amount,
          refine: rec?.refine ?? 0,
          grade: rec?.grade ?? 0,
          cards: rec?.cards ?? [0, 0, 0, 0],
          options: rec?.options ?? [],
        });
        break;
      }
      case "paramChange":
        paramChanges.push(decoded.data);
        break;
      case "coupleStatus":
        coupleStatus.push(decoded.data);
        break;
      case "status":
        statusEvents.push(decoded.data);
        break;
      case "skillList":
        // The snapshot repeats on every map load; keep the highest level seen.
        for (const e of decoded.data) {
          const prev = learnedSkills.get(e.skillId) ?? 0;
          if (e.level > prev) learnedSkills.set(e.skillId, e.level);
        }
        break;
    }
  }

  // The recording's true length (ms) is stored in ReplayData chunk 970 — this
  // is what the in-game replay UI counts down. It runs PAST the last packet
  // (the recorder keeps rolling a beat after the final action), so the
  // packet-stream span alone cuts off a skill used on the last frame. Prefer
  // the stored value; fall back to (and never go below) the packet span.
  const packetSpanMs =
    earliestTime === Number.POSITIVE_INFINITY ? 0 : Math.max(0, latestTime - earliestTime);
  const replayDataContainer = findContainer(containers, ContainerType.ReplayData);
  const storedDurationMs = replayDataContainer ? (readU32ChunkById(replayDataContainer, 970) ?? 0) : 0;
  const durationMs = Math.max(packetSpanMs, storedDurationMs);

  // The server often broadcasts the same skill-use / cast packet twice
  // (caster's own animation + nearby-observer broadcast that loops back to
  // the caster), within a few ms of each other. Collapse those duplicates
  // so counts match what actually happened in-game.
  const dedupedSkillUses = dedupeNear(
    skillUses,
    (e) => `${e.source}::${e.target}::${e.skillId}`,
    DEDUP_WINDOW_MS,
  );
  const dedupedSkillCasts = dedupeNear(
    skillCasts,
    (e) => `${e.source}::${e.target}::${e.skillId}`,
    DEDUP_WINDOW_MS,
  );
  const dedupedParams = dedupeNear(
    paramChanges,
    (e) => `${e.type}::${e.value.toString()}`,
    DEDUP_WINDOW_MS,
  );
  const dedupedStatus = dedupeNear(
    statusEvents,
    (e) => `${e.statusId}::${e.aid}::${e.isOn ? 1 : 0}`,
    DEDUP_WINDOW_MS,
  );

  return {
    sessionInfo: { ...session, durationMs },
    pet: extractPet(containers),
    learnedSkills,
    entities,
    damage,
    kills,
    vanishes,
    optionChanges,
    skillCasts: dedupedSkillCasts,
    skillUses: dedupedSkillUses,
    mobHp,
    mapChanges,
    moves,
    positions,
    items,
    initialInventory,
    itemDeletes,
    itemAdds,
    equipChanges,
    storages,
    storageChanges,
    paramChanges: dedupedParams,
    coupleStatus,
    traits: traitsFromCoupleStatus(coupleStatus),
    statusEvents: dedupedStatus,
    chats,
    groundUnits,
    groundSkillUnits,
    notifyEffects,
    totals: {
      packetCount,
      handledPackets,
      knownPacketIds: [...knownPacketIdSet].sort((a, b) => a - b),
    },
  };
}

/** The two `inventory_type` values that are a storage; null for bag and cart. */
function storageKindOf(listType: number): StorageKind | null {
  if (listType === InventoryListType.Storage) return "storage";
  if (listType === InventoryListType.GuildStorage) return "guildStorage";
  return null;
}

const DEDUP_WINDOW_MS = 200;

function dedupeNear<T extends { time: number }>(
  events: T[],
  keyFn: (e: T) => string,
  windowMs: number,
): T[] {
  const sorted = [...events].sort((a, b) => a.time - b.time);
  const result: T[] = [];
  const lastByKey = new Map<string, number>();
  for (const e of sorted) {
    const k = keyFn(e);
    const prev = lastByKey.get(k);
    if (prev !== undefined && e.time - prev <= windowMs) continue;
    lastByKey.set(k, e.time);
    result.push(e);
  }
  return result;
}

function extractSessionInfo(containers: AnyContainer[], recordedAt: Date) {
  let player = "";
  let map = "";
  let aid = 0;
  let job = 0;
  let baseLevel = 0;
  let jobLevel = 0;
  // Allocated base stats. The Session snapshot lays the serialized CHARACTER_INFO
  // out as id-tagged chunks; chunks 1024-1029 hold the six allocated base stats in
  // canonical order STR, AGI, VIT, INT, DEX, LUK. Verified against the sample
  // replays: Ranger builds read DEX 120 / STR 1, crit Guillotine Cross reads
  // STR 120 / LUK 120, and the value is identical across recordings of the same
  // character (it's the allocated portion, with no gear bonus folded in).
  let str = 0;
  let agi = 0;
  let vit = 0;
  let int_ = 0;
  let dex = 0;
  let luk = 0;
  // Sprite sex of the recording character — see the ReplayData chunk 963 note below.
  let sex = -1;
  // Appearance of the recording character, for the paper-doll viewer. The local
  // player never self-spawns, so (unlike other entities) the look isn't in any
  // spawn packet — it lives in the Session container: hair style (1060), hair
  // color (1064), clothes color (1063). 0 = default/standard palette.
  let hairStyle = 0;
  let hairColor = 0;
  let clothesColor = 0;
  // Local player's recording-start cell (from ReplayData chunks 967 / 968).
  let gx = 0;
  let gy = 0;
  // Local player's OPTION/effectState at recording start (Session chunk 1070) —
  // the same bitfield 0x0229 carries. It holds the mount/summon bits (FALCON,
  // WUG, MADOGEAR, …) the character already had when recording began. The local
  // player never self-spawns and often isn't re-broadcast a 0x0229 until seconds
  // in, so without this seed the falcon/warg (or mado gear) pop in late instead
  // of being present from the first frame. 0 = no special state.
  let option = 0;

  const replayData = findContainer(containers, ContainerType.ReplayData);
  if (replayData) {
    // The ReplayData chunks the name and map live in are positional, not
    // id-tagged like the numeric ones read further down.
    const playerChunk = replayData.chunks[4];
    if (playerChunk) player = readKoreanZ(playerChunk.data);
    const mapChunk = replayData.chunks[5];
    if (mapChunk) map = readKoreanZ(mapChunk.data);
    // Sprite sex of the recording character lives in ReplayData chunk 963
    // (0 = female, 1 = male — same convention as spawn packets and the viewer,
    // so no flip). It is NOT in the Session container: the same account can hold
    // both male and female characters (so account-level data can't tell them
    // apart), and the local player never self-spawns, so this is the only
    // per-character sex source. Verified across the user's male/female replay
    // set. (Earlier code read Session chunk 1095, which is 0 for every character
    // regardless of sex → it always returned "male".)
    const sexFlag = readU32ChunkById(replayData, 963);
    sex = sexFlag === 0 ? 0 : sexFlag === 1 ? 1 : -1;
    // Local player's recording-start cell — chunks 967 (gx) and 968 (gy).
    // Verified across replays: for a recording where the player walked, the
    // first 0x0087 self-move's `from` cell matches these values exactly. The
    // local player never self-spawns via an entity packet, and 0x0091 only
    // fires on map transitions, so this is often the only source for the
    // player's initial cell (recordings that start mid-map).
    gx = readU32ChunkById(replayData, 967) ?? 0;
    gy = readU32ChunkById(replayData, 968) ?? 0;
  }

  const sessionContainer = findContainer(containers, ContainerType.Session);
  if (sessionContainer) {
    aid = readU32ChunkById(sessionContainer, 1010) ?? 0;
    job = readU32ChunkById(sessionContainer, 1014) ?? 0;
    baseLevel = readU32ChunkById(sessionContainer, 1016) ?? 0;
    jobLevel = readU32ChunkById(sessionContainer, 1019) ?? 0;
    str = readU32ChunkById(sessionContainer, 1024) ?? 0;
    agi = readU32ChunkById(sessionContainer, 1025) ?? 0;
    vit = readU32ChunkById(sessionContainer, 1026) ?? 0;
    int_ = readU32ChunkById(sessionContainer, 1027) ?? 0;
    dex = readU32ChunkById(sessionContainer, 1028) ?? 0;
    luk = readU32ChunkById(sessionContainer, 1029) ?? 0;
    hairStyle = readU32ChunkById(sessionContainer, 1060) ?? 0;
    hairColor = readU32ChunkById(sessionContainer, 1064) ?? 0;
    clothesColor = readU32ChunkById(sessionContainer, 1063) ?? 0;
    option = readU32ChunkById(sessionContainer, 1070) ?? 0;
  }

  return {
    player,
    map,
    aid,
    job,
    baseLevel,
    jobLevel,
    recordedAt,
    sex,
    hairStyle,
    hairColor,
    clothesColor,
    str,
    agi,
    vit,
    int: int_,
    dex,
    luk,
    gx,
    gy,
    option,
  };
}

/**
 * The pet, from container 9. The container holds the character's companions in
 * chunk ranges — 51xx and 52xx are homunculus/mercenary — and the **53xx** range
 * is the pet, one field per chunk:
 *
 *   5301 aid · 5303 name (32 bytes) · 5305 job id · 5306 level · 5307 hunger ·
 *   5308 intimacy
 *
 * **Intimacy exists in no packet at all** in the stream (the 0x01a4 that shows up
 * in recordings is `type=2`, hunger), and it is what the client writes the Pet
 * window's "Loyalty" line from when replaying. Checked across 34 recordings with
 * a pet: 5308 ranges from 237 to 1000 and never exceeds 1000, the server's cap.
 */
function extractPet(containers: AnyContainer[]): PetSnapshot | undefined {
  const c = findContainer(containers, ContainerType.Companions);
  if (!c) return undefined;

  const chunk = (id: number) => c.chunks.find((ch) => ch.id === id)?.data;
  const u32 = (id: number) => {
    const d = chunk(id);
    if (!d || d.length < 4) return undefined;
    return new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(0, true);
  };

  const aid = u32(5301);
  if (!aid) return undefined; // no pet was out when the recording started

  const nameBytes = chunk(5303);
  const name = nameBytes ? readKoreanZ(nameBytes) : "";
  // `view` comes through as 0xffffffff when the animal wasn't on screen.
  const viewRaw = u32(5305) ?? 0;

  return {
    aid,
    name,
    view: viewRaw === 0xffffffff ? -1 : viewRaw,
    level: u32(5306) ?? 0,
    hunger: u32(5307) ?? 0,
    intimacy: u32(5308) ?? 0,
  };
}

function readU32ChunkById(
  container: GenericContainer,
  chunkId: number,
): number | null {
  const ch = container.chunks.find((c) => c.id === chunkId);
  if (!ch || ch.data.byteLength < 4) return null;
  const view = new DataView(ch.data.buffer, ch.data.byteOffset, 4);
  return view.getUint32(0, true);
}
