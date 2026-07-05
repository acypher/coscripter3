// AES-GCM encryption for private personal-database values.

const PBKDF2_ITERATIONS = 310000;
const SALT_BYTES = 16;

function b64Encode(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64Decode(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function generateSalt() {
  return b64Encode(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
}

export async function deriveKey(password, saltB64) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: b64Decode(saltB64),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptString(plaintext, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plaintext)
  );
  return { iv: b64Encode(iv), data: b64Encode(new Uint8Array(cipher)) };
}

export async function decryptString(record, key) {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64Decode(record.iv) },
    key,
    b64Decode(record.data)
  );
  return new TextDecoder().decode(plain);
}

export async function verifyPassword(password, saltB64, sampleSecret) {
  if (!sampleSecret) return true;
  const key = await deriveKey(password, saltB64);
  try {
    await decryptString(sampleSecret, key);
    return true;
  } catch (_) {
    return false;
  }
}
