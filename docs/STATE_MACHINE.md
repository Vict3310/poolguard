# State Machine

PoolGuard keeps two independent state machines per operation:

- **Payment** is authoritative on the NEAR contract.
- **Fulfillment** is off chain and never rewrites payment state.

The database stores a projection of payment state and the fulfillment record. It
must not be used to infer that a pending transfer failed.

```text
Operation: (task_id, operation_id)
            payment_state  : on chain, financial truth
            fulfillment    : off chain, delivery truth
```

## Payment state machine

Defined in `contracts/poolguard/src/types.rs` and mirrored in
`packages/shared/src/states.ts`.

| From | To | Trigger | Guards |
| --- | --- | --- | --- |
| (none) | `Reserved` | `reserve` | Agent active, registered key, direct signer, task not paused/expired, current policy version, amount <= per-op cap, provider allowlisted, future expiry, operation slot available, `available >= amount` |
| `Reserved` | `Reserved` | repeated `reserve` with identical binding | Idempotent return; no accounting change |
| `Reserved` | `PayoutPending` | `execute` | Same agent, not expired reservation, task not paused/expired, current policy version, amount <= cap, provider still allowlisted |
| `PayoutPending` | `PayoutPending` | repeated `execute` | Returns existing operation; **no second transfer** |
| `Reserved` | `Cancelled` | `cancel_reservation` | Caller is reserving agent or owner; still `Reserved` |
| `Reserved` | `Expired` | `expire_reservation` | Still `Reserved` and block > reservation deadline; permissionless |
| `PayoutPending` | `Paid` | `on_payout_complete` success | Private callback, exactly one promise result, reserved >= amount |
| `PayoutPending` | `PayoutFailed` | `on_payout_complete` failure | Private callback, exactly one promise result, reserved >= amount |
| `Paid` | `Paid` | repeated/late callback or `execute` | Ignored/idempotent return |
| terminal (`Paid`, `PayoutFailed`, `Cancelled`, `Expired`) | (none) | any operation reuse | `OPERATION_TERMINAL`; new logical purchase needs a new id |

### Reserved

Created when the contract moves the amount from `available` to `reserved`. The
operation is a hold, not a payment. `payout_attempts` is 0 and no transfer has
been created.

It can be cancelled by the reserving agent or task owner, or expired after
`reservation_expires_at_block`. Expiry is permissionless because the state and
deadline guard make it safe.

### PayoutPending

Set **before** the transfer promise is created. The amount stays in `reserved`.
There is deliberately no contract method that force-fails or releases this state.
A timeout, lost RPC response or worker crash leaves it pending. Only the private
callback can settle it.

`payout_attempts` is incremented when entering this state. Repeated `execute`
returns the same operation without incrementing it or creating a transfer.

### Paid

Set only by a successful private callback. `reserved` decreases and `spent`
increases by exactly the operation amount; `settled_at_block` is recorded. This is
the only state in which the provider may deliver a result.

### PayoutFailed

Set only by a failed private callback. `reserved` decreases and `available`
increases by exactly the operation amount. The operation is terminal; it cannot be
re-executed. Retrying the purchase requires a new logical operation id (new
reservation), which may fail if policy or budget no longer permits it.

### Cancelled / Expired

Only reachable from `Reserved`. Both release the exact amount from `reserved` back
to `available` once. A `PayoutPending` operation can never be cancelled or expired
by these paths.

## Fulfillment state machine

Defined in `packages/shared/src/states.ts`; stored in PostgreSQL.

| From | To | Trigger |
| --- | --- | --- |
| `not_requested` | `processing` | Worker requests the paid service after reading `paid` from chain |
| `not_requested` | `delivery_failed` | Reserved by the state table for a pre-dispatch failure; normal worker flow uses `processing` |
| `processing` | `delivered` | Provider returned a structured result; worker stored it |
| `processing` | `delivery_failed` | Permanent provider rejection/processing error |
| `processing` | `unknown` | Retryable provider/chain error; payment already settled, delivery not confirmed |
| `delivery_failed` | `processing` | Explicit retry after fixing the cause |
| `unknown` | `processing` | Recovery retry |
| `unknown` | `delivered` | Recovery found the stored result |
| `unknown` | `delivery_failed` | Provider reports a permanent delivery failure |
| `delivered` | (none) | Terminal |

