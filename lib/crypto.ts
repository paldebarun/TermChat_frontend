/**
 * Client-side end-to-end encryption, mirroring client/crypto_utils.py
 * from the backend repo exactly:
 *
 *   RSA-OAEP (2048-bit, SHA-256)  wraps a per-message
 *   AES-256-GCM (12-byte nonce, 16-byte tag)  key.
 *
 * The server never sees a plaintext byte and never holds a private key.
 * Private keys generated here NEVER leave this browser - they are kept
 * in localStorage (see lib/storage.ts) and are never sent over the wire.
 */
import type { EncryptedPayload } from "./types";

const RSA_ALG = { name: "RSA-OAEP", hash: "SHA-256" };
const TAG_LENGTH_BYTES = 16;
const NONCE_LENGTH_BYTES = 12;

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBuf(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function pemToBuf(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  return base64ToBuf(b64);
}

function bufToPem(buf: ArrayBuffer, label: string): string {
  const b64 = bufToBase64(buf);
  const lines = b64.match(/.{1,64}/g)?.join("\n") ?? b64;
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----`;
}

export interface KeyPairPem {
  publicKeyPem: string;
  privateKeyPem: string;
}

/** Generate a fresh RSA-2048 keypair. Upload only the public half. */
export async function generateKeyPair(): Promise<KeyPairPem> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["encrypt", "decrypt"]
  );
  const [pub, priv] = await Promise.all([
    crypto.subtle.exportKey("spki", keyPair.publicKey),
    crypto.subtle.exportKey("pkcs8", keyPair.privateKey),
  ]);
  return {
    publicKeyPem: bufToPem(pub, "PUBLIC KEY"),
    privateKeyPem: bufToPem(priv, "PRIVATE KEY"),
  };
}

async function importPublicKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("spki", pemToBuf(pem), RSA_ALG, false, ["encrypt"]);
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", pemToBuf(pem), RSA_ALG, false, ["decrypt"]);
}

/** Encrypt `plaintext` for the holder of `recipientPublicKeyPem`. */
export async function encryptMessage(
  recipientPublicKeyPem: string,
  plaintext: string
): Promise<EncryptedPayload> {
  const publicKey = await importPublicKey(recipientPublicKeyPem);

  const aesKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
  ]);
  const rawAesKey = await crypto.subtle.exportKey("raw", aesKey);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH_BYTES));

  const cipherWithTag = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, tagLength: TAG_LENGTH_BYTES * 8 },
    aesKey,
    new TextEncoder().encode(plaintext)
  );
  const cipherBytes = new Uint8Array(cipherWithTag);
  const ciphertext = cipherBytes.slice(0, cipherBytes.length - TAG_LENGTH_BYTES);
  const tag = cipherBytes.slice(cipherBytes.length - TAG_LENGTH_BYTES);

  const encryptedKey = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, rawAesKey);

  return {
    encrypted_content: bufToBase64(ciphertext.buffer),
    encrypted_key: bufToBase64(encryptedKey),
    nonce: bufToBase64(nonce.buffer),
    tag: bufToBase64(tag.buffer),
  };
}

/** Decrypt a payload received over the wire using our own private key. */
export async function decryptMessage(
  privateKeyPem: string,
  payload: EncryptedPayload
): Promise<string> {
  const privateKey = await importPrivateKey(privateKeyPem);

  const rawAesKey = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    privateKey,
    base64ToBuf(payload.encrypted_key)
  );
  const aesKey = await crypto.subtle.importKey("raw", rawAesKey, { name: "AES-GCM" }, false, [
    "decrypt",
  ]);

  const nonce = base64ToBuf(payload.nonce);
  const ciphertext = new Uint8Array(base64ToBuf(payload.encrypted_content));
  const tag = new Uint8Array(base64ToBuf(payload.tag));
  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext, 0);
  combined.set(tag, ciphertext.length);

  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce, tagLength: TAG_LENGTH_BYTES * 8 },
    aesKey,
    combined
  );
  return new TextDecoder().decode(plainBuf);
}
