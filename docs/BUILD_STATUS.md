# Build status

Last updated: 2026-11-08 (local sandbox; testnet tooling hardened; no public testnet deployment).

## Implemented

| Area | Status | Evidence |
| --- | --- | --- |
| Rust contract | Implemented | `contracts/poolguard`; 56 unit tests pass |
| Funding, policy, reservations and payouts | Implemented | Real WASM proof against `near-sandbox` |
| Restricted worker function-call keys | Implemented | Sandbox provisioning + contract key checks |
| Idempotent operation id / changed-argument replay | Implemented | Contract tests + sandbox proof |
| Private, idempotent payout/withdrawal callbacks | Implemented | Contract tests |
| Conservation invariant and bounded storage | Implemented | Contract tests + on-chain `get_budget` |
| PostgreSQL schema, migrations and seed | Implemented | Prisma; provider catalog with two services |
| Durable worker queue and leases | Implemented | `apps/worker/src/queue.ts`; retry-policy tests |
| Worker restart / lost-response recovery | Implemented | Scenario D run; manual recovery re-run |
| Provider catalog, quotes and stored results | Implemented | Provider API and extraction tests |
| Independent provider payment verification | Implemented | Chain view checks + buyer signature tests |
| Bounded AI agent runtime | Implemented | 8 steps, 5k tokens, 180s, schema-constrained tools |
| Fastify API + NEP-413 auth + CSRF | Implemented | API tests for nonce, replay, CSRF, isolation |
| SSE activity timeline | Implemented | Persisted event ids + `Last-Event-ID` support |
| Next.js application | Implemented | Production build passes; sandbox UI exercised |
| TypeScript SDK + example | Implemented | `packages/sdk` |
| Demo scenarios A/B/C/D | Implemented | All four exercised through the UI against the local sandbox |
| Responsive layout | Implemented | Desktop and 360px Playwright journeys pass |
| Documentation set | Implemented | README + `docs/*`, including the testnet runbook |
| One-command local stack | Implemented | `pnpm dev` → `scripts/dev-stack.mjs` |
| Shared environment loading | Implemented | `@poolguard/shared/env`; process env > overlay > `.env.testnet` > `.env`; `.env.local` refused in production/testnet |
| Proxy, rate limit and bounded reads | Implemented | `API_TRUST_PROXY` (IP/CIDR, hop counts rejected), `API_RATE_LIMIT_MAX`, `CHAIN_READ_CONCURRENCY` |
| Wallet coverage | Implemented | Sender, Nightly, Meteor and HERE registered; production web build passes |
| Testnet preflight and verification | Implemented | Read-only `scripts/testnet-check.mjs`; 14 safety tests; no signing/deploy path |

## Checks run

| Check | Result |
| --- | --- |
| `cargo test` (contract) | **50 passed, 0 failed** |
| `pnpm test` | Shared 21, provider 16, agent-runtime 3, API 9, worker 3, testnet checks 14 (**66 passed**) |
| `pnpm test:testnet-check` | **14 passed**; mainnet/sandbox/key-scope/full-access/WASM, dev-session, provider-catalog and live-metadata gates covered |
| `pnpm testnet:preflight --config-only` | **Fails closed as intended** on this checkout: `.env.testnet` is absent (exit 2); a generated production-shaped fixture passed before the env-loader changes |
| `pnpm typecheck` | **Passed** for all 8 typed workspace packages |
| `pnpm --filter @poolguard/api test` | **9 passed**, including trust-proxy CIDR and hop-count rejection |
| `pnpm --filter @poolguard/web build` | **Passed**; Next.js production build produced 10 routes after the Sender/Nightly imports |
| `pnpm install --frozen-lockfile` | **Passed**; lockfile unchanged |
| Clean-copy rehearsal | **Passed** from a copied source tree: fresh install, `pnpm typecheck`, `pnpm test` (40), `pnpm build` |
| `pnpm dev` fresh-sandbox path | **Passed**: deleted `.env.local`, reprovisioned the sandbox, reset/migrated/seeded PostgreSQL, all services healthy, then 6 browser tests passed |
| `pnpm contract:build` | **Passed**; 505,695-byte WASM at `contracts/poolguard/res/poolguard.wasm` |
| `pnpm contract:sandbox-test` | **11 checks passed** against a fresh real `near-sandbox` node |
| `pnpm test:e2e` | **6 passed** (desktop + 360px) against the live stack |
| Scenario A permitted purchase | Two agents bought, paid and received provider results |
| Scenario B shared-budget race | One 0.02 reservation won; the other was denied and fell back |
| Scenario C contract probe | Denied by policy (`PROVIDER_NOT_ALLOWED`); run finished partially |
| Scenario D dropped execute response | One operation, one payout, stored result recovered |
| Stale access-key nonce reconciliation | First reserve never landed; same operation ID was resubmitted and cleanly denied for insufficient budget |
| Manual recovery of a paid/not-delivered operation | Delivered the stored result without another payout |

