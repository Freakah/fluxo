// Pre-publication scan of every file git would publish (tracked + untracked-not-ignored).
// Flags private keys, tokens, real-looking IBANs, database files and personal emails.
// Exit code 1 on findings. Usage: npm run scan:secrets
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8' }).split('\n').filter(Boolean);
const RULES: [string, RegExp][] = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['AWS key', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['Slack/Stripe-style token', /\b(xox[abp]-[A-Za-z0-9-]{10,}|sk_live_[A-Za-z0-9]{10,})\b/],
  ['IBAN', /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){4,7}\b/],
  ['assigned secret', /\b(DATA_ENCRYPTION_KEY|ENABLE_BANKING_APP_ID|PASSWORD|SECRET|TOKEN)\s*=\s*['"]?[A-Za-z0-9+/=_-]{20,}/],
  ['personal email', /\b[A-Za-z0-9._%+-]+@(?!example\.(?:com|org)|demo\.invalid|anthropic\.com|users\.noreply\.github\.com)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/],
];
const ALLOW = [/^package-lock\.json$/, /^scripts\/scan-secrets\.ts$/];
const BINARY_BAD = /\.(sqlite|db|sqlite-wal|sqlite-shm|pem|key|p12|pfx)$/i;
let findings = 0;
for (const f of files) {
  if (!fs.existsSync(f)) continue;
  if (BINARY_BAD.test(f)) { console.log(`${f}: database/key file must not be published`); findings++; continue; }
  if (ALLOW.some((a) => a.test(f)) || /\.(png|jpg|jpeg|gif|ico|woff2?)$/i.test(f)) continue;
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const [name, re] of RULES) if (re.test(line)) { console.log(`${f}:${i + 1}: possible ${name}`); findings++; }
  });
}
console.log(findings ? `\n${findings} finding(s). Review before publishing.` : `Scanned ${files.length} files: no secrets or private data patterns found.`);
process.exit(findings ? 1 : 0);
