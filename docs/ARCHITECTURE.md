# PoolGuard Architecture

PoolGuard lets two agent workers spend from one task budget while a NEAR smart
contract enforces the financial and identity rules. This document describes what
runs where, which component is authoritative, and what the current MVP does not
claim.

> Experimental testnet software. Not audited. Test tokens have no monetary value.

## Why NEAR, and what the database is for

NEAR provides:

- A contract account that holds escrowed testNEAR independently of the operator.
- Account-scoped signing keys, including **function-call access keys** restricted to
  the PoolGuard contract and the worker methods.
- Atomic multi-action setup transactions (create, fund and register agents in one
  owner approval).
- Finalized on-chain state that both the backend and the provider can read.
- Cross-contract transfers whose success/failure callback resolves the accounting.

The PostgreSQL database is not a bank. It stores task metadata, encrypted
documents, quotes, provider results, durable jobs, transaction hashes, agent-run
records and a **projection** of contract state. It never authorizes a payment on
its own.

A database alone is sufficient when one trusted operator controls every buyer and
seller and no external party needs to verify balances, reservations or payouts.
PoolGuard exists for the case where agents are semi-autonomous and the operator,
worker processes and provider should not be able to rewrite financial history.
The contract is the shared source of truth across those trust boundaries.

## Processes

| Component | Location | Responsibility | Holds |
| --- | --- | --- | --- |
| Web app | `apps/web` | Next.js App Router UI; wallet sign-in and setup approval; SSE timeline | Browser session cookie; no private keys |
| API | `apps/api` | NEP-413 auth, task/template metadata, setup-plan construction, chain reads, SSE, manual recovery | Worker restricted keys; sandbox-only owner key |
| Worker | `apps/worker` | Durable job execution, agent loop, reserve/execute/recover | Worker restricted keys |
| Provider | `apps/provider` | Catalog, quotes, paid-result verification, extraction, stored results | Provider receives transfers; no contract admin key |
| Contract | `contracts/poolguard` | Task policy, reservations, payouts, withdrawals, accounting | Escrowed testNEAR and contract state |
| PostgreSQL | `packages/db` | Metadata, jobs, results, projections, audit events | No signing authority |
| NEAR sandbox/RPC | external process | Executes contract; final balances and receipts | Chain state |

The API and worker are separate processes. A crashed worker does not lose the
queue because the job row remains in PostgreSQL.

## The four identities

1. **Owner account** (`owner.*` in sandbox). Creates and funds tasks, sets policy,
   registers/revokes agents, pauses/resumes, and withdraws unreserved funds.
   In testnet, this account is controlled only by the user's wallet. The backend
   never receives the owner key in normal operation.
2. **Contract account** (`poolguard.*`). Owns the escrow and contract state. It is
   not a task owner and has no method that spends task funds arbitrarily.
3. **Worker accounts** (`agent-one.*`, `agent-two.*`). Each is a separate NEAR
   account registered for a specific task and signing key. The demo provisions a
   function-call key restricted to `reserve`, `execute`, `cancel_reservation` and
   `expire_reservation` on the PoolGuard contract. The account still has its own
   full key for provisioning, but the application only receives the restricted key.
4. **Provider account** (`extract.*`). Receives approved payouts. It has no owner
   or contract administration authority.

Function-call key allowances limit **gas**, not the task budget. A worker key can
call `execute` as often as its allowance permits; the contract's operation state
is what prevents a second payout.

### Sandbox exception

`scripts/sandbox.mjs` creates local accounts and writes `.env.local`, including a
sandbox-only owner key used by `/dev/tasks/:id/submit-setup`. That endpoint and
the dev session are unavailable unless `LOCAL_SANDBOX_MODE=true`,
`ALLOW_DEV_SESSION=true` and `NODE_ENV!=production`. This is a demo convenience,
not the production authority model.

## Task setup

1. The owner creates a task in the UI. The API stores a `DRAFT` row and encrypted
   documents; no chain transaction is sent yet.
2. The API builds a setup plan from `get_config` values. One owner-wallet
   transaction can contain:
   - `create_task` with the task storage deposit;
   - `fund_task` with the budget amount;
   - `register_agent` for each worker with its agent storage deposit.
3. The owner signs in the wallet (testnet) or the gated sandbox helper signs.
4. The API confirms the transaction hash, reads the contract task, verifies that
   the on-chain owner and both agents match the database row, then projects the
   chain result into PostgreSQL and marks the task active.

Storage deposits are paid to the contract and are **not** part of the spendable
budget. They are non-refundable in this MVP. Setup transactions are deliberately
separate from normal worker reservations and payouts.

