# Contract Invariants

This document states the financial and authority invariants enforced by
`contracts/poolguard/src/lib.rs` and points to the unit tests that exercise them.
The contract is experimental and has not been audited.

## 1. Conservation of task money

For every task:

```text
total_funded = available + reserved + spent + withdrawn + withdrawal_pending
```

`reserved` includes `Reserved`, `PayoutPending` and any operation whose payout has
not yet been finalized. `spent` only increases from a successful private payout
callback. `available` only receives owner funding, cancelled/expired reservations
and failed payout/withdrawal returns.

The contract checks `task.invariant_holds()` after every state-changing accounting
step and refuses to commit a broken projection. Arithmetic is `u128` with
`checked_add`/`checked_sub`; there is no floating point.

`get_budget` exposes `invariant_holds` and `accounted_total`. `check_invariant`
returns the same boolean for a task.

**Tests:** `owner_creates_and_funds_a_task`,
`conservation_invariant_holds_after_a_mixed_operation_sequence`,
`funding_overflow_is_checked`, `cross_task_accounting_is_isolated`,
`padding_and_storage_are_not_counted_as_task_money`.

## 2. Storage and operational money are separate

- `create_task`, `register_agent` (first registration) and `withdraw_available`
  require fixed attached deposits (`TASK_STORAGE_DEPOSIT_YOCTO`,
  `AGENT_STORAGE_DEPOSIT_YOCTO`, `WITHDRAWAL_STORAGE_DEPOSIT_YOCTO`).
- Those deposits are **not** added to `total_funded` or any task bucket. They pay
  for contract state and are non-refundable in this MVP. Any amount attached above
  the required deposit is returned to the caller in the same call; re-registering an
  existing agent needs no new storage and refunds its whole deposit.
- A worker cannot attach a deposit to `reserve` or `execute`, so it cannot make the
  owner pay for unbounded operations. `MAX_OPERATIONS_PER_TASK` (32) bounds the
  records the owner pre-paid for at task creation, and `MAX_OPERATIONS_PER_AGENT`
  (16) splits that bound so one compromised worker key cannot use up every slot
  and lock the other agents out. An idempotent `reserve` replay consumes no slot.
- The contract account's own NEAR balance is not task money. There is currently no
  separate "operational reserve" bucket; storage deposits and the deployer's
  account balance are outside task accounting.

**Tests:** `task_creation_requires_a_storage_deposit`,
`withdrawal_requires_its_storage_deposit`,
`bounded_operation_records_stop_unpaid_storage_growth`,
`bounded_state_fits_inside_the_owner_paid_storage_deposit`,
`padding_and_storage_are_not_counted_as_task_money`.

## 3. Reserving never overdraws the shared budget

A reservation succeeds only if:

- the task exists, is not paused and is not past `expires_at_block`;
- the caller is `predecessor_account_id`;
- the caller is an active registered agent;
- `signer_account_pk` equals the agent's registered public key;
- `request.agent_id` equals the caller;
- the policy version equals the current task policy version;
- the amount is positive and at most `max_per_operation`;
- the provider is on the allowlist;
- the operation expiry is in the future;
- the task has room under `MAX_OPERATIONS_PER_TASK` and the calling agent has room
  under `MAX_OPERATIONS_PER_AGENT` (`AGENT_OPERATION_LIMIT_REACHED`);
- `available >= amount`.

The amount moves atomically from `available` to `reserved`. Two transactions in
the same or different blocks cannot both consume the same available balance;
NEAR serializes contract execution, and the second sees the updated state.

**Tests:** `two_workers_race_for_insufficient_shared_budget`,
`per_operation_cap_is_enforced`, `exact_boundary_amounts_are_allowed`,
`unauthorized_provider_is_rejected`, `unregistered_agent_is_rejected`,
`revoked_agent_cannot_reserve`, `agent_cannot_reserve_for_another_agent`,
`wrong_worker_key_is_rejected`, `stale_policy_version_is_rejected_at_reservation`,
`expired_task_blocks_reservations`, `paused_task_blocks_new_reservations`.

## 4. One logical operation, one payout

- An operation id is a 32-byte lowercase hex string binding task, agent, provider,
  amount, service id, request hash, output schema hash, policy version and expiry.
- Reusing an id with the same binding is idempotent while the state is `Reserved`,
  `PayoutPending` or `Paid`.
- Reusing an id with different parameters panics with `OPERATION_ID_CONFLICT`.
- Reusing an id in a terminal state panics with `OPERATION_TERMINAL`.
- `execute` transitions `Reserved -> PayoutPending` and writes that state **before**
  creating the transfer promise. A second `execute` for `PayoutPending` or `Paid`
  returns the existing operation without creating another transfer.
- `payout_attempts` increments once per successful dispatch to `PayoutPending`; it
  is not incremented by repeated `execute` calls.
- A `PayoutFailed` or `Expired` operation cannot be repaid. A new logical purchase
  needs a new operation id.

