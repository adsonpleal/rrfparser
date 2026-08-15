/**
 * rrfparser — read Ragnarok Online `.rrf` replay files in Node and the browser.
 *
 * Everything is exported from this one entry point on purpose. Subpath exports
 * are invisible to `moduleResolution: "node"` (TypeScript's node10 algorithm),
 * which Angular 16 and other older toolchains still use, so a subpath import
 * would simply fail to resolve there. Tree-shaking is handled instead by
 * `sideEffects: false` plus per-file ESM output.
 */

// The entry points.
export {
  decodeReplay,
  decodeSnapshot,
  decodeInventory,
  type ReplaySnapshot,
} from "./decode.js";

/**
 * Debugging helpers for working out an unknown packet or container. Unstable —
 * their shape may change in a minor release.
 */
export {
  inspectContainers,
  inspectEntityPackets,
  inspectPacketStream,
} from "./decode.js";

// Lower-level pieces, for tools that want a slice of the file rather than a
// whole decoded replay.
export { readHeader, type ReplayHeader } from "./header.js";
export {
  deriveKeys,
  decryptChunk,
  type CryptKeys,
  type RecordedAt,
} from "./crypt.js";
export {
  ContainerType,
  findContainer,
  readContainers,
  type AnyContainer,
  type Container,
  type GenericChunk,
  type GenericContainer,
  type PacketChunk,
  type PacketStreamContainer,
} from "./containers.js";
export { readItemContainers, toInventoryMap } from "./items.js";
// The storages as state rather than as a log. In the library because turning the
// log into state is protocol work, and leaving it to each consumer had already
// started producing a copy per consumer — see `storage.ts`.
export { applyStorageChanges, storageAt, storagesAt } from "./storage.js";
export { ByteReader, readEntityName, readKoreanZ } from "./reader.js";
export {
  decodePacket,
  PacketIds,
  type DecodedPacket,
} from "./packets/index.js";
// The traits as state rather than as a log — `decodeReplay` already applies this
// to fill `replay.traits`; exported for consumers that collect 0x0141 themselves.
export { traitsFromCoupleStatus } from "./packets/status.js";
export {
  InventoryListType,
  type ItemListPacket,
  type StorageItemAddPacket,
} from "./packets/storage.js";

export type * from "./types.js";
