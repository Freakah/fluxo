# Release checklist

## Every release
- [ ] `npm ci` on a clean checkout
- [ ] `npm run check` (typecheck, lint, tests, build) passes
- [ ] `npm run build && npm run test:e2e` passes (desktop, mobile, accessibility)
- [ ] `npm audit --audit-level=high` clean or findings assessed
- [ ] `npm run scan:secrets` clean
- [ ] Fresh install from README works in demo mode
- [ ] Migration tested on a copy of an older database (backup → upgrade → restore drill)
- [ ] `CHANGELOG.md` updated, version bumped in `package.json`
- [ ] Screenshots regenerated if the UI changed (`npm run screenshots`, demo data only)
- [ ] Tag `vX.Y.Z`, GitHub release with changelog notes

## First publication (one-time)
- [ ] Replace `[COPYRIGHT HOLDER — replace before publishing]` in `LICENSE`
- [ ] Add a security contact or enable private vulnerability reporting (`SECURITY.md`)
- [ ] Set `repository`, `homepage`, `bugs` and `author` in `package.json` (not set: unknown)
- [ ] Review `docs/PRIVACY.md` wording; it is a template
- [ ] Confirm no `data/`, `.env`, `*.pem`, `*.sqlite`, `test-results/` in `git ls-files`
- [ ] Review git history for anything private (`git log -p | npm run scan:secrets` is not enough — inspect)
- [ ] Create the GitHub repository, push, enable Dependabot alerts and branch protection