## Testnet readiness split

Built and tested now:

- [`.env.testnet.example`](../.env.testnet.example) — production-shaped, placeholder-only template.
- `@poolguard/shared/env` — one loader for API, worker, provider and seed; `.env.testnet` is automatic and `.env.local` fails closed in production/testnet.
- `scripts/testnet-check.mjs` — read-only config, key, account, deployed-WASM, full-access-key, owner-balance, access-key, cookie/dev-session, provider-catalog and live-service gate.
- [TESTNET_RUNBOOK.md](TESTNET_RUNBOOK.md) — identities, deployment order, acceptance checks, rollback and incident notes.
- 14 unit tests covering mainnet refusal, sandbox-switch refusal, key derivation, role separation, restricted access-key scope, full-access detection, WASM comparison and live metadata consistency.

Requires external inputs (not built or claimed): funded testnet accounts, deployer/owner key custody, `near-cli` signing, public HTTPS origins, hosted PostgreSQL, secret manager values, an AI key for live model runs, and explicit confirmation before signing or deploying. An automated deployer is intentionally absent because a deploy script would need the highest-privilege key and a confirmation gate outside the app.

## Deliberately not done / blocked

- **No container image or bundled process supervisor.** The repository's
  `docker-compose.yml` is for local PostgreSQL only. Run the API, worker,
  provider and web processes under the hosting platform's supervisor; no
  Dockerfile/systemd unit is included or verified here.

- **No testnet deployment.** The project runs on a local NEAR sandbox. No public
  testnet transactions, deployed testnet contract or funded wallet flow are claimed.
- **No live AI execution in this environment.** `AI_API_KEY` is not configured, so
  demo runs are labelled `scripted`. The live path exists but was not executed here.
- **No public hosting, repository push, X post or hackathon submission.** These
  require explicit user confirmation under `HACKATHON.md`.
- **No real testnet preflight/verification run.** The tools are implemented and
  tested with fixtures; they have not been pointed at funded testnet accounts or
  public origins because those credentials do not exist here.
- **No security audit.** Treat all financial behavior as experimental.

## Known defects fixed during the build

- Contract release profile used `panic = "abort"`, which stripped structured denial
  strings and exposed only a WASM trap. Changed the release profile and adopted the
  near-sdk host panic path used by the working WASM.
- Retry reconciliation reached the provider before the agent identity was bound,
  producing `WORKER_KEY_NOT_CONFIGURED` on a legitimate restart. The provider client
  now resolves the worker from the persisted agent row.
- Manual recovery rejected a `PAID` operation whose fulfillment was missing. It now
  queues fulfillment recovery instead of reporting "nothing to do".
- NEP-413 challenge nonces used base64url while the browser decoded with `atob`.
  Challenge nonces now use standard base64 of exactly 32 bytes.
- The wallet-selector stylesheet's Google Fonts `@import` was bundled after Tailwind
  rules, breaking the CSS build. It is served as a static stylesheet from `/public`.
- The API policy probe and the worker both signed with worker one's access key, and
  near-api-js caches nonces per process. A probe could therefore leave the worker's
  next reservation signed with an already-used nonce. Submission failures now reset
  the local signer state, and a reservation whose transaction never landed is
  re-sent with the **same operation ID** rather than parked forever. An ambiguous
  probe outcome is reported as unavailable, never as a contract denial.
- A fresh source copy could not typecheck or test before its first build: generated
  `@poolguard/shared`/`db`/`agent-runtime` output and the Prisma client did not exist.
  Root `postinstall` now builds them, and `pnpm dev` repeats the step, so a copied
  checkout works from `pnpm install` without a prior build. Verified in
  `.tmp/fresh-checkout` before that directory was removed.

## Next verification steps

1. A full clean-copy `pnpm dev` click-through remains unperformed. Its install/build
   phase is covered by the clean-copy rehearsal and its fresh-sandbox phase by the
   checked run above; the stack uses fixed ports, so running both at once needs the
   first stack stopped.
2. If funded testnet accounts are supplied, fill `.env.testnet` from
   [`.env.testnet.example`](../.env.testnet.example), run `pnpm testnet:preflight`,
   deploy the WASM, run `pnpm testnet:verify`, then exercise the NEP-413 wallet
   path end to end. Until then, report the wallet path as reviewed code, not
   live-tested.
3. Configure `AI_API_KEY` and run one genuinely live-model scenario. The live path
   exists but remains unexecuted in this environment.
