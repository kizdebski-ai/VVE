const AES_KEY_BITS = 128;
const IV_LENGTH_BYTES = 12;
const keyCache = new Map<string, CryptoKey>();

type EncryptionStatusDetail = {
  type: "encrypt" | "decrypt";
  durationMs: number;
  bytes: number;
  iv?: Uint8Array;
  error?: string;
};

export function createIV(): Uint8Array {
  const iv = new Uint8Array(IV_LENGTH_BYTES);
  return window.crypto.getRandomValues(iv);
}

export async function generateEncryptionKey(returnAs: "string" | "cryptoKey" = "string"): Promise<string | CryptoKey> {
export async function generateEncryptionKey(returnAs: "string" | "cryptoKey" = "string") {
  const key = await window.crypto.subtle.generateKey(
    { name: "AES-GCM", length: AES_KEY_BITS },
    true,
    ["encrypt", "decrypt"]
  );
  if (returnAs === "cryptoKey") return key;
  const jwk = await window.crypto.subtle.exportKey("jwk", key);
  return (jwk as JsonWebKey).k as string;
}

async function importAesKey(rawKey: string, usage: KeyUsage): Promise<CryptoKey> {
  const jwk: JsonWebKey = { kty: "oct", k: rawKey, alg: "A128GCM", ext: true, key_ops: ["encrypt", "decrypt"] };
  return window.crypto.subtle.importKey("jwk", jwk, { name: "AES-GCM" }, false, [usage]);
}

export async function encryptData(key: string | CryptoKey, data: string | Uint8Array | Blob | ArrayBuffer): Promise<{ ciphertext: ArrayBuffer; iv: Uint8Array; }> {
  const cryptoKey = typeof key === "string" ? await importAesKey(key, "encrypt") : key;
  let buffer: ArrayBuffer | Uint8Array;
  if (typeof data === "string") buffer = new TextEncoder().encode(data);
  else if (data instanceof Uint8Array) buffer = data;
  else if (data instanceof Blob) buffer = await data.arrayBuffer();
  else buffer = data;
  const iv = createIV();
  const ciphertext = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, buffer);
  return { ciphertext, iv };
}

export async function decryptData(key: string | CryptoKey, ciphertext: BufferSource, iv: Uint8Array): Promise<ArrayBuffer> {
  const cryptoKey = typeof key === "string" ? await importAesKey(key, "decrypt") : key;
  return window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, ciphertext);
async function getCachedAesKey(rawKey: string) {
  const cached = keyCache.get(rawKey);
  if (cached) return cached;
  const jwk: JsonWebKey = { kty: "oct", k: rawKey, alg: "A128GCM", ext: true, key_ops: ["encrypt", "decrypt"] };
  const imported = await window.crypto.subtle.importKey("jwk", jwk, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  keyCache.set(rawKey, imported);
  return imported;
}

function emitEncryptionStatus(detail: EncryptionStatusDetail) {
  window.dispatchEvent(new CustomEvent<EncryptionStatusDetail>("encryption-status", { detail }));
}

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export async function encryptData(key: string | CryptoKey, data: string | Uint8Array | ArrayBuffer | Blob) {
  const cryptoKey = typeof key === "string" ? await getCachedAesKey(key) : key;
  const startedAt = nowMs();
  let buffer: ArrayBuffer;
  try {
    if (typeof data === "string") buffer = new TextEncoder().encode(data);
    else if (data instanceof Uint8Array) buffer = data;
    else if (data instanceof Blob) buffer = await data.arrayBuffer();
    else buffer = data;
    const iv = createIV();
    const ciphertext = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, buffer);
    emitEncryptionStatus({ type: "encrypt", durationMs: nowMs() - startedAt, bytes: buffer.byteLength, iv });
    return { ciphertext, iv };
  } catch (error) {
    emitEncryptionStatus({
      type: "encrypt",
      durationMs: nowMs() - startedAt,
      bytes: typeof buffer !== "undefined" ? buffer.byteLength : 0,
      error: (error as Error).message,
    });
    throw error;
  }
}

export async function decryptData(key: string | CryptoKey, ciphertext: ArrayBuffer, iv: Uint8Array) {
  const cryptoKey = typeof key === "string" ? await getCachedAesKey(key) : key;
  const startedAt = nowMs();
  try {
    const plaintext = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, ciphertext);
    emitEncryptionStatus({ type: "decrypt", durationMs: nowMs() - startedAt, bytes: ciphertext.byteLength, iv });
    return plaintext;
  } catch (error) {
    emitEncryptionStatus({
      type: "decrypt",
      durationMs: nowMs() - startedAt,
      bytes: ciphertext.byteLength,
      iv,
      error: (error as Error).message,
    });
    throw error;
  }
}

export { AES_KEY_BITS, IV_LENGTH_BYTES };
