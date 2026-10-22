// Authenticated encryption for provider session references at rest (AES-256-GCM from node:crypto).
// The key comes from DATA_ENCRYPTION_KEY (env), never from the database.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function seal(key: Buffer, plaintext: string, aad = 'fluxo:v1'): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), ct.toString('base64url'), c.getAuthTag().toString('base64url')].join('.');
}

export function open(key: Buffer, sealed: string, aad = 'fluxo:v1'): string {
  const [v, iv, ct, tag] = sealed.split('.');
  if (v !== 'v1' || !iv || !ct || !tag) throw new Error('Malformed sealed value');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}
