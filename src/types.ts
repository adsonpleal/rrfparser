export type EntityKind =
  | "pc"
  | "mob"
  | "npc"
  | "merc"
  | "pet"
  | "homun"
  | "elem"
  /** Meister's ABR robots (spawn object type 0x0d). */
  | "abr"
  /** Biolo's summons — Wooden Warrior, Wooden Fairy, Creeper, Hell Tree (0x0e). */
  | "bionic"
  | "unknown";

export type Entity = {
  aid: number;
  kind: EntityKind;
  /** Job id for PC, mob id for mob, sprite id for NPC. */
  view: number;
  name: string;
  isBoss: boolean;
  level: number;
  maxHp: number;
  /** First time we saw this entity (ms in session). */
  firstSeenMs: number;
  /** Last reported HP (mobs). */
  lastHp: number;
  /** 0 = female, 1 = male; undefined = unknown. From spawn packets, with the
   *  local player falling back to the session snapshot. */
  sex?: number;
  /**
   * Appearance for a paper-doll viewer (local player only, from the Session
   * container; undefined elsewhere). `hairStyle` is a sprite id; `hairColor` /
   * `clothesColor` are palette indices (undefined = default/standard palette).
   */
  hairStyle?: number;
  hairColor?: number;
  clothesColor?: number;
  /**
   * Other-player worn gear as client sprite VIEW/look ids straight from the
   * spawn packet (0/undefined = none). A map viewer's billboard can hand these
   * to a sprite URL builder directly — no item→view lookup, unlike the local
   * player whose gear is derived from the inventory snapshot. Absent for
   * mobs/NPCs and the local player.
   */
  weaponView?: number;
  shieldView?: number;
  headTopView?: number;
  headMidView?: number;
  headLowView?: number;
  robeView?: number;
  /**
   * The player this entity belongs to — a pet, homunculus, mercenary, elemental, ABR,
   * bionic, or a monster a skill put on the field (Mechanic's turrets, Oboro's
   * shadow clone). Undefined when the recording cannot say.
   *
   * It comes from the spawn packet's GID field, which for these carries the
   * master's AID, and is only set when that AID is a player the recording saw:
   * a boss's GID names the script NPC that spawned it, which is not an owner.
   * The recording-start snapshot (0x0857) has no GID, so a summon that was
   * already on screen and never re-spawned has no owner here — except the
   * recorder's own elemental, which the Companions container names.
   */
  ownerAid?: number;
  /** OPTION/effectState bitmask from the spawn packet — carries mount flags
   *  (Peco, Mado Gear, Dragon, Warg). Undefined for entities we never saw a
   *  spawn packet for. */
  option?: number;
};

/**
 * A single random option ("Bônus Aleatório" / enchant bonus) on an equipped
 * item. `id` indexes the client's option-name table (randomopt) whose template
 * is filled with `value` for display, e.g. id 19 + value 7 → "MATK +7". `param`
 * is a secondary byte (element/race for a few options; 0 for most).
 */
export type RandomOption = { id: number; value: number; param: number };

export type HitType = "normal" | "critical" | "double" | "lucky" | "miss";

export type DamageEvent = {
  /** ms in session */
  time: number;
  source: number;
  target: number;
  /** 0 means auto-attack. */
  skillId: number;
  skillLevel: number;
  damage: number;
  /** Hit count for multi-hit skills (count) */
  hits: number;
  hitType: HitType;
  /** "auto" (0x02e1) or "skill" (0x01de) */
  source_packet: "auto" | "skill";
  /** Raw `e_damage_type` byte from the packet — for debugging. */
  rawAction: number;
};

export type SkillCast = {
  time: number;
  source: number;
  target: number;
  skillId: number;
  castMs: number;
};

export type SkillUse = {
  time: number;
  source: number;
  target: number;
  skillId: number;
  skillLevel: number;
};

/** One entry of the learned skill tree (0x010f ZC_SKILLINFO_LIST). */
export type SkillInfoEntry = { skillId: number; level: number };

/** A ground-skill unit placement (0x09ca) with its cell, plus the skill it most
 *  likely belongs to (correlated from the caster's latest skill use/cast — the
 *  packet itself only carries the unit graphic, not the skill id). Drives a map
 *  viewer's ground effects (Storm Gust, Arrow Storm, Pneuma, …). skillId is 0 when
 *  no recent skill could be attributed. */
export type GroundSkillUnit = {
  time: number;
  unitAid: number;
  casterAid: number;
  gx: number;
  gy: number;
  skillId: number;
};

