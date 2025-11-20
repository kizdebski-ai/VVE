const AES_KEY_BITS = 128;
const IV_LENGTH_BYTES = 12;

export function createIV(): Uint8Array {
  const iv = new Uint8Array(IV_LENGTH_BYTES);
  return window.crypto.getRandomValues(iv);
}

export async function generateEncryptionKey(returnAs: "string" | "cryptoKey" = "string"): Promise<string | CryptoKey> {
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
}

export { AES_KEY_BITS, IV_LENGTH_BYTES };
