/**
 * Vendored verbatim from the OneLibrary project.
 *   https://github.com/v1vendi/onelibrary — viewer/src/sqlcipher.js @ a31baa5
 *   Copyright (c) 2026 v1vendi. MIT licensed. See docs/THIRD-PARTY.md.
 *
 * Deliberately left as unmodified JavaScript so upstream fixes apply as a clean
 * diff. Types live beside it in `index.d.ts`; tsc does not check this file.
 */
/**
 * SQLCipher 4 decryption in the browser, using WebCrypto only.
 *
 * rekordbox writes `exportLibrary.db` with SQLCipher 4 defaults:
 *
 *   page size  4096
 *   reserve    80 bytes per page = 16-byte IV + 64-byte HMAC-SHA512
 *   KDF        PBKDF2-HMAC-SHA512, 256000 iterations, 32-byte key
 *   cipher     AES-256-CBC, no padding
 *
 * Page 1 opens with a 16-byte plaintext salt, which is the KDF salt for the
 * whole database. Its ciphertext therefore starts at offset 16 and is 16 bytes
 * shorter than every other page.
 *
 * Layout, per 4096-byte page:
 *
 *   page 1   [salt 16][ciphertext 4000][IV 16][HMAC 64]
 *   page n   [ciphertext 4016        ][IV 16][HMAC 64]
 *
 * The parameters are self-validating: byte 16 of the decrypted first page is
 * the SQLite page-size field and byte 20 is the reserve field, so a correct
 * decryption reports back exactly the values used to perform it. `decrypt()`
 * checks this and throws otherwise, which also makes a wrong passphrase fail
 * loudly instead of yielding noise.
 */

export const PAGE_SIZE = 4096;
export const RESERVE = 80;
export const IV_LEN = 16;
export const SALT_LEN = 16;
export const KDF_ITERATIONS = 256000;

/** The passphrase rekordbox uses for exportLibrary.db. */
export const DEFAULT_KEY =
  'r8gddnr4k847830ar6cqzbkk0el6qytmb3trbbx805jm74vez64i5o8fnrqryqls';

export class DecryptError extends Error {}

/**
 * AES-CBC without padding.
 *
 * WebCrypto always applies PKCS#7 and rejects ciphertext that does not end in
 * valid padding, but SQLCipher pages are raw CBC. Encrypting an empty buffer
 * under the final ciphertext block as IV produces exactly one block of valid
 * padding; appending it lets `decrypt()` succeed and strip that block, leaving
 * the true plaintext.
 */
async function decryptNoPadding(key, iv, ciphertext) {
  const lastBlock = ciphertext.subarray(ciphertext.length - 16);
  const padBlock = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-CBC', iv: lastBlock }, key, new Uint8Array(0))
  );
  const joined = new Uint8Array(ciphertext.length + padBlock.length);
  joined.set(ciphertext);
  joined.set(padBlock, ciphertext.length);
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, joined)
  );
}

/** Derive the 256-bit page key from a passphrase and the database salt. */
export async function deriveKey(passphrase, salt) {
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: KDF_ITERATIONS, hash: 'SHA-512' }, base, 256
  );
  return crypto.subtle.importKey('raw', bits, 'AES-CBC', false, ['encrypt', 'decrypt']);
}

/**
 * Decrypt a whole SQLCipher database into a plain SQLite image.
 *
 * @param {ArrayBuffer|Uint8Array} buffer  the raw exportLibrary.db bytes
 * @param {string} passphrase
 * @param {(done:number,total:number)=>void} [onProgress]
 * @returns {Promise<Uint8Array>} a standard SQLite file
 */
export async function decrypt(buffer, passphrase = DEFAULT_KEY, onProgress) {
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (data.length < PAGE_SIZE) throw new DecryptError('file is too small to be a database');
  if (data.length % PAGE_SIZE !== 0) {
    throw new DecryptError(`file is not a whole number of ${PAGE_SIZE}-byte pages`);
  }

  const salt = data.subarray(0, SALT_LEN);
  const key = await deriveKey(passphrase, salt);
  const pageCount = data.length / PAGE_SIZE;
  const out = new Uint8Array(data.length);

  // A SQLite image must start with this, which SQLCipher overwrote with salt.
  out.set(new TextEncoder().encode('SQLite format 3\0'), 0);

  for (let i = 0; i < pageCount; i++) {
    const start = i * PAGE_SIZE;
    const bodyStart = i === 0 ? start + SALT_LEN : start;
    const ctEnd = start + PAGE_SIZE - RESERVE;
    const ct = data.subarray(bodyStart, ctEnd);
    const iv = data.subarray(ctEnd, ctEnd + IV_LEN);

    let plain;
    try {
      plain = await decryptNoPadding(key, iv, ct);
    } catch (err) {
      throw new DecryptError(
        `page ${i + 1} failed to decrypt - wrong passphrase, or not a SQLCipher database`
      );
    }
    out.set(plain, bodyStart);
    // Keep the reserve area zeroed; SQLite ignores it once reserve is declared.
    if (onProgress && (i % 64 === 0 || i === pageCount - 1)) onProgress(i + 1, pageCount);
  }

  // Self-check: the header we just decrypted must describe the geometry we used.
  const view = new DataView(out.buffer);
  const declaredPageSize = view.getUint16(16);
  const declaredReserve = view.getUint8(20);
  if (declaredPageSize !== PAGE_SIZE || declaredReserve !== RESERVE) {
    throw new DecryptError(
      `decryption produced an invalid header (page size ${declaredPageSize}, ` +
      `reserve ${declaredReserve}) - the passphrase is probably wrong`
    );
  }
  return out;
}