export type VanishEvent = {
  time: number;
  aid: number;
  /** 0 = out of sight, 1 = died, 2 = logged out, 3 = teleported */
  kind: number;
};

/** A server-pushed visual effect on an entity (0x01f3 ZC_NOTIFY_EFFECT, the
 *  `clif_specialeffect` packet). `effectId` is an EF_* id straight from the
 *  effect table — the client renders + sounds it. This is how item-use effects
 *  (a Concentration/Awakening potion's sparkle, a Berry's flash, …) and many
 *  other script `specialeffect` visuals reach the client, so it covers item
 *  consumption effects generically, not per-item. */
export type NotifyEffectEvent = {
  time: number;
  aid: number;
  effectId: number;
};

/** An entity's OPTION/effectState bitmask changed mid-recording (ZC_STATE_CHANGE3
 *  0x0229). Carries mounts/summons (Falcon, Warg) AND visibility (cloakonnpc /
 *  hideonnpc set OPTION_HIDE/CLOAK to make a script NPC vanish and reappear). */
export type OptionChangeEvent = {
  time: number;
  aid: number;
  option: number;
};

export type MobHpUpdate = {
  time: number;
  aid: number;
  hp: number;
  maxHp: number;
};

export type MapChange = {
  time: number;
  map: string;
  /** Local player's cell after the map change (from the packet). 0,0 when the
   *  recording's variant of the packet doesn't carry coords. */
  gx: number;
  gy: number;
};

/** A walk command observed for an entity: the server told it to walk from
 *  `from` to `to`, starting at the server clock `startTime`. Only the
 *  client-clock `time` is meaningful for playback; `startTime` is carried for
 *  completeness. */
export type MoveEvent = {
  time: number;
  aid: number;
  from: { gx: number; gy: number };
  to: { gx: number; gy: number };
  startTime: number;
};

/** A forced position snap (spawn position, ZC_STOPMOVE, or post-knockback
 *  fix-pos). The entity teleports to the cell immediately at `time`. */
export type FixPosEvent = {
  time: number;
  aid: number;
  gx: number;
  gy: number;
};

export type ItemDeleteEvent = {
  time: number;
  /** Inventory slot. */
  slot: number;
  amount: number;
  /** Server reason byte (0=normal/dropped, 6=consumed, etc.). */
  reason: number;
  /** Resolved at decode time from the running inventory map; 0 if unknown. */
  itemId: number;
};

export type ItemAddEvent = {
  time: number;
  slot: number;
  itemId: number;
  amount: number;
  refine: number;
};

/**
 * A worn/removed equipment change for the local player, decoded from the
 * equip/take-off ack packets (0x0999 / 0x099a). The packet only carries the
 * inventory slot + equip location; `itemId`/`refine`/`cards` are resolved at
 * decode time from the running inventory snapshot (0 / empty if unknown).
 */
export type EquipChangeEvent = {
  time: number;
  /** Inventory slot the item lives in (raw index - 2). */
  slot: number;
  /** `equipLocation` bitmask the item was worn at / removed from. */
  location: number;
  /** True = item was put on; false = item was taken off. */
  equipped: boolean;
  itemId: number;
  refine: number;
  /** Enchant grade resolved from the inventory snapshot (0 = none / unknown). */
  grade: number;
  cards: number[];
  /** Random options resolved from the inventory snapshot. */
  options: RandomOption[];
};

export type ParamChangeEvent = {
  time: number;
  /** Parameter type — 1=base exp, 2=job exp, 5=hp, 7=sp, 11=base lvl, 12=job lvl, 20=zeny, 22=next base exp, 23=next job exp. */
  type: number;
  /** Always stored as bigint so 64-bit values from 0x0b1b survive without precision loss. */
  value: bigint;
};

/**
 * One `ZC_COUPLESTATUS` (0x0141) event — a stat the server reports as a pair of
 * "what you allocated" plus "what your gear and buffs add on top".
 *
 * The only place a 4th-job trait appears anywhere in a `.rrf`: no container
 * holds them (see {@link Replay.traits}).
 */
export type CoupleStatusEvent = {
  time: number;
  /** rAthena `SP_*` id. 219-224 are POW, STA, WIS, SPL, CON, CRT. */
  statusId: number;
  /** The allocated value — the trait itself. This is what a build import wants. */
  base: number;
  /** Transient delta from gear and buffs. Informational: it moves as buffs come
   *  and go, so `base + plus` is only the total at that instant. */
  plus: number;
};

