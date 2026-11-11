# Operations runbook

What to watch, how to back up and restore, and how to rotate every secret
PoolGuard holds. Pair it with [DEPLOYMENT.md](DEPLOYMENT.md) and
[TESTNET_RUNBOOK.md](TESTNET_RUNBOOK.md).

## Admin console

`/admin` (redirects to `/app/admin`) is visible only to accounts in
`ADMIN_ACCOUNTS`; everyone else gets a 404 from the API. Admins can read
everything. Only accounts also in `ADMIN_OPERATOR_ACCOUNTS` can act: retry or
cancel jobs, reconcile stuck operations, edit the allowlist, revoke sessions,
suspend accounts, delete an account's data, flag or hide tasks, remove
documents and post announcements. Each action needs CSRF and writes an
`admin.action` event to the audit log (Audit tab).

Suspending an account blocks sign-in and API use. It does **not** touch the
chain: the owner's wallet can still withdraw from the contract directly.

## Monitoring and alerts

`GET /status` (public, also the `/status` page) reports API, database, worker,
provider, chain, AI and OutLayer health, cached for 30 seconds. Point an uptime
checker at `https://<api>/status` and alert on a non-200 or `"status":"down"`.

The API also runs a monitor every 60 seconds (turn it off with
`MONITOR_DISABLED=true` on extra replicas so alerts aren't doubled). It raises:

| Alert | Fires when | First response |
| --- | --- | --- |
| Worker heartbeat stale | No worker heartbeat for 2 minutes | Check the worker service logs and restart it. Jobs are leased, so a restart resumes them. |
| Queue backlog | More than 50 queued jobs, or the oldest has waited 5 minutes | Check the worker is running; consider `WORKER_CONCURRENCY`. |
| Dead-lettered jobs | A job exhausted its retries in the last hour | Admin → Jobs: read the error, fix the cause, then Retry. |
| Payout stuck | A payment pending or needing recovery for 10 minutes | Admin → Stuck operations → Reconcile from chain. It reads the original operation; it never pays twice. |
| Worker balance low | A worker account holds less than 0.1 NEAR | Top up that account (or its OutLayer wallet) with testnet NEAR. |

Every alert is a structured JSON log line (`"alert":true`), an `alert.raised`
audit event, and, if `ALERT_WEBHOOK_URL` is set, a webhook POST of
`{"text": "..."}`. The same alert repeats at most every 30 minutes.

## Backups

```bash
DATABASE_URL=postgresql://... bash scripts/db-backup.sh ./backups
```

Writes `poolguard-<timestamp>.dump` (pg_dump custom format, owner-only file
permissions) and a `.sha256`, and keeps the newest 14 (`BACKUP_KEEP`). Needs
`pg_dump` at least as new as the server (set `PG_BIN` if it isn't on `PATH`).
Run it daily from a scheduler (Render cron job, GitHub Actions schedule, or
cron), and copy dumps off the host. If your database provider takes automatic
backups (Supabase, Neon, Render Postgres), keep those on as well; this script
gives you a copy you control.

Dumps contain encrypted documents, so they are only as safe as
`DOCUMENT_ENCRYPTION_KEY`. Store dumps and that key in different places.

### Testing a restore

```bash
DATABASE_URL=postgresql://... bash scripts/db-restore-test.sh backups/poolguard-<timestamp>.dump
```

It verifies the checksum, restores into a throwaway database
(`poolguard_restore_test_<pid>`) on the same server, compares every table's
row count with the source, and drops the copy. The source is only read. Run
it after any change to the schema or backup setup, and at least monthly.
Record each run below.

| Date | Environment | Dump | Result |
| --- | --- | --- | --- |
| 2026-11-11 | local dev (embedded PostgreSQL 18, client 18.6) | `poolguard-20261111T182716Z.dump`, 68 KB, after an e2e funded-task run | Passed: checksum OK, 22 tables restored with matching row counts (1 task, 2 operations, 5 chain transactions, 26 audit events), 2 migrations applied. |

### Full restore (disaster)

1. Stop the API and worker.
2. Create an empty database and restore: `pg_restore --no-owner --no-privileges --dbname=<new url> <dump>`.
3. Point `DATABASE_URL` at it and run `pnpm db:migrate` (applies anything newer than the dump).
4. Start the API and worker. Then Admin → Stuck operations: reconcile anything the
   chain moved past since the dump. The chain is the source of truth for money;
   the database is a projection that reconciles back to it.

## Key rotation

Rotate on a schedule (every 90 days is a reasonable default), and immediately if
a key may have leaked. Never paste keys into tickets or chat.

### `SESSION_SECRET`

Signs session and CSRF cookies. Generate a new one (`openssl rand -base64 48`),
set it on the API, and redeploy. Every user is signed out and signs in again;
nothing else changes. To also drop stored sessions: Admin → Users → Revoke
sessions, or `DELETE FROM "WalletSession";`.

### `DOCUMENT_ENCRYPTION_KEY`

Encrypts documents at rest (AES-256-GCM). Existing rows must be re-encrypted:

1. Take a backup (`scripts/db-backup.sh`).
2. Stop the API and worker so nothing is written with the old key.
3. Dry run, then apply:
   ```bash
   DATABASE_URL=... OLD_DOCUMENT_ENCRYPTION_KEY=<old> NEW_DOCUMENT_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
     node scripts/rotate-document-key.mjs
   # same command with --apply
   ```
   It decrypts every document before writing anything, and writes in one
   transaction, so a wrong old key changes nothing.
4. Set `DOCUMENT_ENCRYPTION_KEY` to the new key on **both** the API and the worker, start them, open a task's documents to confirm.
5. Keep the old key with the pre-rotation backup only as long as that backup is retained.

### Worker keys (restricted function-call keys)

Each worker signs with a function-call key limited to the PoolGuard contract.

1. Generate a new key pair and add it to the worker account as a function-call
   key on the contract with the same methods and allowance (see
   `scripts/testnet-setup.sh`, which does this for `WORKER_*_PRIVATE_KEY`).
2. Set `WORKER_ONE_PRIVATE_KEY` / `WORKER_TWO_PRIVATE_KEY` to the new key and redeploy the worker.
3. Once runs succeed, delete the old access key from the account
   (`near account delete-keys …`). Admin → Workers shows the key status and remaining allowance.

### OutLayer custody keys

With `WORKER_*_CUSTODY=outlayer`, the private key never leaves OutLayer's TEE;
PoolGuard holds only a wallet API key.

1. Issue a new API key for the wallet in OutLayer (via the wallet's handoff URL or the OutLayer dashboard).
2. Set `WORKER_ONE_OUTLAYER_API_KEY` / `WORKER_TWO_OUTLAYER_API_KEY` and redeploy the worker.
3. Revoke the old API key in OutLayer. Admin → Workers shows the wallet policy.

### Other secrets

- `AI_API_KEY`: create a new key with the AI provider, set it, redeploy the worker, revoke the old one.
- The provider account's key: rotate with the same add-new → switch → delete-old order as worker keys.
- `DATABASE_URL` password: change it in the database provider, update the API and worker together.

## Incident checklist

1. Post an announcement (Admin → Announcements, severity Incident) so users know.
2. If a task's funds are at risk, its owner can pause the task from their wallet (`pause_task`); the backend cannot pause on their behalf.
3. Suspend abusive accounts and hide tasks as needed. Everything is audited.
4. Afterwards, end the announcement and write up what happened.