**Tests:** `execute_dispatches_exactly_one_transfer_to_the_provider`,
`repeated_execution_cannot_pay_twice`,
`replayed_reserve_is_idempotent_and_changed_arguments_are_rejected`,
`failed_payout_cannot_be_repaid_without_a_new_logical_operation`,
`lost_client_response_does_not_create_a_new_payment`.

## 5. A timeout is never failure

`PayoutPending` has no owner or worker escape hatch. Only the private transfer
callback can move it to `Paid` or `PayoutFailed`. A timeout, dropped RPC response
or worker restart leaves the operation pending and reserved. Recovery re-reads the
original operation id and transaction hash; it must not dispatch again or reassign
the funds.

`expire_reservation` only touches `Reserved` operations whose
`reservation_expires_at_block` has passed. It cannot touch `PayoutPending`, `Paid`,
`Cancelled` or `PayoutFailed`. It is permissionless specifically because it is
safe under that guard.

**Tests:** `expiry_cannot_touch_a_payout_pending_operation`,
`execution_after_reservation_expiry_is_rejected`,
`expired_reservation_is_released_permissionlessly_and_only_once`,
`permissionless_expiry_cannot_cancel_a_live_reservation`,
`lost_client_response_does_not_create_a_new_payment`.

## 6. Callbacks are private and idempotent

Both payout and withdrawal callbacks are annotated `#[private]` and re-check
`predecessor_account_id == current_account_id` inside the body. An external account
cannot forge either callback.

For a payout callback:

- only `PayoutPending` is processed; every other state returns `"ignored"`;
- `promise_results_count` must be exactly one;
- `reserved` is decremented exactly once;
- success moves the amount to `spent` and sets `Paid`;
- failure moves it to `available` and sets `PayoutFailed`;
- a late or duplicate callback is ignored and cannot move funds twice.

For a withdrawal callback, the pending withdrawal is found by id, decremented from
`withdrawal_pending` exactly once, and either added to `withdrawn` or returned to
`available`.

**Tests:** `duplicate_and_late_callbacks_are_idempotent`,
`external_account_cannot_forge_a_payout_callback`,
`failed_transfer_releases_the_reservation_exactly_once`,
`failed_withdrawal_returns_funds_once`,
`owner_withdraws_available_funds_after_successful_transfer`.

## 7. Withdrawals cannot touch reserved money

`withdraw_available`:

- requires the task owner and direct signer;
- requires a positive amount;
- requires the withdrawal storage deposit;
- limits pending withdrawals to `MAX_PENDING_WITHDRAWALS` (3);
- requires `amount <= available`;
- moves `available -> withdrawal_pending` immediately.

Reserved funds, including `PayoutPending`, are not available. A failed withdrawal
returns the exact amount to `available`; a successful one moves it to `withdrawn`.
A task owner cannot withdraw another task's funds.

**Tests:** `reserved_funds_cannot_be_withdrawn`,
`other_task_owner_cannot_withdraw_this_task`,
`failed_withdrawal_returns_funds_once`,
`owner_withdraws_available_funds_after_successful_transfer`,
`cross_task_accounting_is_isolated`.

## 8. Policy versioning and pausing

`update_policy` increments `policy_version`. A reservation made under an older
version cannot execute (`POLICY_VERSION_STALE`) and may be cancelled by the
reserving agent or the owner, or expired permissionlessly after its deadline. This
is the deliberate MVP answer to policy changes: do not rewrite existing
reservations, and never silently execute them under new terms.

`pause_task` blocks new reservations and execution of existing reservations.
`resume_task` restores execution if the reservation has not expired. Revocation
blocks future reservations/execution; it does not reverse an already-dispatched
transfer.

Provider allowlist changes apply to future reservations. An existing operation
whose provider is no longer allowlisted fails the execute-time re-check.

**Tests:** `policy_update_invalidates_existing_reservation_and_allows_safe_cancel`,
`owner_may_cancel_a_stale_reservation`,
`paused_task_blocks_execution_of_an_existing_reservation`,
`resume_restores_reservation_and_execution`,
`provider_allowlist_update_applies_to_future_reservations`,
`task_owner_controls_pause_and_revocation_but_not_other_tasks`,
`dispatched_payout_cannot_be_cancelled`.

## 9. Bounded state

| Limit | Value |
| --- | --- |
| Agents per task | 6 |
| Providers per policy | 8 |
| Operations per task | 32 |
| Pending withdrawals per task | 3 |
| Reservation TTL | 1..100,000 blocks |
| Task id / service id / name | 48 / 64 / 80 bytes |

The operation cap is the storage-growth guard for the owner-paid deposit. The
contract rejects the 33rd operation with `OPERATION_LIMIT_REACHED`. Agent and
provider lists are likewise bounded and validated (no duplicates, valid account
ids, no empty provider list).

**Tests:** `agent_limit_is_bounded`,
`bounded_operation_records_stop_unpaid_storage_growth`,
`bounded_state_fits_inside_the_owner_paid_storage_deposit`,
`task_id_and_policy_validation_rejects_bad_input`.

