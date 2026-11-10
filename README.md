# PoolGuard

**One task budget. Multiple agents. Enforced on-chain.**

PoolGuard is a working NEAR hackathon prototype in which two AI agent workers spend
from one shared task budget while a Rust smart contract enforces the spending policy.
It is built for the **AI Security & Defense** track (secondary: **AI Swarms**).

> Experimental testnet software. Not audited. All balances are test tokens with no
> monetary value. No mainnet support.

![PoolGuard status](https://img.shields.io/badge/network-local%20NEAR%20sandbox-4d6042)

Verified locally against a real `near-sandbox` node on 2026-10-29. No public testnet
deployment is included; see [BUILD_STATUS.md](docs/BUILD_STATUS.md) for exact checks
and remaining limitations.

## What it demonstrates

- A contract-held budget per task, funded by the owner.
- Separate worker accounts with **restricted function-call keys** limited to the
  PoolGuard contract and purchase methods.
- `reserve` before dispatch, so parallel agents cannot overdraw one shared pool.
- A per-operation cap, provider allowlist, task expiry, pause/revocation and
  policy-version checks enforced in Rust.
- A stable operation id that makes transport retries idempotent and changed-argument
  replays impossible.
- At-most-once payout per operation with a private, idempotent transfer callback.
- Durable PostgreSQL jobs, leases, retries and a recovery path that reads the
  original operation from chain after a worker restart or dropped response.
- A real paid service: deterministic supplier-document extraction with structured
  fields, evidence lines, missing-field reporting and stored results.
- Distinct payment and fulfillment states, visible in the UI and database.
- A responsive Next.js application, a TypeScript SDK and a runnable example.
- Four reproducible scenarios: permitted purchase, shared-budget race, malicious
  instruction/contract probe, and lost response recovery.

## Architecture at a glance

```text
owner wallet ──create/fund/register──▶ PoolGuard contract (escrow + policy)
                                            ▲          │ payout
                    reserve / execute        │          ▼
agent worker ──restricted key───────────────┘     provider account
      │                                              │
      └── PostgreSQL job queue / agent loop          └── verifies finalized payment
                │                                           then extracts + stores result
                ▼
          Fastify API + SSE  ◀──────────── Next.js web app
                │
        provider service ──fixed-price catalog / quote / result
```

The contract is authoritative for money. PostgreSQL stores metadata, encrypted
documents, durable jobs, provider results and a **projection** of chain state; it
never authorizes spending by itself. See [ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Repository layout

```text
apps/web                 Next.js App Router UI (Tailwind, Radix, TanStack Query)
apps/api                 Fastify API: NEP-413 auth, tasks, setup plans, operations, SSE
apps/worker              Persistent worker: durable queue + bounded agent runtime
apps/provider            Independent provider: catalog, quotes, payment verification, extraction
contracts/poolguard      Rust contract (near-sdk), 56 unit tests, WASM artifact
packages/shared          Zod schemas, canonical hashing, operation identity, yoctoNEAR math
packages/agent-runtime   OpenAI-compatible client, bounded tool loop, chain client
packages/db              Prisma schema, migrations, seed
packages/sdk             Typed TypeScript client + runnable example
docs                     Architecture, invariants, state machine, threat model and runbooks
scripts                  Dev stack, sandbox provisioning, contract build, sandbox proof
```

## Quick start (local NEAR sandbox)

Prerequisites: Node.js `>=22.22.2`, pnpm `10.20.0`, Rust with `wasm32-unknown-unknown`,
and Docker (or Linux x64 for the embedded PostgreSQL fallback).

```bash
pnpm install
pnpm contract:build
pnpm dev
```

`pnpm install` also builds the generated workspace packages and Prisma client through
`postinstall`, so `pnpm typecheck` and `pnpm test` work in a fresh checkout before the
first build.

`pnpm dev` does the following:

1. Creates `.env` from `.env.example` with generated session/document keys if it is
   missing (existing `.env` is never overwritten).
2. Starts embedded PostgreSQL on `127.0.0.1:55432` when it is not already reachable.
3. Provisions a fresh NEAR sandbox and deploys the contract if `.env.local` is
   absent or its RPC is down; otherwise reuses the running sandbox.
4. Applies migrations and seeds the fixed-price provider catalog.
5. Starts API (`4100`), provider (`4103`), worker and web (`3000`).

Open <http://127.0.0.1:3000/app> and choose **Use sandbox session**. The session is
explicitly gated to local sandbox mode; it is not a production login.

To run services separately (Postgres, sandbox, migrations, each app), follow
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). To use Docker PostgreSQL:

```bash
docker compose up -d postgres
```

### Testnet

Testnet follows the same code path but requires a deployed contract, real testnet
owner wallet, provider account and two worker accounts with restricted keys. No
testnet deployment or transaction is included in this checkout. A production-shaped
environment template is at [.env.testnet.example](.env.testnet.example); the full
account, key, deployment and verification sequence is in
[docs/TESTNET_RUNBOOK.md](docs/TESTNET_RUNBOOK.md).

`.env.testnet` is loaded automatically after `.env`; process environment values
win, and `.env.local` is refused in production/testnet. The web app registers
Sender, Nightly, Meteor and HERE for NEP-413 signing.

The read-only deployment gate is available before any credentials are used:

```bash
pnpm testnet:preflight   # config, keys, accounts, deployed WASM and access keys
pnpm testnet:verify      # additionally checks API, provider and web over HTTPS
```

These commands never sign, deploy or spend. The owner's private key or seed phrase
is never configured in the application. The gate also checks that worker accounts
have no full-access keys, that the owner can cover storage deposits, that secure
cookies are enabled, that `/dev/session` is blocked, and that the provider catalog
is bound to `PROVIDER_ACCOUNT_ID`.

## Tests and verification

```bash
# Rust contract: 56 unit tests (funding, policy, races, callbacks, withdrawal, invariants)
pnpm contract:test

# Real contract proof against near-sandbox with restricted keys and native balances
pnpm contract:sandbox-test

# TypeScript plus the testnet config/access-key safety tests
pnpm test

# Target only the testnet preflight checks
pnpm test:testnet-check

# Strict TypeScript across every package
pnpm typecheck

# Next.js production build
pnpm --filter @poolguard/web build

# Browser journeys (requires `pnpm dev` in another terminal)
pnpm test:e2e
```

The sandbox proof intentionally talks to a real node: it starts `near-sandbox`,
deploys the built WASM, creates real accounts and restricted keys, races two workers
for insufficient funds, checks provider balance deltas, repeats execution, replays
changed arguments and verifies conservation. It does not use mocked transaction ids.

## Four demo scenarios

| Scenario | Setup | Expected observation |
| --- | --- | --- |
| **A — permitted purchase** | 0.05 budget, 0.02 cap, two clean docs | Two payments, two delivered extractions, spent 0.04 |
| **B — shared-budget race** | 0.03 budget, 0.02 cap | Exactly one 0.02 reservation wins; the other gets `INSUFFICIENT_AVAILABLE_BUDGET` and may fall back to the 0.005 service |
| **C — malicious instruction** | Adversarial document + labelled probe | Untrusted text is never executed; a separate non-allowlisted provider request is rejected by the contract (`PROVIDER_NOT_ALLOWED`) |
| **D — lost response** | 0.03 budget, labelled fault | Same operation id after retry, payout attempts 1, stored result recovered, no second payout |

The full click path, expected budgets and a two-minute spoken script are in
[docs/DEMO.md](docs/DEMO.md). The draft X post in that file is **not published**.

## AI mode

Live agent mode uses any OpenAI-compatible chat-completions endpoint configured by
`AI_BASE_URL`, `AI_API_KEY` and `AI_MODEL`. The model selects only a catalog
`service_key` and writes a summary. Deterministic code computes amounts, operation
ids, provider accounts and transaction payloads.

If `AI_API_KEY` is absent, the API/UI clearly labels runs as **scripted fixtures**.
The contract, provider, payments and recovery remain real; the model is not called.
Do not present a scripted run as a live AI execution. AI inference costs are outside
the task budget and are not metered by PoolGuard.

## Safety properties and limits

- At-most-once **payout** per operation id, enforced by the contract.
- Provider deduplication and stored results are cooperative; universal exactly-once
  fulfillment across a chain and an off-chain service is not claimed.
- A timeout is never treated as proof of failure. `PAYOUT_PENDING` can only be
  resolved by the private callback.
- Storage deposits and contract operational funds are separate from spendable task
  money. The conservation equation is documented in
  [CONTRACT_INVARIANTS.md](docs/CONTRACT_INVARIANTS.md).
- The provider is operator-controlled and fixed-price; quotes are not signed.
- Documents are encrypted at rest but decrypted for the worker and model.
- Worker restricted keys are held in server environment variables; there is no HSM.
- The demo provider, documents and prices are fixtures, not marketplace adoption.
- Local sandbox transactions have no public explorer. Testnet hashes would be
  publicly inspectable after a real deployment.

See [KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) and
[THREAT_MODEL.md](docs/THREAT_MODEL.md) before making any claim about this project.

## Documentation

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — processes, authority, flow, identity.
- [CONTRACT_INVARIANTS.md](docs/CONTRACT_INVARIANTS.md) — accounting and enforcement.
- [STATE_MACHINE.md](docs/STATE_MACHINE.md) — payment/fulfillment transitions.
- [THREAT_MODEL.md](docs/THREAT_MODEL.md) — assets, attackers, residual risk.
- [DEMO.md](docs/DEMO.md) — reproducible scenario runbook and script.
- [DEPLOYMENT.md](docs/DEPLOYMENT.md) — local, Docker, sandbox and testnet setup.
- [TESTNET_RUNBOOK.md](docs/TESTNET_RUNBOOK.md) — identities, preflight, deploy and live checks.
- [KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) — candid scope limits.
- [BUILD_STATUS.md](docs/BUILD_STATUS.md) — implemented behavior and checks run.

## SDK

```bash
pnpm --filter @poolguard/sdk build
pnpm --filter @poolguard/sdk example
```

The SDK wraps the API with typed task, budget, quote, reserve, execute, recovery and
result calls. Amounts are decimal yoctoNEAR strings; no float is used for money.
See [packages/sdk/src/index.ts](packages/sdk/src/index.ts) and
[packages/sdk/examples/session.ts](packages/sdk/examples/session.ts).

## License

MIT — see [LICENSE](LICENSE). This repository is a hackathon prototype, not an
audited financial product. Do not deploy to mainnet or custody real value.
