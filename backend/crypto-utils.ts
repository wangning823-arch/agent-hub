import crypto from 'crypto';

const SALT_LENGTH = 32;
const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = crypto.scryptSync(password, salt, KEY_LENGTH);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

export function verifyPassword(password: string, hash: string): boolean {
  const [saltHex, keyHex] = hash.split(':');
  if (!saltHex || !keyHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const key = Buffer.from(keyHex, 'hex');
  const verifyKey = crypto.scryptSync(password, salt, KEY_LENGTH);
  return crypto.timingSafeEqual(key, verifyKey);
}

export function isPasswordProtected(hash: string | null | undefined): boolean {
  return !!hash && hash.includes(':');
}