/**
 * The six 4th-job traits, when the recording carried them.
 *
 * Every field is optional and a missing field means **unknown**, never zero —
 * zero is itself a real value (a non-4th-job character reports all six as 0).
 * See {@link Replay.traits} for when they show up at all.
 */
export type Traits = {
  pow?: number;
  sta?: number;
  wis?: number;
  spl?: number;
  con?: number;
  crt?: number;
};

export type StatusEvent = {
  time: number;
  statusId: number;
  /** Entity the status was applied to. */
  aid: number;
  /** True when the buff/debuff starts; false when it ends. */
  isOn: boolean;
  /** Total duration in ms (0x043f / 0x0983 only; 0 otherwise). */
  totalMs: number;
  /** Remaining duration in ms (0x043f / 0x0983 only; 0 otherwise). */
  leftMs: number;
};

export type SessionInfo = {
  player: string;
  map: string;
  recordedAt: Date;
  /** The larger of the packet-stream span and the duration the recorder stored
   *  in ReplayData chunk 970 — a recording that kept rolling past the last
   *  packet is longer than its packets suggest. */
  durationMs: number;
  aid: number;
  /** Local player's job/class id (e.g. 4257 = Windhawk). */
  job: number;
  baseLevel: number;
  jobLevel: number;
  /** 0 = female, 1 = male; -1 = unknown. */
  sex: number;
  /**
   * Local player's appearance, from the Session snapshot. `hairStyle` is a
   * sprite id (chunk 1060); `hairColor` (1064) / `clothesColor` (1063) are
   * palette indices. 0 = default/standard palette.
   */
  hairStyle: number;
  hairColor: number;
  clothesColor: number;
  /** Allocated base stats, read from the Session snapshot (chunks 1024-1029).
   *  `int` keeps the client's own field name — do not rename it to
   *  `intelligence`, consumers destructure it. */
  str: number;
  agi: number;
  vit: number;
  int: number;
  dex: number;
  luk: number;
  /** Local player's cell at recording start (ReplayData chunks 967/968). */
  gx: number;
  gy: number;
  /** OPTION/effectState bitmask at recording start (Session chunk 1070). */
  option: number;
};

/**
 * The recording's local player chat (0x008e ZC_NOTIFY_PLAYERCHAT). Source is
 * always the session player; the AID is not carried on the event itself.
 */
export type ChatEvent = {
  time: number;
  message: string;
};

/**
 * Pet state at the start of the recording, read from container 9 (53xx chunks).
 * It is the only source of **intimacy** — no packet in the stream carries it
 * (0x01a4 only sends hunger), and it is what the client rebuilds the Pet window
 * from when replaying.
 */
export type PetSnapshot = {
  aid: number;
  /** Name given to the animal (or the species default). */
  name: string;
  /** The pet's job id; links to the egg through the client's table. `-1` when
   *  it was not on screen. */
  view: number;
  level: number;
  /** 0 to 100. */
  hunger: number;
  /** 0 to 1000 — the client's loyalty scale. */
  intimacy: number;
};

export type InventoryRecord = {
  itemId: number;
  qty: number;
  /**
   * `equipLocation` bitmask from the spawn record. 0 = not equipped.
   * Bits follow rAthena's `e_equip_pos` (1 head-low, 2 weapon, 4 garment,
   * 16 armor, 32 shield, 64 shoes, etc.).
   */
  equipped: number;
  refine: number;
  /**
   * Enchant grade ("Grau de Encantamento") — 0 = none, 1 = D, 2 = C, 3 = B,
   * 4 = A, following rAthena's `enchantgrade`. This is the `[C]` the client
   * prints in front of a refine, as in "+11 [C] Gakkung Primordial-LT".
   *
   * The letter is the consumer's business: a grade carries different bonuses
   * per item, so the mapping to actual stats lives wherever the item table
   * does, not here.
   *
   * Always 0 on the older 172-byte equip record, which ends before this field
   * exists, and on records rebuilt from packets (item-add / item-use) — the
   * packets do not carry it.
   */
  grade: number;
  /**
   * The four card/enchant sockets, **by position**, with 0 for an empty socket.
   *
   * Do not filter the zeros. Which socket an enchant sits in is meaningful —
   * `[0, 29660, 0, 0]` is a real and common record, and collapsing it to
   * `[29660]` moves that enchant into socket 0. Consumers that only want a list
   * of names should filter at their own edge.
   */
  cards: [number, number, number, number];
  /**
   * Random options — present on newer (221-byte) equip records; empty for
   * older snapshots, the bag view, or non-equipment.
   */
  options: RandomOption[];
  /**
   * Slot index within the record's own container.
   *
   * Optional because records are also built by hand in tests and derived from
   * packets, where there is no container slot to speak of. Always present on
   * anything that came out of {@link ItemContainers}.
   */
  slot?: number;
};

