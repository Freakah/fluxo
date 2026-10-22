// Password hashing with scrypt from node:crypto (OWASP-recommended parameters: N=2^17, r=8, p=1).
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';

const N = 2 ** 17, r = 8, p = 1, KEYLEN = 32;
const MAXMEM = 256 * 1024 * 1024;

function derive(password: string, salt: Buffer, n: number, rr: number, pp: number): Promise<Buffer> {
  return new Promise((res, rej) => scrypt(password.normalize('NFKC'), salt, KEYLEN, { N: n, r: rr, p: pp, maxmem: MAXMEM }, (e, k) => (e ? rej(e) : res(k))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, r, p);
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, rr, pp, salt, key] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const got = await derive(password, Buffer.from(salt, 'base64'), +n, +rr, +pp);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

// A real hash of a random value, verified when the email is unknown so response time doesn't reveal accounts.
let dummy: Promise<string> | undefined;
export const dummyHash = () => (dummy ??= hashPassword(randomBytes(16).toString('hex')));

export function passwordProblem(pw: string): string | null {
  if (pw.length < 12) return 'Use at least 12 characters.';
  if (pw.length > 256) return 'Use at most 256 characters.';
  return null;
}