Rules:

- Fulfillment never changes `payment_state`.
- A `delivered` result requires a `paid` operation read from final chain state; the
  provider re-verifies payment independently.
- `delivery_failed` does **not** refund money. Payment settlement and result
  delivery are separate product states.
- The worker sets `needsRecovery` for `payout_pending` payment or unresolved
  fulfillment.
- Duplicate provider requests return the stored result keyed by
  `(chainTaskId, operationId)`; they do not re-run extraction for a delivered row.

## Withdrawal state machine

Withdrawals are separate records (`pending_withdrawals`) rather than operations.

| From | To | Trigger | Guards |
| --- | --- | --- | --- |
| (none) | `withdrawal_pending` | `withdraw_available` | Owner, direct signer, positive amount, withdrawal storage deposit, pending count < 3, `amount <= available` |
| `withdrawal_pending` | `withdrawn` | `on_withdrawal_complete` success | Private callback, one promise result |
| `withdrawal_pending` | `available` | `on_withdrawal_complete` failure | Private callback, one promise result |

`withdrawal_pending` is part of the conservation equation and is not spendable.
A duplicate/late callback finds no pending record and returns `"ignored"`.

## Durable job states

PostgreSQL `Job` rows back the worker queue.

```text
QUEUED --claim--> RUNNING --complete--> SUCCEEDED
   ^                 |
   |                 +--retryable fail--> QUEUED (backoff, attempts < max)
   |                 +--permanent fail--> FAILED
   |                 +--lease expired--> QUEUED (reaper increments attempts)
   |                 +--attempts >= max on requeue--> DEAD
```

- Claiming uses `FOR UPDATE SKIP LOCKED`; two processes cannot run the same job.
- A lease is renewed by heartbeat while the handler runs.
- `RUN_AGENT` and `RECOVER_OPERATION` handlers are re-runnable.
- `RUNNING` after a crash is not proof of failure; the reaper returns the job to
  the queue after lease expiry.

## Recovery decision table

The recovery path only reads chain evidence and stored provider results. It never
invents a new purchase.

| Chain payment state | Recovery action |
| --- | --- |
| `reserved` and deadline passed | Call `expire_reservation`; release to available once |
| `reserved` and still live | Wait or cancel according to owner/agent policy; no payout |
| `payout_pending` | Poll/re-read; do not dispatch again, do not expire. Wait for final callback |
| `paid` and result delivered | Finish from stored result; no new payment |
| `paid` and result missing/processing | Ask provider for the stored/claimed result; no new payment |
| `payout_failed` | Terminal; report failure. A new purchase requires a new operation id |
| `cancelled` / `expired` | Terminal; report; no payout |

### "Timeout is not failure"

A transport timeout means the client does not know whether the node accepted the
transaction. The worker records the prepared transaction hash before broadcast and
marks the operation `PAYOUT_PENDING` with `needsRecovery` on an unknown outcome.
The next attempt reads the original operation id and hash. The contract's private
callback, not the timeout, decides `Paid` vs `PayoutFailed`.

This is what makes the response-loss demo safe: the retry finds the same operation
and payout instead of creating a second one.

## Policy changes, pause and revocation

- `update_policy` increments `policy_version`.
- An existing `Reserved` operation from an older version cannot `execute`
  (`POLICY_VERSION_STALE`). The agent/owner may cancel it, or it can expire after
  its deadline; the funds remain reserved until one of those happens.
- `pause_task` blocks new reservations and execution of existing reservations.
  `resume_task` restores execution if the reservation has not expired.
- `revoke_agent` blocks that agent's future reservations/execution. It does not
  reverse an already-dispatched transfer.

## Invariant checks at transitions

Every accounting transition checks:

```text
available + reserved + spent + withdrawn + withdrawal_pending == total_funded
```

If the check fails, the contract does not commit the new state (the callback
returns `"ignored"` for a projected inconsistency). See
[CONTRACT_INVARIANTS.md](CONTRACT_INVARIANTS.md) for the full list and test
evidence.