/** An {@link InventoryRecord} that came from a container, so its slot is known. */
export type ItemRecord = InventoryRecord & { slot: number };

export type ItemContainerKind =
  | "inventory"
  | "cart"
  | "equipped"
  | "equipped-costume";

export type ItemContainers = {
  inventory: ItemRecord[];
  cart: ItemRecord[];
  equipped: ItemRecord[];
  equippedCostume: ItemRecord[];
  /**
   * Item chunks that carried records whose meaning is unknown.
   *
   * Ids 4511-4515, 4517 and 4519-4522 exist and come through empty (or, for
   * 4522, with a single record the client never fills in) in every replay
   * checked so far. They are **not** the storages: a recording taken with the
   * Kafra and clan storages open leaves them just as empty, because the storages
   * are never part of the snapshot — see {@link StorageSnapshot}.
   */
  unknown: Record<number, ItemRecord[]>;
};

/** Which storage a {@link StorageSnapshot} or {@link StorageChangeEvent} is about. */
export type StorageKind = "storage" | "guildStorage";

/**
 * One item as the server listed it in a storage window.
 *
 * Shares {@link InventoryRecord}'s shape so the same rendering code works for a
 * bag item and a stored one. `equipped` is always 0 (nothing in storage is worn)
 * and `slot` is absent — storage items are addressed by {@link index}.
 */
export type StorageItem = InventoryRecord & {
  /**
   * The server's index for this item, and the handle the add/withdraw packets
   * use.
   *
   * **Not a stable slot number.** It restarts at 2 for the first list of a
   * connection but keeps counting across later opens, so the same physical
   * storage position gets a different index each time the window is opened. Use
   * it to correlate a {@link StorageChangeEvent} with a snapshot, not as an
   * identity across snapshots.
   */
  index: number;
};

/**
 * The contents of a storage, as the server sent them when the player opened it.
 *
 * The Kafra and clan storages are not in the file's item snapshot — they are
 * only on record when the window was opened during the recording, one snapshot
 * per open. A recording where the player never visited a Kafra has none.
 */
export type StorageSnapshot = {
  kind: StorageKind;
  /** ms into the session when the list started arriving. */
  time: number;
  /** Sorted by {@link StorageItem.index}. */
  items: StorageItem[];
  /**
   * Slots in use and capacity, from the count packet the server sends with the
   * list (0x00f2). `-1` when it didn't send one.
   *
   * `usedSlots` counts stacks, so it matches `items.length` — but it is the
   * server's own number, and the two can disagree when a list arrives split
   * across packets and one is truncated.
   */
  usedSlots: number;
  maxSlots: number;
};

/**
 * An item deposited into or withdrawn from a storage while it was open.
 *
 * This is the movement log. For the resulting **contents** call `storageAt`,
 * which applies the changes to the right listing — doing it by hand means
 * knowing that the last listing of a kind already reflects everything before it,
 * and that a withdrawal for an index no listing mentioned has to be dropped.
 */
export type StorageChangeEvent = {
  time: number;
  kind: StorageKind;
  /** Matches {@link StorageItem.index} within the storage's current snapshot. */
  index: number;
  /** True = moved into storage; false = withdrawn. */
  added: boolean;
  /**
   * On a withdrawal the packet carries only the index, so this is resolved from
   * the running storage contents — 0 when the item was never listed.
   */
  itemId: number;
  amount: number;
  refine: number;
  grade: number;
  cards: [number, number, number, number];
  options: RandomOption[];
};