## Purchase path

1. The model (or a labelled scripted fixture) chooses a `service_key` from the
   known catalog. It cannot choose a provider account, amount or recipient.
2. Deterministic code computes:
   - a canonical request hash over the exact document input and service id;
   - an operation id over network, contract, task, agent, provider, amount,
     service id, request hash, output schema hash, policy version and expiry.
3. The worker calls `reserve` with its restricted key. The contract checks the
   agent identity and registered key, task status, expiry, policy version,
   per-operation cap, provider allowlist, operation-record bound and available
   budget, then moves the amount from `available` to `reserved`.
4. The worker calls `execute`. The contract re-checks policy and reservation
   state, marks the operation `PayoutPending` **before** dispatching a transfer,
   and sends exactly one transfer with a callback.
5. The transfer callback (`on_payout_complete`) is private to the contract. It
   moves `reserved` to `spent` on success or back to `available` on failure, and
   records `Paid` or `PayoutFailed`. A duplicate or late callback is ignored.
6. Only after reading `paid` from chain does the worker ask the provider for the
   result. The provider independently verifies finalized chain state, provider,
   amount, request hash and output-schema hash before processing.
7. The provider stores one result per `(chainTaskId, operationId)` with a unique
   database key, so duplicate/concurrent requests return the stored result rather
   than extracting twice.
8. The worker stores the result in PostgreSQL and marks fulfillment `DELIVERED`.
   Payment state remains separate and is never rewritten from the delivery path.

The operation id identifies one **logical purchase**, not one HTTP attempt. It is
reused across transport retries. The worker persists the operation before
broadcast; the API's direct `POST /tasks/:id/purchases/reserve` route looks up an
existing `Reserved`, `PayoutPending` or `Paid` operation for the same task, agent,
provider, service, input, amount, schema and policy version and reuses it (resending
the stored reservation only if the chain never saw it), so a retried request never
derives a second operation id from a newer block height.

## Operation identity

`computeOperationId` canonicalizes this payload and hashes it with SHA-256:

| Field | Purpose |
| --- | --- |
| `domain` | `poolguard/operation/v1`; changes only with a domain bump |
| `network` | sandbox or testnet binding |
| `contract_id` | prevents cross-contract replay |
| `task_id` | task binding |
| `agent_id` | worker binding |
| `provider_id` | payout recipient binding |
| `amount_yocto` | exact integer amount |
| `service_id` | purchased service |
| `request_hash` | exact input hash |
| `output_schema_hash` | expected output shape |
| `policy_version` | policy under which the purchase was authorized |
| `expires_at_block` | operation expiry |

The contract stores the same binding and rejects a reused operation id whose
parameters differ (`OPERATION_ID_CONFLICT`). `reserve` is idempotent for the same
binding while `Reserved`, `PayoutPending` or `Paid`; terminal states reject reuse.

Canonicalization sorts object keys and stringifies safely, so JSON property order
does not affect hashes. Amounts are integer yoctoNEAR strings; no JavaScript float
is used for money.

## Durable worker and recovery

`JobQueue` uses PostgreSQL row locking:

- Claiming uses `FOR UPDATE SKIP LOCKED`, so sibling workers cannot run the same
  job simultaneously.
- A claim writes `leaseOwner`, `leaseExpiresAt` and increments `attempts`.
- The worker heartbeats the lease while running. Expired `RUNNING` leases are
  reaped back to `QUEUED`; exhausted retries are dead-lettered.
- Failures are classified as retryable or permanent. Backoff is bounded.
- `RUN_AGENT` and `RECOVER_OPERATION` handlers are written to be re-runnable.

Payment dispatch is prepared and its transaction hash recorded **before**
broadcast. If the response is lost, the worker marks the operation
`PAYOUT_PENDING` with `needsRecovery` and retries; it never creates a new operation
from a timeout. On retry, `resumeIfSettled`/`reconcileOperationById` read the
original operation from chain. If it is `paid`, they fetch the stored provider
result and finish. If it is still `payout_pending`, the job backs off. Only a
finalized callback can settle or release the pending amount.

See [STATE_MACHINE.md](STATE_MACHINE.md) for transitions.

## Provider trust model

The provider is operator-controlled and has a fixed-price catalog. Quotes are not
cryptographically signed; they are an informational, fixed-catalog price binding.
Purchase authorization is an ed25519 signature by the worker's registered key over
a canonical payload containing domain, network, contract, action, operation id,
request hash, timestamp and nonce. The provider fetches agent registrations from
the contract and verifies that key. Each signed authorization is single use: the
provider remembers the nonce until the authorization would be stale and rejects a
replay with `AUTH_REPLAYED`. Result fetches carry the authorization in
`x-poolguard-*` headers rather than the query string, so signatures stay out of
access logs.

