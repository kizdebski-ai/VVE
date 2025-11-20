import { decryptData, encryptData } from "./crypto";

export async function encryptElementsForRoom(roomKey: string | CryptoKey, elements: unknown) {
  const json = JSON.stringify(elements);
  const encoded = new TextEncoder().encode(json);
  const { ciphertext, iv } = await encryptData(roomKey, encoded);
  return { ciphertext, iv };
}

export async function decryptElementsFromRoom(roomKey: string | CryptoKey, payload: { ciphertext: ArrayBuffer; iv: Uint8Array }) {
  const buffer = await decryptData(roomKey, payload.ciphertext, payload.iv);
  const decoded = new TextDecoder().decode(buffer);
  return JSON.parse(decoded);
}

export async function saveSceneEncrypted(roomId: string, roomKey: string, elements: unknown, version: number) {
  const { ciphertext, iv } = await encryptElementsForRoom(roomKey, elements);
  await fetch(`/api/rooms/${roomId}/scene`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ciphertext: Array.from(new Uint8Array(ciphertext)),
      iv: Array.from(iv),
      version,
    }),
  });
}

export async function loadSceneEncrypted(roomId: string, roomKey: string) {
  const res = await fetch(`/api/rooms/${roomId}/scene`);
  if (!res.ok) return null;
  const json = await res.json();
  const ciphertext = new Uint8Array(json.ciphertext).buffer;
  const iv = new Uint8Array(json.iv);
  const elements = await decryptElementsFromRoom(roomKey, { ciphertext, iv });
  return { elements, version: json.version };
}
