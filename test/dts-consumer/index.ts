/**
 * Touches every public export so the gate actually covers the surface. Nothing
 * here runs — `tsc --noEmit` against this file IS the test.
 */
import {
  ByteReader,
  ContainerType,
  PacketIds,
  decodeInventory,
  decodePacket,
  decodeReplay,
  decryptChunk,
  deriveKeys,
  findContainer,
  inspectContainers,
  inspectEntityPackets,
  inspectPacketStream,
  readContainers,
  readEntityName,
  readHeader,
  readItemContainers,
  readKoreanZ,
  toInventoryMap,
  type AnyContainer,
  type Container,
  type CryptKeys,
  type DecodedPacket,
  type Entity,
  type GenericChunk,
  type GenericContainer,
  type InventoryRecord,
  type ItemContainers,
  type ItemRecord,
  type PacketChunk,
  type PacketStreamContainer,
  type PetSnapshot,
  type RecordedAt,
  type Replay,
  type ReplayHeader,
  type SessionInfo,
} from "rrfparser";

declare const buf: ArrayBuffer;
declare const bytes: Uint8Array;

export function surface(): void {
  const replay: Replay = decodeReplay(buf);
  const session: SessionInfo = replay.sessionInfo;
  const pet: PetSnapshot | undefined = replay.pet;
  const entity: Entity | undefined = replay.entities.get(session.aid);
  const record: InventoryRecord | undefined = replay.initialInventory.get(0);
  const learned: number | undefined = replay.learnedSkills.get(1);

  const items: ItemContainers = decodeInventory(buf);
  const first: ItemRecord | undefined = items.inventory[0];
  const merged: Map<number, InventoryRecord> = toInventoryMap(items);

  const header: ReplayHeader = readHeader(buf);
  const recordedAt: RecordedAt = header.recordedAt;
  const keys: CryptKeys = deriveKeys(recordedAt);
  const plain: Uint8Array = decryptChunk(bytes, bytes.byteLength, keys);
  const containers: AnyContainer[] = readContainers(
    buf,
    header.containerTableOffset,
    keys,
  );
  const generic: GenericContainer | undefined = findContainer(
    containers,
    ContainerType.Items,
  );
  const chunk: GenericChunk | undefined = generic?.chunks[0];
  const base: Container | undefined = generic;
  const stream: PacketStreamContainer | undefined = containers.find(
    (c): c is PacketStreamContainer => c.kind === "packetStream",
  );
  const packetChunk: PacketChunk | undefined = stream?.chunks[0];

  const reader = new ByteReader(bytes);
  const packet: DecodedPacket | null = decodePacket(bytes, 0);

  void [
    replay,
    session,
    pet,
    entity,
    record,
    learned,
    items,
    first,
    merged,
    plain,
    chunk,
    base,
    packetChunk,
    packet,
    reader.u16(),
    readKoreanZ(bytes),
    readEntityName(bytes),
    readItemContainers(containers),
    PacketIds.SKILLINFO_LIST,
    inspectContainers(buf),
    inspectEntityPackets(buf),
    inspectPacketStream(buf),
  ];
}
