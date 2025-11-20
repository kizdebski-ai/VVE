import { generateEncryptionKey } from "./crypto";

export function parseRoomHash(hash: string) {
  if (!hash.startsWith("#room=")) return null;
  const payload = hash.slice(6);
  const [roomId, roomKey] = payload.split(",");
  if (!roomId || !roomKey) return null;
  return { roomId, roomKey };
}

export function buildRoomHash(info: { roomId: string; roomKey: string }) {
  return `#room=${info.roomId},${info.roomKey}`;
}

function randomId(len = 20) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  crypto.getRandomValues(new Uint8Array(len)).forEach((v) => (out += chars[v % chars.length]));
  return out;
}

export async function createNewRoomUrl() {
  const roomId = randomId(22);
  const key = (await generateEncryptionKey("string")) as string;
  return `${location.origin}${location.pathname}#room=${roomId},${key}`;
}
