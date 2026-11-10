# PoolGuard testnet runbook

Status: **tooling is ready; no public testnet deployment has been performed.**
This runbook describes the exact path to a live NEAR testnet deployment and the
checks that must pass before calling it live. It does not authorize signing,
spending testnet NEAR or publishing a deployment.

The local sandbox demo remains the reproducible evidence in this checkout. A
public testnet deployment adds public explorer evidence; it does not make the
prototype audited or production-ready with real value.

## 1. Boundaries

- **Testnet only.** Mainnet is not implemented or supported. The preflight
  rejects mainnet RPC hosts, non-`testnet` chain IDs and non-`.testnet` account
  names.
- **No owner key in the app.** The owner signs setup and administration
  transactions in the wallet. The API builds plans, it does not hold owner
  authority.
- **No deployer key in the app.** The contract account key can replace the
  contract code; keep it offline or in a secured ops environment.
- **No browser secrets.** Worker keys, session secrets, document keys, database
  credentials and AI keys stay server-side.
- **No automatic deploy from CI yet.** Deployment is a reviewed operation with
  an explicit confirmation gate, not a side effect of `pnpm install`.

## 2. Prerequisites

- Node.js `>=22.22.2`, pnpm `10.20.0`, Rust with `wasm32-unknown-unknown`.
- NEAR CLI installed and authenticated for the deployer/owner workflow.
- A funded NEAR testnet owner/deployer account. Testnet NEAR is available from
  the NEAR faucet; it has no monetary value.
- A PostgreSQL instance reachable over TLS with backups and a least-privilege
  application user.
- Public HTTPS origins for the web app, API and provider.
- A secret manager for `SESSION_SECRET`, `DOCUMENT_ENCRYPTION_KEY` and the two
  restricted worker keys.
- Optional: an OpenAI-compatible `AI_API_KEY` for live model runs. Without it,
  runs are labelled `scripted`; contract, provider and accounting still execute.

## 3. Identities and key custody

Create separate accounts; do not reuse one account for multiple roles.

- **Contract/deployer** — `poolguard.testnet`. Holds the deployed WASM and its
  storage/operational balance. Full-access key offline or in a secured ops
  environment. This key can upgrade the contract, so treat it as the highest
  trust boundary.
- **Owner** — `owner.testnet`. Creates tasks, funds budgets, registers agents,
  updates policy, pauses/revokes and withdraws. Owner seed/private key never
  enters the API, worker, provider, browser bundle or logs.
- **Workers** — `agent-one.testnet`, `agent-two.testnet`. Each gets a distinct
  **function-call** key limited to `poolguard.testnet` and exactly:
  `reserve`, `execute`, `cancel_reservation`, `expire_reservation`.
  Remove full-access keys after adding the restricted keys. One process per key;
  NEAR nonces are per-key.
- **Provider payout** — `extract.testnet`. Receives contract payouts. The
  provider service does not need its private key.
- **Policy probe** — a valid testnet account that is deliberately not on any
  task allowlist. Used for the contract-enforced vendor denial check.

The contract account's `owner` field is the deployer and has no power over task
funds. Function-call key allowance limits gas spend, not the task budget; the
contract enforces budget, per-operation cap, provider allowlist and reservations.

## 4. Deploy the contract

Build and test locally first:

```bash
pnpm install --frozen-lockfile
pnpm contract:build
pnpm contract:test
```

