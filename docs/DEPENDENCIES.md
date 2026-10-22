# Dependencies

## Runtime (bundled or executed in production) — all MIT
| Package | Why |
|---|---|
| hono, @hono/node-server | HTTP server, cookies, secure headers |
| zod | Request and configuration validation |
| jose | RS256 JWT signing for Enable Banking |
| otpauth | TOTP two-step verification |
| react, react-dom, react-router | UI |
| lucide-react (ISC) | Icons |
| @fontsource-variable/inter (OFL-1.1) | Inter font, bundled locally (no requests to font services) |

Built-in Node modules cover SQLite (`node:sqlite`), password hashing (`crypto.scrypt`) and encryption (`crypto` AES-256-GCM).

## Development only (not shipped)
TypeScript, Vite, @vitejs/plugin-react, Vitest, Playwright, @axe-core/playwright (MPL-2.0), ESLint and plugins, type packages.
Transitive dev-only licenses include MPL-2.0 (axe-core, lightningcss) and CC-BY-4.0 (caniuse-lite data); they are used as tools and not distributed with the app, which is compatible with publishing Fluxo under MIT.

License audit (2026-10-22, from `package-lock.json`): MIT 160, Apache-2.0 19, MPL-2.0 14, ISC 10, BSD-2-Clause 6, BSD-3-Clause 2, BlueOak-1.0.0 1, CC-BY-4.0 1. No GPL/AGPL/unknown licenses.

## Maintenance
- CI runs `npm audit --audit-level=high` and the full test suite on every push.
- Dependabot (`.github/dependabot.yml`) opens weekly grouped update PRs. Review changelogs; don’t merge blindly — run `npm run check` and `npm run test:e2e`.
- Prefer versions published at least ~2 weeks ago (supply-chain caution). Initial versions were installed with that rule; `vite` was pinned to 8.3.4 to include security fixes.
- Node.js: track the active LTS ≥ 24. `node:sqlite` is still flagged experimental by Node and prints a warning; watch release notes on upgrades.
- Re-run the license audit when adding packages.
