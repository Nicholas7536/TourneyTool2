import { MongoClient } from "mongodb";
import { randomUUID } from "node:crypto";
import { type Room, WAITING_ROOM_TTL_MS, ACTIVE_ROOM_TTL_MS, FINISHED_ROOM_TTL_MS } from "./types.js";

// ─── Connection ───────────────────────────────────────────────────────────────

let clientPromise: Promise<MongoClient> | null = null;
let indexesReady: Promise<void> | null = null;

export function collection() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not configured. Add it to .env.local or your deployment environment.");
  clientPromise ??= new MongoClient(uri).connect();
  return clientPromise.then(async (client) => {
    const rooms = client.db(process.env.MONGODB_DB || "strikers").collection<Room>("rooms");
    indexesReady ??= rooms.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).then(() => undefined);
    await indexesReady;
    return rooms;
  });
}

// ─── ID generators ────────────────────────────────────────────────────────────

export function code() {
  return randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
}

export function token() {
  return randomUUID().replaceAll("-", "");
}

// ─── Room locking ─────────────────────────────────────────────────────────────

const roomLocks = new Map<string, Promise<void>>();

export async function acquireRoomLock(roomCode: string) {
  const key = roomCode.toUpperCase();
  const previous = roomLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  roomLocks.set(key, queued);
  await previous;
  return () => {
    release();
    if (roomLocks.get(key) === queued) roomLocks.delete(key);
  };
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function cleanExpiredRooms() {
  const rooms = await collection();
  const now = Date.now();
  await rooms.deleteMany({
    $or: [
      { expiresAt: { $lte: now } },
      { expiresAt: { $exists: false }, phase: "waiting", createdAt: { $lte: now - WAITING_ROOM_TTL_MS } },
      { expiresAt: { $exists: false }, phase: "active", createdAt: { $lte: now - ACTIVE_ROOM_TTL_MS } },
      { expiresAt: { $exists: false }, phase: "finished", createdAt: { $lte: now - FINISHED_ROOM_TTL_MS } },
    ],
  });
}

export async function findRoom(roomCode: string) {
  await cleanExpiredRooms();
  const rooms = await collection();
  const room = await rooms.findOne({ roomCode });
  // Normalise optional field so all downstream code can assume it exists.
  if (room) room.eliminated ??= [];
  return room;
}

export async function saveRoom(room: Room) {
  await (await collection()).replaceOne({ roomCode: room.roomCode }, room, { upsert: true });
}