Create the contract account, deploy the WASM and initialize it using the
commands in [DEPLOYMENT.md](DEPLOYMENT.md#72-build-and-deploy-the-contract).
Record:

- contract account ID;
- WASM SHA-256;
- deployment transaction hash;
- initialization transaction hash.

Do not put the deployer key into `.env.testnet`. Do not upgrade the contract as
part of a routine app deployment; an upgrade needs its own review and rollback
plan.

## 5. Configure the environment

```bash
cp .env.testnet.example .env.testnet
chmod 600 .env.testnet
```

The API, worker, provider and seed script load `.env` and then `.env.testnet` automatically. Process environment values win; `.env.local` is refused in production/testnet. Set `POOLGUARD_ENV_FILE` only if the overlay is not `.env.testnet`. Remove any `.env.local` from the host before running the gate.

Fill every placeholder. At minimum:

- `NODE_ENV=production`, `NEAR_NETWORK=testnet`
- `NEAR_RPC_URL` (HTTPS testnet RPC; use a dedicated provider for capacity)
- `POOLGUARD_CONTRACT_ID`, `OWNER_ACCOUNT_ID`, `PROVIDER_ACCOUNT_ID`
- both worker account IDs and restricted private keys
- `PROVIDER_ORIGIN` and matching `PROVIDER_SERVICE_DOMAIN`
- `API_ORIGIN`, `WEB_ORIGIN`
- `DATABASE_URL` with TLS
- `SESSION_SECRET`, `DOCUMENT_ENCRYPTION_KEY`
- `LOCAL_SANDBOX_MODE=false`, `ALLOW_DEV_SESSION=false`,
  `FAULT_INJECTION_ENABLED=false`
- no `SANDBOX_OWNER_PRIVATE_KEY` or `SANDBOX_PROVIDER_PRIVATE_KEY`

`WEB_ORIGIN` must be the exact browser origin. `PROVIDER_SERVICE_DOMAIN` is the
provider host without a scheme and is bound into provider buyer authentication.
Set `API_ORIGIN` before `pnpm build`; Next reads it for the `/api` rewrite.

Never commit `.env.testnet`, paste it into chat, or copy `.env.local` from the
sandbox. [`.env.testnet.example`](../.env.testnet.example) is intentionally placeholder-only.

## 6. Run the static and on-chain preflight

This command is read-only. It does not sign, deploy, spend or write to the
database.

```bash
pnpm testnet:preflight
```

It checks:

- production/testnet switches and absence of sandbox authority;
- HTTPS origins, NEP-413 provider domain, database TLS and secret formats;
- worker key parsing and derived public keys;
- one distinct account per role;
- testnet RPC `chain_id`;
- contract account, deployed code and `get_config`;
- owner/provider/worker account existence;
- each restricted worker access key: contract scope, exact method list and
  finite gas allowance;
- the deployed WASM hash against the built artifact;
- absence of full-access keys on the worker accounts;
- the owner balance against the task and two agent storage deposits;
- secure-cookie metadata and a blocked `/dev/session`;
- the provider catalog's account binding.

Useful variants:

```bash
pnpm testnet:preflight --config-only   # CI-safe static validation
pnpm testnet:preflight --json          # machine-readable report
pnpm testnet:preflight --env-file .env.testnet
POOLGUARD_ENV_FILE=.env.testnet pnpm testnet:preflight   # same selection for services and the gate
```

Exit codes: `0` checks passed, `1` deployment gate failed, `2` missing/invalid
arguments or environment file. A warning is not a pass for the security flags;
those are errors.

Do not start public services if the preflight fails.

## 7. Start the services

Run migrations and seed, then start the four processes under a supervisor:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm db:generate
pnpm db:migrate
pnpm db:seed

pnpm --filter @poolguard/api start
pnpm --filter @poolguard/worker start
pnpm --filter @poolguard/provider start
pnpm --filter @poolguard/web start
```

Use one worker process per restricted key. Give each process a unique
`WORKER_ID`. Do not horizontally scale a single worker key; if you need more
concurrency, create additional worker accounts/keys and add them deliberately.

Required operational controls:

- HTTPS termination and secure cookies;
- `API_TRUST_PROXY` set to the trusted proxy's IP/CIDR (hop counts are
  rejected), and `API_RATE_LIMIT_MAX` sized for demo traffic;
- secret manager injection, not a committed `.env`; `.env.local` must be absent;
- database TLS, backups and a restore drill;
- log collection with secret redaction;
- alerts for API `/ready`, RPC errors, provider `/ready`, failed jobs,
  `PAYOUT_PENDING` and `needsRecovery`;
- rate limiting, request-size limits, WAF/DDoS protection and security headers;
- review of `trustProxy` if the API is behind a reverse proxy.

## 8. Live verification

```bash
pnpm testnet:verify
```

This repeats the preflight, then checks:

- API `/health`, `/ready` and `/meta`;
- `network=testnet`, expected contract, no sandbox/dev session;
- API worker public keys match the configured restricted keys;
- provider `/health`, `/ready` and non-empty catalog;
- web `/` and `/app` render over HTTPS.

Then perform the owner-wallet acceptance flow. These are not automated by the
preflight:

1. Connect a funded testnet owner wallet.
2. Create a task and review the setup plan.
3. Sign one owner transaction containing `create_task`, `fund_task` and both
   `register_agent` calls.
4. Confirm the API marks the task active only after finalized chain state.
5. Run two agents against one shared budget; confirm one wins and the other is
   denied or falls back without overspending.
6. Attempt a non-allowlisted provider; confirm the contract denial.
7. Retry the same operation ID; confirm no second payout.
8. Stop the worker mid-execution, restart it, and confirm recovery without a
   duplicate payout.
9. Confirm a paid operation whose delivery was lost returns the stored provider
   result without another payment.
10. Confirm payment state and fulfillment state remain separate in the UI, and
    record transaction hashes for public explorer evidence.

Also run the responsive desktop and 360px journeys against the deployed origin,
not only localhost.

## 9. Rollback and incident handling

- **Stop new work first:** stop the worker processes, then the API, provider and
  web. Do not kill processes by broad name patterns.
- **Do not assume a timeout is a failed transfer.** A `PAYOUT_PENDING` operation
  can only be settled/released by its callback. Treat unresolved operations as
  pending and reconcile from chain state.
- **Do not upgrade the contract during an incident** unless the upgrade is the
  reviewed remediation. The deployer key can replace code; coordinate it.
- **Preserve evidence:** keep transaction hashes, operation IDs, finalized block
  heights, API logs and provider results before restarting or cleaning up.
- **Rotate worker keys** if a host or secret store is suspected compromised.
  Add the new restricted key, update the worker secret, restart one worker at a
  time, then remove the old key.
- **Unpublish/stop the public endpoint** if policy or payment safety is in doubt.
  A testnet demo is not worth leaving a ambiguous financial state exposed.

## 10. Remaining production blockers

These are not solved by a testnet deployment:

- No external security audit.
- No refunds, disputes or chargebacks.
- A pending payout can lock funds if its callback never executes.
- At-most-once payout is enforced; universal exactly-once fulfillment is not.
- Provider results share the application database in this MVP.
- Fixed, operator-controlled catalog prices; quotes are not signed.
- Restricted worker keys are environment secrets; no KMS/HSM or rotation
  automation is included.
- No built-in supervisor, metrics backend, alerting stack or dashboard.
- No mainnet, stablecoin, Intents, Chain Signatures or general checkout.
- The live AI model path and funded testnet wallet path still need an actual
  external run; local sandbox tests are not a substitute.

## 11. What must be supplied externally

1. Explicit confirmation to sign/deploy and spend testnet NEAR.
2. Funded testnet accounts and key custody for deployer/owner/worker roles.
3. Public HTTPS origins and a hosted PostgreSQL instance.
4. A secret manager containing the production-shaped values.
5. Optional `AI_API_KEY` for live model runs.

Until those exist, the correct status is: **testnet tooling ready, deployment
not performed, production read-out not claimed.**