export type Replay = {
  sessionInfo: SessionInfo;
  /** Pet that was out at the start of the recording, or undefined. */
  pet?: PetSnapshot;
  /**
   * Learned skill tree from the recording's `ZC_SKILLINFO_LIST` (0x010f)
   * snapshot — client skill id → learned level (only levels > 0). The client
   * sends this once at login/map-load; it's the player's full skill build at
   * the start of the recording.
   */
  learnedSkills: Map<number, number>;
  entities: Map<number, Entity>;
  damage: DamageEvent[];
  /** Deaths only (vanish kind 1) — drives kill counts / attribution stats. */
  kills: VanishEvent[];
  /** EVERY vanish (died / out-of-sight / logged-out / teleported), so a map
   *  viewer can despawn an entity when it leaves — `kills` alone would leave
   *  mobs that walked off-screen or teleported visible forever. */
  vanishes: VanishEvent[];
  /** OPTION/effectState changes over time (mounts, summons, NPC cloak/hide). */
  optionChanges: OptionChangeEvent[];
  skillCasts: SkillCast[];
  skillUses: SkillUse[];
  mobHp: MobHpUpdate[];
  mapChanges: MapChange[];
  /** Every walk command (0x0086/0x0087 and the spawn's MoveData). */
  moves: MoveEvent[];
  /** Every forced position snap (spawn PosDir + 0x0088 fix-pos). Lets a viewer
   *  place an entity at its initial cell before the first walk lands. */
  positions: FixPosEvent[];
  /**
   * The item snapshot at recording start, one list per container.
   *
   * Kept separate because inventory and cart both number their slots from zero:
   * merging them makes a cart item at slot 4 hide behind the bag item at slot 4,
   * or leak into the bag when only one of the two has that slot.
   */
  items: ItemContainers;
  /**
   * Back-compat view of {@link items}: equipped → costume → inventory merged by
   * slot, **cart excluded**. This is the shape the damage-simulator fork read
   * before the containers were split, and what the running inventory (mutated by
   * item-add / item-delete / equip-change events) is seeded from.
   */
  initialInventory: Map<number, InventoryRecord>;
  itemDeletes: ItemDeleteEvent[];
  itemAdds: ItemAddEvent[];
  equipChanges: EquipChangeEvent[];
  /**
   * Every storage the player opened during the recording, in the order the
   * server sent them — one entry per open, so a storage opened twice appears
   * twice. Empty when no storage window was opened.
   *
   * This is the only place the Kafra and clan storages appear: nothing in the
   * file's containers holds them.
   *
   * This is the raw log. Most consumers want `storageAt(replay, kind)` or
   * `storagesAt(replay)`, which give the contents at the end of the recording —
   * reading `storages[0]` directly means missing later opens and every deposit.
   */
  storages: StorageSnapshot[];
  /**
   * Deposits and withdrawals while a storage was open, in packet order.
   *
   * Only carries changes to a storage whose list is in {@link storages} — an
   * add/withdraw packet the recording caught without its list cannot be
   * attributed to a storage and is dropped.
   */
  storageChanges: StorageChangeEvent[];
  paramChanges: ParamChangeEvent[];
  /**
   * Every `ZC_COUPLESTATUS` (0x0141) the stream carried, in packet order, with
   * `base` and `plus` kept apart — a build importer reads `base`, a buff
   * simulator reads `plus`. Most recordings carry none.
   */
  coupleStatus: CoupleStatusEvent[];
  /**
   * The 4th-job traits, read straight off {@link coupleStatus} — the last `base`
   * seen per trait, which is the allocation at the end of the recording.
   *
   * **Usually empty.** The traits live in no container, so the packet stream is
   * the only carrier, and the server sends them from `clif_initialstatus` — at
   * login (before recording starts, so never captured) and on **every map load**
   * (captured, ~300ms after the 0x0091). A recording containing a teleport or
   * warp therefore carries all six; one that never changes map usually carries
   * none, or only the traits a buff happened to modify mid-recording.
   *
   * A missing field means unknown. Nothing here is estimated or back-derived: if
   * the stream did not say it, it is absent. (The derived stats P.Atk / S.MAtk /
   * Res / MRes / HPlus / CRate in `paramChanges` are *not* usable to recover the
   * traits — gear adds to them without bound, so inverting them overshoots.)
   */
  traits: Traits;
  statusEvents: StatusEvent[];
  chats: ChatEvent[];
  /**
   * AIDs that arrived via 0x09ca (ground-skill-unit placements). These are
   * the AoE skill's own ground markers — Storm Gust, Arrow Shower, etc. —
   * which the server uses as a placeholder target/source for per-tick
   * damage. Excluded from monster aggregations even when missing from
   * `entities`.
   */
  groundUnits: Set<number>;
  /** Ground-skill-unit placements with cells + attributed skill id, in packet
   *  order. */
  groundSkillUnits: GroundSkillUnit[];
  /** Server-pushed visual effects (0x01f3) — item-use sparkles and other
   *  `specialeffect` visuals. */
  notifyEffects: NotifyEffectEvent[];
  totals: {
    packetCount: number;
    handledPackets: number;
    knownPacketIds: number[];
  };
};