The provider's payment check reads finalized contract state. It does not trust a
client-supplied "paid" flag. It verifies network/contract via its configured chain
client, plus provider account, amount, request hash and output schema hash.

Guarantee: **at-most-once payout through the PoolGuard contract**, plus
cooperative provider deduplication and recoverable stored results. This is not a
claim of universal exactly-once execution across blockchain and off-chain
services. A provider crash after storing a result is recoverable; a crash during
extraction may cause recomputation, though the stored row/claim path reduces it.

## Activity, SSE and evidence

Every meaningful transition is written to `AuditEvent` with a stable `dedupeKey`.
The task timeline endpoint returns the persisted events; the SSE endpoint
(`GET /tasks/:id/events/stream`) polls by monotonically increasing event id and
emits `id:` fields so reconnects can use `Last-Event-ID` without duplicating
events. The UI refetches contract-backed task detail separately from the event
stream.

Transaction hashes, operation ids, request hashes and chain block heights are
exposed in the operation drawer. In sandbox there is no public explorer, so the
UI labels sandbox hashes as local evidence rather than linking them to testnet.

## What is real in each mode

| Capability | Local sandbox | NEAR testnet |
| --- | --- | --- |
| Rust contract | Real WASM on `near-sandbox` | Same WASM deployed to testnet |
| Native token | Sandbox testNEAR | Testnet testNEAR |
| Restricted worker keys | Real function-call keys | Real function-call keys |
| Wallet sign-in | Gated sandbox session (no signature) | NEP-413 message signature |
| Owner funding | Sandbox-only helper key | User wallet transaction |
| Provider payment | Real transfer on sandbox | Real transfer on testnet |
| Explorer | None; local RPC evidence | NEAR explorer links where configured |
| AI | Scripted fixture unless `AI_API_KEY` is set | Live model if configured |

A scripted run is labelled in the API/UI and is not presented as model output.
Contract, provider and accounting paths remain real in scripted mode.

## Defense in depth: NEAR AI Cloud and OutLayer

Two optional ecosystem integrations sit in front of the contract. Each catches a
different failure; the contract stays the final authority.

| Layer | What it does | What PoolGuard verifies | Mode |
| --- | --- | --- | --- |
| NEAR AI Cloud | Agents reason inside TEEs, so supplier documents are processed in an enclave, not by a regular AI provider. | Per completion, SHA-256 of the exact request and response bytes; NEAR AI's response signature must bind those hashes and verify (ed25519) against the signing key in the attestation report. The Intel TDX quote is verified by NEAR AI's verifier, not by PoolGuard. | Optional: on when `AI_BASE_URL` is `https://cloud-api.near.ai/v1`. |
| OutLayer | The worker's NEAR key lives in OutLayer's enclave; the worker signs through an API key. OutLayer applies the wallet's policy (spend caps, transaction types, freeze) before signing. | The custody wallet is a 64-hex implicit account whose key is registered on the contract like any agent key. Provider requests are NEP-413 signed and verified against that registered key. | Optional, per worker: `WORKER_*_CUSTODY=outlayer`; otherwise a restricted function-call key in server env. |
| PoolGuard contract | Shared budget, per-purchase cap, provider allowlist, reserve-then-pay-once. | Always enforced on chain. | Always on. |

Custody transactions are signed remotely, so their hash is known only after
broadcast. The chain client stores a placeholder, swaps in the real hash through
`onTxHashResolved`, and reads the outcome from chain, so denials and receipts are
handled exactly like locally signed transactions. An unknown outcome is reconciled
by operation id; nothing is re-derived. Evidence for private inference is stored in
`AgentRun.outputJson.privateInference` and surfaced on each run; `GET
/ai/attestation` exposes the cached attestation summary.

## Deliberate boundaries

- One flat budget per task; no custom tokens, stablecoins or NEAR Intents.
- Two workers in the demo; the contract supports up to six agents.
- Bounded operation records per task (`MAX_OPERATIONS_PER_TASK = 32`), at most
  `MAX_OPERATIONS_PER_AGENT = 16` per agent.
- No owner escape hatch for a `PayoutPending` operation; this is intentional.
- No general dispute arbitration or reputation system.
- No claim that revocation reverses an already dispatched transfer.
- No claim that the model cannot be prompt-injected; the contract, not the model,
  is the authority. Scenario C sends a separate labelled adversarial request to
  prove the policy boundary.