/* ---------------------------------------------------------------------------
   Writing
   --------------------------------------------------------------------------- */

/**
 * Derive the per-page HMAC key.
 *
 * SQLCipher derives it from the *encryption key*, not the passphrase, using
 * the database salt with every byte XORed by 0x3a and only two PBKDF2
 * iterations — the input is already a strong key, so stretching it again would
 * cost time for nothing.
 */
async function deriveHmacKey(keyBytes, salt) {
  const hmacSalt = new Uint8Array(salt.length);
  for (let i = 0; i < salt.length; i++) hmacSalt[i] = salt[i] ^ 0x3a;
  const base = await crypto.subtle.importKey('raw', keyBytes, 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hmacSalt, iterations: 2, hash: 'SHA-512' }, base, 256
  );
  return crypto.subtle.importKey('raw', bits, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
}

/**
 * HMAC input is ciphertext ‖ IV ‖ page number, where the page number is a
 * little-endian 32-bit integer. Including it binds each page to its position,
 * so pages cannot be swapped without detection.
 */
async function pageMac(hmacKey, ciphertext, iv, pageNumber) {
  const buf = new Uint8Array(ciphertext.length + iv.length + 4);
  buf.set(ciphertext, 0);
  buf.set(iv, ciphertext.length);
  new DataView(buf.buffer).setUint32(ciphertext.length + iv.length, pageNumber, true);
  return new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, buf));
}

/** AES-CBC without padding: drop the trailing block WebCrypto adds. */
async function encryptNoPadding(key, iv, plaintext) {
  const full = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, plaintext)
  );
  return full.subarray(0, plaintext.length);
}

/**
 * Encrypt a plain SQLite image into a SQLCipher 4 database.
 *
 * Produces a file rekordbox and the players can open: same geometry as
 * {@link decrypt} expects, a fresh random IV per page, and a per-page
 * HMAC-SHA512. The salt is reused when the image came from an existing
 * database so the derived key stays valid; pass `salt` explicitly to keep one.
 *
 * @param {Uint8Array} image a plain SQLite file
 * @param {string} passphrase
 * @param {{salt?:Uint8Array, onProgress?:(d:number,t:number)=>void}} [opts]
 */
export async function encrypt(image, passphrase = DEFAULT_KEY, opts = {}) {
  if (image.length % PAGE_SIZE !== 0) {
    throw new DecryptError(`image is not a whole number of ${PAGE_SIZE}-byte pages`);
  }
  const salt = opts.salt || crypto.getRandomValues(new Uint8Array(SALT_LEN));

  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveBits']
  );
  const keyBits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: KDF_ITERATIONS, hash: 'SHA-512' }, base, 256
  ));
  const aes = await crypto.subtle.importKey('raw', keyBits, 'AES-CBC', false, ['encrypt']);
  const hmacKey = await deriveHmacKey(keyBits, salt);

  const pageCount = image.length / PAGE_SIZE;
  const out = new Uint8Array(image.length);
  out.set(salt, 0);

  for (let i = 0; i < pageCount; i++) {
    const start = i * PAGE_SIZE;
    const bodyStart = i === 0 ? start + SALT_LEN : start;
    const ctEnd = start + PAGE_SIZE - RESERVE;

    const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
    const ct = await encryptNoPadding(aes, iv, image.subarray(bodyStart, ctEnd));
    const mac = await pageMac(hmacKey, ct, iv, i + 1);

    out.set(ct, bodyStart);
    out.set(iv, ctEnd);
    out.set(mac, ctEnd + IV_LEN);
    if (opts.onProgress && (i % 64 === 0 || i === pageCount - 1)) {
      opts.onProgress(i + 1, pageCount);
    }
  }
  return out;
}
