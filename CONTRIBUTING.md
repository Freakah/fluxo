# Contributing

Thanks for helping! Fluxo aims to stay small, correct with money, and private.

## Setup
```bash
npm ci
npx playwright install chromium   # for end-to-end tests
npm run dev:api                    # terminal 1 (demo mode by default)
npm run dev:web                    # terminal 2 → http://localhost:5173
```

## Before opening a pull request
```bash
npm run check          # typecheck, lint, unit/integration tests, build
npm run test:e2e       # browser tests (desktop + mobile + accessibility)
npm run scan:secrets
```

## Rules of the road
- **Never commit real financial data**, tokens, `.env`, databases or screenshots of real accounts. Use the demo generator or synthetic fixtures.
- Money is integer minor units. No floats for amounts; never add different currencies.
- All totals go through `server/domain/aggregate.ts`. Document rule changes in `docs/FINANCIAL_RULES.md`.
- Bank facts are written only by the sync engine; user changes live in separate columns.
- Every query touching user data filters by user id. Add a cross-user test for new endpoints.
- UI copy goes in `web/src/i18n.ts`. Keep components accessible (labels, keyboard, contrast, table alternatives for charts).
- Merchant mappings must be specific (brand names with word boundaries); payment processors are not merchants.
- New dependencies: maintained, permissive license compatible with MIT, justified in the PR.
- Schema changes: add a new numbered migration; never edit an applied one.

## Commit messages
Short imperative summary, details in the body when useful. Update `CHANGELOG.md` for user-visible changes.

## Code of conduct
Be kind and constructive. Harassment is not tolerated.
