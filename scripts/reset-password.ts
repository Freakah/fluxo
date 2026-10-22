// Usage: npm run reset-password -- <email>   (prompts for a new password; signs out all sessions)
import { createInterface } from 'node:readline/promises';
import { loadConfig } from '../server/config.ts';
import { openDb, get, run } from '../server/db/db.ts';
import { hashPassword, passwordProblem } from '../server/security/password.ts';

const email = process.argv[2];
if (!email) {
  console.error('Usage: npm run reset-password -- <email>');
  process.exit(1);
}
const db = openDb(loadConfig().dbPath);
const u = get<{ id: number }>(db, 'SELECT id FROM users WHERE email = ? AND is_demo = 0', email);
if (!u) {
  console.error('No such user.');
  process.exit(1);
}
const rl = createInterface({ input: process.stdin, output: process.stdout });
const pw = await rl.question('New password (min 12 characters): ');
rl.close();
const problem = passwordProblem(pw);
if (problem) {
  console.error(problem);
  process.exit(1);
}
run(db, 'UPDATE users SET password_hash = ?, totp_enabled = 0, totp_secret_enc = NULL WHERE id = ?', await hashPassword(pw), u.id);
run(db, 'DELETE FROM sessions WHERE user_id = ?', u.id);
console.log('Password reset. Two-step verification was turned off; all sessions were signed out.');