## 10. Authorization separation

| Action | Authorized caller |
| --- | --- |
| `create_task` | any account; caller becomes task owner |
| `fund_task`, `update_policy`, `register_agent`, `revoke_agent`, `pause_task`, `resume_task`, `withdraw_available` | task owner, direct signer |
| `reserve`, `execute` | active registered agent, direct signer, registered key |
| `cancel_reservation` | reserving agent or task owner; owner must be direct signer |
| `expire_reservation` | permissionless, guarded by state and deadline |
| `on_payout_complete`, `on_withdrawal_complete` | contract itself only |

Worker credentials cannot invoke owner administration. A worker cannot reserve or
execute for another agent. Cross-contract relay is rejected because signer and
predecessor must match.

**Tests:** `worker_credentials_cannot_invoke_owner_administration`,
`non_owner_cannot_fund_task`, `agent_cannot_execute_another_agents_operation`,
`cancellation_releases_only_the_reserving_agents_operation`,
`task_owner_controls_pause_and_revocation_but_not_other_tasks`,
`external_account_cannot_forge_a_payout_callback`.

## 11. Events are evidence, not authority

The contract emits `EVENT_JSON` records (`task_created`, `task_funded`,
`operation_reserved`, `payment_dispatched`, `payment_settled`,
`reservation_cancelled`, `reservation_expired`, `withdrawal_dispatched`,
`withdrawal_settled`, etc.). Indexers/backends may use them for display, but
recovery and the provider read **contract views**, not event payloads, before
settling or delivering.

## Test inventory

`cargo test --manifest-path contracts/poolguard/Cargo.toml` runs 56 tests against
near-sdk's mocked chain with explicit promise results:

- Creation/funding: `owner_creates_and_funds_a_task`,
  `owner_registers_two_agents_and_an_allowlisted_provider`,
  `task_creation_requires_a_storage_deposit`, `funding_overflow_is_checked`,
  `task_id_and_policy_validation_rejects_bad_input`, `agent_limit_is_bounded`.
- Race/budget: `two_workers_race_for_insufficient_shared_budget`,
  `per_operation_cap_is_enforced`, `exact_boundary_amounts_are_allowed`.
- Payout/replay: `execute_dispatches_exactly_one_transfer_to_the_provider`,
  `repeated_execution_cannot_pay_twice`,
  `failed_transfer_releases_the_reservation_exactly_once`,
  `lost_client_response_does_not_create_a_new_payment`,
  `replayed_reserve_is_idempotent_and_changed_arguments_are_rejected`,
  `failed_payout_cannot_be_repaid_without_a_new_logical_operation`.
- Callback safety: `duplicate_and_late_callbacks_are_idempotent`,
  `external_account_cannot_forge_a_payout_callback`,
  `expiry_cannot_touch_a_payout_pending_operation`.
- Expiry/cancel: `expired_reservation_is_released_permissionlessly_and_only_once`,
  `permissionless_expiry_cannot_cancel_a_live_reservation`,
  `execution_after_reservation_expiry_is_rejected`,
  `owner_may_cancel_a_stale_reservation`,
  `cancellation_releases_only_the_reserving_agents_operation`,
  `dispatched_payout_cannot_be_cancelled`.
- Policy/pause: `paused_task_blocks_new_reservations`,
  `paused_task_blocks_execution_of_an_existing_reservation`,
  `resume_restores_reservation_and_execution`,
  `stale_policy_version_is_rejected_at_reservation`,
  `policy_update_invalidates_existing_reservation_and_allows_safe_cancel`,
  `provider_allowlist_update_applies_to_future_reservations`.
- Authority: `unregistered_agent_is_rejected`, `revoked_agent_cannot_reserve`,
  `wrong_worker_key_is_rejected`, `agent_cannot_reserve_for_another_agent`,
  `agent_cannot_execute_another_agents_operation`,
  `worker_credentials_cannot_invoke_owner_administration`,
  `non_owner_cannot_fund_task`, `other_task_owner_cannot_withdraw_this_task`,
  `task_owner_controls_pause_and_revocation_but_not_other_tasks`,
  `unauthorized_provider_is_rejected`.
- Withdrawals: `owner_withdraws_available_funds_after_successful_transfer`,
  `failed_withdrawal_returns_funds_once`, `reserved_funds_cannot_be_withdrawn`,
  `withdrawal_requires_its_storage_deposit`.
- Bounds/conservation: `bounded_operation_records_stop_unpaid_storage_growth`,
  `bounded_state_fits_inside_the_owner_paid_storage_deposit`,
  `padding_and_storage_are_not_counted_as_task_money`,
  `cross_task_accounting_is_isolated`,
  `conservation_invariant_holds_after_a_mixed_operation_sequence`.

The separate sandbox proof (`node scripts/sandbox-test.mjs`) repeats the money
boundaries against a real `near-sandbox` node with real restricted keys and native
token balances; unit tests alone cannot prove runtime transfer success/failure.
