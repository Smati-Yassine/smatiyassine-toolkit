import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'crypto';

// Format: "TK1:" + base64(salt | iv | auth tag | ciphertext), AES-256-GCM with a scrypt key.
const PREFIX = 'TK1:';
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const SCRYPT_COST = 2 ** 15;

export const TOKEN_PATTERN = /TK1:[A-Za-z0-9+/]+={0,2}/g;

export class DecryptError extends Error {}

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, { N: SCRYPT_COST, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key)
    );
  });
}

export async function encryptText(plain: string, password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveKey(password, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([salt, iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

export async function decryptText(token: string, password: string): Promise<string> {
  const data = Buffer.from(token.slice(PREFIX.length), 'base64');
  if (data.length < SALT_BYTES + IV_BYTES + TAG_BYTES) {
    throw new DecryptError('The encrypted text is incomplete.');
  }
  const salt = data.subarray(0, SALT_BYTES);
  const iv = data.subarray(SALT_BYTES, SALT_BYTES + IV_BYTES);
  const tag = data.subarray(SALT_BYTES + IV_BYTES, SALT_BYTES + IV_BYTES + TAG_BYTES);
  const ciphertext = data.subarray(SALT_BYTES + IV_BYTES + TAG_BYTES);

  const key = await deriveKey(password, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new DecryptError('Wrong password, or the encrypted text was changed.');
  }
}
