/**
 * Fernet-compatible symmetric encryption/decryption using Web Crypto API.
 *
 * Python's `cryptography.fernet.Fernet` is used to encrypt Gmail OAuth tokens
 * stored in Supabase. This module provides compatible encrypt/decrypt so tokens
 * written by Python can be read here and vice-versa.
 *
 * Fernet token format (URL-safe base64 of):
 *   version  (1 byte)  : 0x80
 *   timestamp (8 bytes) : big-endian uint64 Unix seconds
 *   iv        (16 bytes): AES-CBC initialisation vector
 *   ciphertext (N bytes): AES-128-CBC encrypted payload (PKCS7 padded)
 *   hmac      (32 bytes): HMAC-SHA256 of all preceding bytes
 *
 * Key format: URL-safe base64 of 32 bytes
 *   bytes  0–15 : HMAC-SHA256 signing key
 *   bytes 16–31 : AES-128-CBC encryption key
 */

function b64urlToBytes(str: string): Uint8Array {
  const standard = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, "=");
  const binary = atob(padded);
  return new Uint8Array(binary.length).map((_, i) => binary.charCodeAt(i));
}

function bytesToB64url(bytes: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export async function fernetDecrypt(
  key: string,
  token: string,
): Promise<string> {
  const keyBytes = b64urlToBytes(key);
  if (keyBytes.length !== 32) {
    throw new Error(`Invalid Fernet key: expected 32 bytes, got ${keyBytes.length}`);
  }
  const signingKey = keyBytes.slice(0, 16);
  const encryptionKey = keyBytes.slice(16, 32);

  const tokenBytes = b64urlToBytes(token);
  if (tokenBytes[0] !== 0x80) throw new Error("Invalid Fernet token version");

  const hmacExpected = tokenBytes.slice(tokenBytes.length - 32);
  const toVerify = tokenBytes.slice(0, tokenBytes.length - 32);
  const iv = tokenBytes.slice(9, 25);
  const ciphertext = tokenBytes.slice(25, tokenBytes.length - 32);

  // Verify HMAC-SHA256
  const signingKeyObj = await crypto.subtle.importKey(
    "raw",
    signingKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "HMAC",
    signingKeyObj,
    hmacExpected,
    toVerify,
  );
  if (!valid) throw new Error("Invalid Fernet token HMAC");

  // Decrypt AES-128-CBC (Web Crypto automatically removes PKCS7 padding)
  const encKeyObj = await crypto.subtle.importKey(
    "raw",
    encryptionKey,
    { name: "AES-CBC" },
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv },
    encKeyObj,
    ciphertext,
  );

  return new TextDecoder().decode(plaintext);
}

export async function fernetEncrypt(
  key: string,
  data: string,
): Promise<string> {
  const keyBytes = b64urlToBytes(key);
  if (keyBytes.length !== 32) {
    throw new Error(`Invalid Fernet key: expected 32 bytes, got ${keyBytes.length}`);
  }
  const signingKey = keyBytes.slice(0, 16);
  const encryptionKey = keyBytes.slice(16, 32);

  const iv = crypto.getRandomValues(new Uint8Array(16));
  const plaintextBytes = new TextEncoder().encode(data);

  const encKeyObj = await crypto.subtle.importKey(
    "raw",
    encryptionKey,
    { name: "AES-CBC" },
    false,
    ["encrypt"],
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-CBC", iv },
      encKeyObj,
      plaintextBytes,
    ),
  );

  const timestamp = BigInt(Math.floor(Date.now() / 1000));
  const tsBytes = new Uint8Array(8);
  new DataView(tsBytes.buffer).setBigUint64(0, timestamp, false);

  const toSign = new Uint8Array([0x80, ...tsBytes, ...iv, ...ciphertext]);

  const signingKeyObj = await crypto.subtle.importKey(
    "raw",
    signingKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const hmac = new Uint8Array(
    await crypto.subtle.sign("HMAC", signingKeyObj, toSign),
  );

  return bytesToB64url(new Uint8Array([...toSign, ...hmac]));
}
