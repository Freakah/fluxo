# Deployment

Fluxo is designed for **one person or household self-hosting** it. The simplest safe setup is running it on
your own computer bound to `127.0.0.1`. Hosting it on the internet is possible but makes you the operator
of a service holding financial data.

## Local (recommended)
```bash
npm ci
npm run build
cp .env.example .env   # set APP_MODE=live, DATA_ENCRYPTION_KEY, Enable Banking values
npm start
```
Keep `HOST=127.0.0.1`. Background sync only runs while the process runs — use a login item / service, or schedule `npm run sync` (cron, Task Scheduler) at most every 6 hours.

## Server / VPS
Required:
- **Node.js 24+**, a persistent disk for `DATA_DIR`.
- **HTTPS** via a reverse proxy (Caddy, nginx, Traefik). Set `PUBLIC_URL=https://your.host`, `NODE_ENV=production`, keep `HOST=127.0.0.1`, set `TRUST_PROXY=true` only when the proxy sets `X-Forwarded-For`. Production refuses non-HTTPS `PUBLIC_URL` (except localhost); cookies become `Secure` and HSTS is sent.
- **Secrets** in the service environment or a secret manager, not in the repository: `DATA_ENCRYPTION_KEY`, the Enable Banking private key file (mode 600, outside `DATA_DIR`).
- **Scheduler**: the built-in one runs inside the server. Do not also run `npm run sync` on a timer unless the server’s scheduler is disabled (`SCHEDULER_ENABLED=false`); per-account locks prevent double work either way.
- **Backups**: schedule `npm run backup` and copy backups off-site encrypted ([BACKUP.md](BACKUP.md)).
- **Updates**: `git pull && npm ci && npm run build`, then restart. Migrations run automatically; take a backup first.

Example Caddyfile:
```
fluxo.example.org {
  reverse_proxy 127.0.0.1:3000
}
```

Example systemd unit (`/etc/systemd/system/fluxo.service`):
```
[Service]
WorkingDirectory=/opt/fluxo
EnvironmentFile=/etc/fluxo.env
ExecStart=/usr/bin/node server/index.ts
User=fluxo
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/fluxo/data
[Install]
WantedBy=multi-user.target
```

Never expose the Vite dev server (`npm run dev:web`) or a `NODE_ENV=development` server publicly.

## Public demo
`APP_MODE=demo` with `NODE_ENV=production` and a `DATA_ENCRYPTION_KEY`. Each visitor gets a separate synthetic workspace, deleted after 24 h. Demo mode cannot load a real provider.

## Health and monitoring
- `GET /api/health` → `{status, version, mode}`; 503 if the database is unavailable. No private data.
- Logs are JSON lines on stdout/stderr without amounts, descriptions, tokens or account numbers. Use your platform’s log collection; no external error-monitoring service is bundled. If you add one, make sure it never receives request bodies or financial data.
- “Recent sync runs” on the Accounts page shows per-connection history.

## Before operating it for other people
Fluxo’s privacy text is a template. Running a service for others in the EU likely makes you a data controller (GDPR), and commercial bank-data access needs a contract with the provider. Get legal review first. See [PRIVACY.md](PRIVACY.md).
