//! PoolGuard: one task budget, multiple agents, enforced on NEAR.
//!
//! The contract is the authority for financial state. An owner creates a task and
//! funds a flat shared budget; registered agent accounts (with registered signing
//! keys) may reserve against that budget, and execution dispatches exactly one
//! payout per operation to an allowlisted provider.
//!
//! Design notes that matter for safety:
//! - Worker accounts sign with function-call keys. Function-call key allowances cap
//!   gas spend, not business spend. All spending policy lives here.
//! - `reserve` and `execute` are idempotent for the same operation id: a retried
//!   transport call returns the existing operation and never dispatches a second
//!   payout.
//! - Payout dispatch moves `amount` from `available` to `reserved` once. Only the
//!   private, idempotent transfer callback can settle it into `spent` or release it.
//! - Reservations expire only while still `Reserved`, before dispatch.
//! - A timeout is never treated as failure: `PayoutPending` can only be resolved by
//!   the callback. There is deliberately no owner escape hatch.

use borsh::BorshSerialize;
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
    PromiseError, PublicKey,
};

mod types;
pub use types::*;

#[cfg(test)]
mod tests;

const EVENT_VERSION: &str = "1.0.0";
const CALLBACK_GAS_TGAS: u64 = 25;

#[derive(BorshStorageKey, BorshSerialize)]
enum StorageKey {
    Tasks,
    TaskIds,
    Operations,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct PoolGuard {
    /// Deployer account. Has no power over task funds; task owners control their tasks.
    pub owner: AccountId,
    pub tasks: LookupMap<String, Task>,
    pub task_ids: Vector<String>,
    pub operations: LookupMap<OperationKey, Operation>,
}

fn emit(event: &str, data: serde_json::Value) {
    let payload = json!({
        "standard": "poolguard",
        "version": EVENT_VERSION,
        "event": event,
        "data": data,
    });
    env::log_str(&format!("EVENT_JSON:{payload}"));
}

fn valid_slug(value: &str, max_len: usize) -> bool {
    !value.is_empty()
        && value.len() <= max_len
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}

fn valid_service_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_SERVICE_ID_LEN
        && value.bytes().all(|b| {
            b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.' || b == b':'
        })
}

fn valid_hex32(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Returns any deposit above `required` to the caller, so an over-attached deposit is
/// never silently kept by the contract.
fn refund_excess_deposit(required: u128) {
    let attached = env::attached_deposit().as_yoctonear();
    if let Some(excess) = attached.checked_sub(required).filter(|excess| *excess > 0) {
        let _ = Promise::new(env::predecessor_account_id())
            .transfer(NearToken::from_yoctonear(excess));
    }
}

fn require_signer_is_predecessor() {
    require!(
        env::signer_account_id() == env::predecessor_account_id(),
        "SIGNER_PREDECESSOR_MISMATCH"
    );
}

/// Defense in depth for `#[private]` callbacks: the generated wrapper already gates
/// on predecessor == current account, and this body check keeps the contract safe even
/// if the method is ever invoked from internal code or a refactor drops the attribute.
fn require_private_callback() {
    require!(
        env::predecessor_account_id() == env::current_account_id(),
        "CALLBACK_NOT_PRIVATE"
    );
}

fn validate_policy_input(policy: &PolicyInput) -> u128 {
    let max_per_operation = policy.max_per_operation.0;
    require!(max_per_operation > 0, "POLICY_CAP_MUST_BE_POSITIVE");
    require!(
        policy.allowed_providers.len() <= MAX_PROVIDERS,
        "POLICY_TOO_MANY_PROVIDERS"
    );
    for (i, provider) in policy.allowed_providers.iter().enumerate() {
        require!(
            !policy.allowed_providers[..i].contains(provider),
            "POLICY_DUPLICATE_PROVIDER"
        );
    }
    require!(
        policy.reservation_ttl_blocks > 0
            && policy.reservation_ttl_blocks <= MAX_RESERVATION_TTL_BLOCKS,
        "POLICY_INVALID_RESERVATION_TTL"
    );
    require!(
        policy.expires_at_block > env::block_height(),
        "POLICY_EXPIRY_IN_PAST"
    );
    max_per_operation
}

#[near]
impl PoolGuard {
    #[init]
    pub fn new() -> Self {
        require!(!env::state_exists(), "ALREADY_INITIALIZED");
        Self {
            owner: env::predecessor_account_id(),
            tasks: LookupMap::new(StorageKey::Tasks),
            task_ids: Vector::new(StorageKey::TaskIds),
            operations: LookupMap::new(StorageKey::Operations),
        }
    }

    // ---------------------------------------------------------------- owner actions

    /// Create a task owned by the caller. The attached deposit pays storage only;
    /// fund the budget separately with `fund_task` so the two amounts never blur.
    #[payable]
    pub fn create_task(&mut self, task_id: String, name: String, policy: PolicyInput) -> TaskView {
        require_signer_is_predecessor();
        require!(
            env::attached_deposit().as_yoctonear() >= TASK_STORAGE_DEPOSIT_YOCTO,
            "TASK_STORAGE_DEPOSIT_REQUIRED"
        );
        require!(valid_slug(&task_id, MAX_TASK_ID_LEN), "TASK_ID_INVALID");
        require!(!name.trim().is_empty(), "TASK_NAME_REQUIRED");
        require!(name.len() <= MAX_NAME_LEN, "TASK_NAME_TOO_LONG");
        require!(!self.tasks.contains_key(&task_id), "TASK_ALREADY_EXISTS");
        let max_per_operation = validate_policy_input(&policy);
        let now = env::block_height();
        let owner = env::predecessor_account_id();

        let task = Task {
            task_id: task_id.clone(),
            owner: owner.clone(),
            name: name.clone(),
            created_at_block: now,
            paused: false,
            policy: TaskPolicy {
                max_per_operation,
                allowed_providers: policy.allowed_providers,
                reservation_ttl_blocks: policy.reservation_ttl_blocks,
                expires_at_block: policy.expires_at_block,
                policy_version: 1,
            },
            total_funded: 0,
            available: 0,
            reserved: 0,
            spent: 0,
            withdrawn: 0,
            withdrawal_pending: 0,
            agents: Vec::new(),
            operation_ids: Vec::new(),
            pending_withdrawals: Vec::new(),
            next_withdrawal_id: 0,
        };

        self.tasks.insert(task_id.clone(), task.clone());
        self.task_ids.push(task_id.clone());
        refund_excess_deposit(TASK_STORAGE_DEPOSIT_YOCTO);
        emit(
            "task_created",
            json!({
                "task_id": task_id,
                "owner": owner,
                "name": name,
                "policy_version": 1,
                "max_per_operation": U128(max_per_operation),
                "allowed_providers": task.policy.allowed_providers,
                "expires_at_block": task.policy.expires_at_block,
            }),
        );
        TaskView::from(task)
    }

    /// Add funds to a task's spendable budget. Task owner only.
    #[payable]
    pub fn fund_task(&mut self, task_id: String) -> TaskView {
        require_signer_is_predecessor();
        let deposit = env::attached_deposit().as_yoctonear();
        require!(deposit > 0, "FUNDING_MUST_BE_POSITIVE");
        let mut task = self.require_task(&task_id);
        require!(
            env::predecessor_account_id() == task.owner,
            "UNAUTHORIZED_OWNER"
        );

        task.total_funded = task
            .total_funded
            .checked_add(deposit)
            .expect("TOTAL_FUNDED_OVERFLOW");
        task.available = task
            .available
            .checked_add(deposit)
            .expect("AVAILABLE_OVERFLOW");
        require!(task.invariant_holds(), "ACCOUNTING_INVARIANT_BROKEN");

        let total = task.total_funded;
        self.tasks.insert(task_id.clone(), task.clone());
        emit(
            "task_funded",
            json!({ "task_id": task_id, "amount": U128(deposit), "total_funded": U128(total) }),
        );
        TaskView::from(task)
    }

    /// Replace the policy and bump its version. Existing reservations from the old
    /// version cannot execute; anyone may let them expire or the owner/agent may
    /// cancel them, which releases their funds.
    pub fn update_policy(&mut self, task_id: String, policy: PolicyInput) -> PolicyView {
        require_signer_is_predecessor();
        let mut task = self.require_task(&task_id);
        require!(
            env::predecessor_account_id() == task.owner,
            "UNAUTHORIZED_OWNER"
        );
        let max_per_operation = validate_policy_input(&policy);
        let next_version = task
            .policy
            .policy_version
            .checked_add(1)
            .expect("POLICY_VERSION_OVERFLOW");

        task.policy = TaskPolicy {
            max_per_operation,
            allowed_providers: policy.allowed_providers,
            reservation_ttl_blocks: policy.reservation_ttl_blocks,
            expires_at_block: policy.expires_at_block,
            policy_version: next_version,
        };
        let view = PolicyView::from(&task.policy);
        self.tasks.insert(task_id.clone(), task);
        emit(
            "policy_updated",
            json!({
                "task_id": task_id,
                "policy_version": next_version,
                "max_per_operation": U128(max_per_operation),
            }),
        );
        view
    }

    /// Register (or re-activate) an agent account and the signer key it must use.
    #[payable]
    pub fn register_agent(
        &mut self,
        task_id: String,
        account_id: AccountId,
        public_key: PublicKey,
    ) -> AgentView {
        require_signer_is_predecessor();
        let mut task = self.require_task(&task_id);
        require!(
            env::predecessor_account_id() == task.owner,
            "UNAUTHORIZED_OWNER"
        );

        let required_deposit;
        if let Some(index) = task.agents.iter().position(|a| a.account_id == account_id) {
            // Re-activation / key rotation: no new storage, no deposit required.
            task.agents[index].public_key = public_key.clone();
            task.agents[index].active = true;
            required_deposit = 0;
        } else {
            require!(
                task.agents.len() < MAX_AGENTS,
                "AGENT_LIMIT_REACHED"
            );
            require!(
                env::attached_deposit().as_yoctonear() >= AGENT_STORAGE_DEPOSIT_YOCTO,
                "AGENT_STORAGE_DEPOSIT_REQUIRED"
            );
            task.agents.push(Agent {
                account_id: account_id.clone(),
                public_key: public_key.clone(),
                active: true,
                registered_at_block: env::block_height(),
                operation_count: 0,
            });
            required_deposit = AGENT_STORAGE_DEPOSIT_YOCTO;
        }

        let view = AgentView {
            account_id: account_id.clone(),
            public_key: public_key.clone(),
            active: true,
            registered_at_block: env::block_height(),
        };
        self.tasks.insert(task_id.clone(), task);
        refund_excess_deposit(required_deposit);
        emit(
            "agent_registered",
            json!({ "task_id": task_id, "agent_id": account_id, "public_key": public_key }),
        );
        view
    }

    /// Revoke an agent. Blocks future reservations and executions. It does not and
    /// cannot reverse a transfer that was already dispatched.
    pub fn revoke_agent(&mut self, task_id: String, account_id: AccountId) -> AgentView {
        require_signer_is_predecessor();
        let mut task = self.require_task(&task_id);
        require!(
            env::predecessor_account_id() == task.owner,
            "UNAUTHORIZED_OWNER"
        );
        let index = task
            .agents
            .iter()
            .position(|a| a.account_id == account_id)
            .unwrap_or_else(|| env::panic_str("AGENT_NOT_REGISTERED"));
        task.agents[index].active = false;
        let view = AgentView {
            account_id: task.agents[index].account_id.clone(),
            public_key: task.agents[index].public_key.clone(),
            active: false,
            registered_at_block: task.agents[index].registered_at_block,
        };
        self.tasks.insert(task_id.clone(), task);
        emit(
            "agent_revoked",
            json!({ "task_id": task_id, "agent_id": account_id }),
        );
        view
    }

    pub fn pause_task(&mut self, task_id: String) -> TaskView {
        require_signer_is_predecessor();
        let mut task = self.require_task(&task_id);
        require!(
            env::predecessor_account_id() == task.owner,
            "UNAUTHORIZED_OWNER"
        );
        task.paused = true;
        self.tasks.insert(task_id.clone(), task.clone());
        emit("task_paused", json!({ "task_id": task_id }));
        TaskView::from(task)
    }

    pub fn resume_task(&mut self, task_id: String) -> TaskView {
        require_signer_is_predecessor();
        let mut task = self.require_task(&task_id);
        require!(
            env::predecessor_account_id() == task.owner,
            "UNAUTHORIZED_OWNER"
        );
        task.paused = false;
        self.tasks.insert(task_id.clone(), task.clone());
        emit("task_resumed", json!({ "task_id": task_id }));
        TaskView::from(task)
    }

    /// Withdraw unreserved funds to the task owner. Reserved funds (including
    /// payout-pending operations) are not withdrawable. The storage deposit is a
    /// separate, non-refundable operational charge and is never part of task money.
    #[payable]
    pub fn withdraw_available(&mut self, task_id: String, amount: U128) -> WithdrawalView {
        require_signer_is_predecessor();
        let mut task = self.require_task(&task_id);
        require!(
            env::predecessor_account_id() == task.owner,
            "UNAUTHORIZED_OWNER"
        );
        let amount = amount.0;
        require!(amount > 0, "WITHDRAWAL_MUST_BE_POSITIVE");
        require!(
            env::attached_deposit().as_yoctonear() >= WITHDRAWAL_STORAGE_DEPOSIT_YOCTO,
            "WITHDRAWAL_STORAGE_DEPOSIT_REQUIRED"
        );
        require!(
            task.pending_withdrawals.len() < MAX_PENDING_WITHDRAWALS,
            "TOO_MANY_PENDING_WITHDRAWALS"
        );
        require!(amount <= task.available, "INSUFFICIENT_AVAILABLE_FUNDS");

        let id = task.next_withdrawal_id;
        task.next_withdrawal_id = task
            .next_withdrawal_id
            .checked_add(1)
            .expect("WITHDRAWAL_ID_OVERFLOW");
        task.available = task
            .available
            .checked_sub(amount)
            .expect("AVAILABLE_UNDERFLOW");
        task.withdrawal_pending = task
            .withdrawal_pending
            .checked_add(amount)
            .expect("WITHDRAWAL_PENDING_OVERFLOW");
        task.pending_withdrawals
            .push(PendingWithdrawal { id, amount });
        require!(task.invariant_holds(), "ACCOUNTING_INVARIANT_BROKEN");

        let owner = task.owner.clone();
        self.tasks.insert(task_id.clone(), task);
        refund_excess_deposit(WITHDRAWAL_STORAGE_DEPOSIT_YOCTO);

        let args = serde_json::to_vec(&json!({
            "task_id": task_id,
            "withdrawal_id": id,
        }))
        .expect("CALLBACK_ARGS");
        let _ = Promise::new(owner.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .then(
                Promise::new(env::current_account_id()).function_call(
                    "on_withdrawal_complete".to_string(),
                    args,
                    NearToken::from_yoctonear(0),
                    Gas::from_tgas(CALLBACK_GAS_TGAS),
                ),
            );

        emit(
            "withdrawal_dispatched",
            json!({ "task_id": task_id, "withdrawal_id": id, "amount": U128(amount) }),
        );
        WithdrawalView {
            task_id,
            withdrawal_id: id,
            amount: U128(amount),
            owner,
        }
    }

    // --------------------------------------------------------------- worker actions

    /// Hold budget for one logical purchase. Idempotent for the same operation id.
    /// Denials are stable machine codes so callers can make a safe next choice.
    pub fn reserve(&mut self, request: ReserveRequest) -> OperationView {
        require!(request.amount.0 > 0, "AMOUNT_MUST_BE_POSITIVE");
        let mut task = self.require_task(&request.task_id);
        Self::assert_agent(&task);
        let caller = env::predecessor_account_id();
        require!(request.agent_id == caller, "AGENT_ID_MISMATCH");
        require!(!task.paused, "TASK_PAUSED");
        let now = env::block_height();
        require!(!task.is_expired(now), "TASK_EXPIRED");

        let key = OperationKey {
            task_id: request.task_id.clone(),
            operation_id: request.operation_id.clone(),
        };

        if let Some(existing) = self.operations.get(&key).cloned() {
            let same_binding = existing.agent_id == request.agent_id
                && existing.provider_id == request.provider_id
                && existing.amount == request.amount.0
                && existing.service_id == request.service_id
                && existing.request_hash == request.request_hash
                && existing.output_schema_hash == request.output_schema_hash
                && existing.policy_version == request.policy_version
                && existing.expires_at_block == request.expires_at_block;
            require!(same_binding, "OPERATION_ID_CONFLICT");
            match existing.payment_state {
                PaymentState::Reserved | PaymentState::PayoutPending | PaymentState::Paid => {
                    return OperationView::from(existing);
                }
                _ => env::panic_str("OPERATION_TERMINAL"),
            }
        }

        require!(valid_hex32(&request.operation_id), "OPERATION_ID_INVALID");
        require!(valid_hex32(&request.request_hash), "REQUEST_HASH_INVALID");
        require!(
            valid_hex32(&request.output_schema_hash),
            "OUTPUT_SCHEMA_HASH_INVALID"
        );
        require!(
            valid_service_id(&request.service_id),
            "SERVICE_ID_INVALID"
        );
        require!(
            request.policy_version == task.policy.policy_version,
            "POLICY_VERSION_STALE"
        );
        require!(
            request.amount.0 <= task.policy.max_per_operation,
            "PER_OPERATION_CAP_EXCEEDED"
        );
        require!(
            task.provider_allowed(&request.provider_id),
            "PROVIDER_NOT_ALLOWED"
        );
        require!(
            request.expires_at_block > now,
            "OPERATION_EXPIRY_INVALID"
        );
        require!(
            (task.operation_ids.len() as u32) < MAX_OPERATIONS_PER_TASK,
            "OPERATION_LIMIT_REACHED"
        );
        let agent_index = task
            .agents
            .iter()
            .position(|a| a.account_id == caller)
            .unwrap_or_else(|| env::panic_str("AGENT_NOT_REGISTERED"));
        require!(
            task.agents[agent_index].operation_count < MAX_OPERATIONS_PER_AGENT,
            "AGENT_OPERATION_LIMIT_REACHED"
        );
        require!(
            task.available >= request.amount.0,
            "INSUFFICIENT_AVAILABLE_BUDGET"
        );

        let reservation_expires_at_block = (now + task.policy.reservation_ttl_blocks)
            .min(request.expires_at_block)
            .min(task.policy.expires_at_block);

        task.available = task
            .available
            .checked_sub(request.amount.0)
            .expect("AVAILABLE_UNDERFLOW");
        task.reserved = task
            .reserved
            .checked_add(request.amount.0)
            .expect("RESERVED_OVERFLOW");
        require!(task.invariant_holds(), "ACCOUNTING_INVARIANT_BROKEN");

        let operation = Operation {
            operation_id: request.operation_id.clone(),
            task_id: request.task_id.clone(),
            agent_id: caller.clone(),
            agent_public_key: env::signer_account_pk(),
            provider_id: request.provider_id.clone(),
            amount: request.amount.0,
            service_id: request.service_id.clone(),
            request_hash: request.request_hash.clone(),
            output_schema_hash: request.output_schema_hash.clone(),
            policy_version: request.policy_version,
            created_at_block: now,
            expires_at_block: request.expires_at_block,
            reservation_expires_at_block,
            payment_state: PaymentState::Reserved,
            payout_attempts: 0,
            settled_at_block: None,
        };

        task.agents[agent_index].operation_count = task.agents[agent_index]
            .operation_count
            .checked_add(1)
            .expect("AGENT_OPERATION_COUNT_OVERFLOW");
        task.operation_ids.push(request.operation_id.clone());
        self.operations.insert(key, operation.clone());
        let operation_count = task.operation_ids.len();
        self.tasks.insert(request.task_id.clone(), task);

        emit(
            "operation_reserved",
            json!({
                "task_id": request.task_id,
                "operation_id": request.operation_id,
                "agent_id": caller,
                "provider_id": request.provider_id.clone(),
                "amount": U128(request.amount.0),
                "service_id": request.service_id.clone(),
                "request_hash": request.request_hash.clone(),
                "output_schema_hash": request.output_schema_hash.clone(),
                "policy_version": request.policy_version,
                "reservation_expires_at_block": reservation_expires_at_block,
                "operation_count": operation_count,
            }),
        );
        OperationView::from(operation)
    }

    /// Dispatch the payout. Idempotent: if the payout is already pending or paid,
    /// return the existing operation without creating another transfer. Exactly one
    /// transfer per operation is ever created.
    pub fn execute(&mut self, task_id: String, operation_id: String) -> OperationView {
        let mut task = self.require_task(&task_id);
        Self::assert_agent(&task);
        let caller = env::predecessor_account_id();
        let key = OperationKey {
            task_id: task_id.clone(),
            operation_id: operation_id.clone(),
        };
        let mut operation = self
            .operations
            .get(&key)
            .cloned()
            .unwrap_or_else(|| env::panic_str("OPERATION_NOT_FOUND"));
        require!(
            operation.agent_id == caller,
            "UNAUTHORIZED_AGENT_OPERATION"
        );

        match operation.payment_state {
            PaymentState::PayoutPending | PaymentState::Paid => {
                return OperationView::from(operation);
            }
            PaymentState::Reserved => {}
            _ => env::panic_str("OPERATION_NOT_PAYABLE"),
        }

        let now = env::block_height();
        require!(
            now <= operation.reservation_expires_at_block,
            "RESERVATION_EXPIRED"
        );
        require!(!task.paused, "TASK_PAUSED");
        require!(!task.is_expired(now), "TASK_EXPIRED");
        require!(
            operation.policy_version == task.policy.policy_version,
            "POLICY_VERSION_STALE"
        );
        require!(
            operation.amount <= task.policy.max_per_operation,
            "PER_OPERATION_CAP_EXCEEDED"
        );
        require!(
            task.provider_allowed(&operation.provider_id),
            "PROVIDER_NOT_ALLOWED"
        );

        operation.payment_state = PaymentState::PayoutPending;
        operation.payout_attempts = operation
            .payout_attempts
            .checked_add(1)
            .expect("PAYOUT_ATTEMPTS_OVERFLOW");
        operation.settled_at_block = None;
        self.operations.insert(key, operation.clone());

        let args = serde_json::to_vec(&json!({
            "task_id": task_id,
            "operation_id": operation_id,
        }))
        .expect("CALLBACK_ARGS");
        let _ = Promise::new(operation.provider_id.clone())
            .transfer(NearToken::from_yoctonear(operation.amount))
            .then(
                Promise::new(env::current_account_id()).function_call(
                    "on_payout_complete".to_string(),
                    args,
                    NearToken::from_yoctonear(0),
                    Gas::from_tgas(CALLBACK_GAS_TGAS),
                ),
            );

        emit(
            "payment_dispatched",
            json!({
                "task_id": task_id,
                "operation_id": operation_id,
                "provider_id": operation.provider_id.clone(),
                "amount": U128(operation.amount),
                "attempt": operation.payout_attempts,
            }),
        );
        OperationView::from(operation)
    }

    /// Cancel a reservation before payout dispatch. The reserving agent or the
    /// task owner may cancel. A pending or completed payout cannot be cancelled.
    pub fn cancel_reservation(
        &mut self,
        task_id: String,
        operation_id: String,
    ) -> OperationView {
        let mut task = self.require_task(&task_id);
        let caller = env::predecessor_account_id();
        let is_owner = caller == task.owner;
        if is_owner {
            require_signer_is_predecessor();
        } else {
            Self::assert_agent(&task);
        }

        let key = OperationKey {
            task_id: task_id.clone(),
            operation_id: operation_id.clone(),
        };
        let mut operation = self
            .operations
            .get(&key)
            .cloned()
            .unwrap_or_else(|| env::panic_str("OPERATION_NOT_FOUND"));
        if !is_owner {
            require!(
                operation.agent_id == caller,
                "UNAUTHORIZED_AGENT_OPERATION"
            );
        }
        require!(
            operation.payment_state == PaymentState::Reserved,
            "OPERATION_NOT_CANCELLABLE"
        );

        task.reserved = task
            .reserved
            .checked_sub(operation.amount)
            .expect("RESERVED_UNDERFLOW");
        task.available = task
            .available
            .checked_add(operation.amount)
            .expect("AVAILABLE_OVERFLOW");
        require!(task.invariant_holds(), "ACCOUNTING_INVARIANT_BROKEN");

        operation.payment_state = PaymentState::Cancelled;
        self.operations.insert(key, operation.clone());
        self.tasks.insert(task_id.clone(), task);

        emit(
            "reservation_cancelled",
            json!({
                "task_id": task_id,
                "operation_id": operation_id,
                "amount": U128(operation.amount),
                "cancelled_by": caller,
            }),
        );
        OperationView::from(operation)
    }

    /// Release an expired reservation. Permissionless and safe: it can only touch an
    /// operation that is still `Reserved` and past its reservation deadline. It can
    /// never cancel another worker's live reservation or a dispatched payout.
    pub fn expire_reservation(
        &mut self,
        task_id: String,
        operation_id: String,
    ) -> OperationView {
        let mut task = self.require_task(&task_id);
        let key = OperationKey {
            task_id: task_id.clone(),
            operation_id: operation_id.clone(),
        };
        let mut operation = self
            .operations
            .get(&key)
            .cloned()
            .unwrap_or_else(|| env::panic_str("OPERATION_NOT_FOUND"));
        require!(
            operation.payment_state == PaymentState::Reserved,
            "OPERATION_NOT_EXPIRABLE"
        );
        require!(
            env::block_height() > operation.reservation_expires_at_block,
            "RESERVATION_NOT_EXPIRED"
        );

        task.reserved = task
            .reserved
            .checked_sub(operation.amount)
            .expect("RESERVED_UNDERFLOW");
        task.available = task
            .available
            .checked_add(operation.amount)
            .expect("AVAILABLE_OVERFLOW");
        require!(task.invariant_holds(), "ACCOUNTING_INVARIANT_BROKEN");

        operation.payment_state = PaymentState::Expired;
        self.operations.insert(key, operation.clone());
        self.tasks.insert(task_id.clone(), task);

        emit(
            "reservation_expired",
            json!({
                "task_id": task_id,
                "operation_id": operation_id,
                "amount": U128(operation.amount),
            }),
        );
        OperationView::from(operation)
    }

    // --------------------------------------------------------------- private callbacks

    /// Transfer callback. Private: only the contract itself can resolve a payout.
    /// Idempotent: late or duplicate callbacks cannot move funds twice.
    #[private]
    pub fn on_payout_complete(&mut self, task_id: String, operation_id: String) -> String {
        require_private_callback();
        let mut task = match self.tasks.get(&task_id).cloned() {
            Some(task) => task,
            None => return "ignored".to_string(),
        };
        let key = OperationKey {
            task_id: task_id.clone(),
            operation_id: operation_id.clone(),
        };
        let mut operation = match self.operations.get(&key).cloned() {
            Some(operation) => operation,
            None => return "ignored".to_string(),
        };
        if operation.payment_state != PaymentState::PayoutPending {
            return "ignored".to_string();
        }
        if env::promise_results_count() != 1 {
            // Conservative: leave the operation pending rather than guess.
            return "ignored".to_string();
        }

        let amount = operation.amount;
        let provider_id = operation.provider_id.clone();
        let now = env::block_height();
        // A transfer promise resolves with an empty successful value; a failed
        // transfer resolves as an error. Bound the read at zero bytes to avoid gas
        // surprises from a promise this contract did not create.
        let succeeded = env::promise_result_checked(0, 0).is_ok();

        let Some(after_reserved) = task.reserved.checked_sub(amount) else {
            return "ignored".to_string();
        };
        if succeeded {
            let Some(after_spent) = task.spent.checked_add(amount) else {
                return "ignored".to_string();
            };
            task.spent = after_spent;
            operation.payment_state = PaymentState::Paid;
        } else {
            let Some(after_available) = task.available.checked_add(amount) else {
                return "ignored".to_string();
            };
            task.available = after_available;
            operation.payment_state = PaymentState::PayoutFailed;
        }
        task.reserved = after_reserved;
        operation.settled_at_block = Some(now);
        if !task.invariant_holds() {
            // Should be unreachable; do not commit an inconsistent projection.
            return "ignored".to_string();
        }
        self.tasks.insert(task_id.clone(), task);
        self.operations.insert(key, operation);

        let outcome = if succeeded { "settled" } else { "released" };
        emit(
            "payment_settled",
            json!({
                "task_id": task_id,
                "operation_id": operation_id,
                "provider_id": provider_id,
                "amount": U128(amount),
                "outcome": outcome,
            }),
        );
        outcome.to_string()
    }

    /// Withdrawal callback. Private and idempotent; a failed transfer returns the
    /// exact amount to available funds and clears the pending record.
    #[private]
    pub fn on_withdrawal_complete(&mut self, task_id: String, withdrawal_id: u64) -> String {
        require_private_callback();
        let mut task = match self.tasks.get(&task_id).cloned() {
            Some(task) => task,
            None => return "ignored".to_string(),
        };
        let Some(index) = task
            .pending_withdrawals
            .iter()
            .position(|w| w.id == withdrawal_id)
        else {
            return "ignored".to_string();
        };
        if env::promise_results_count() != 1 {
            return "ignored".to_string();
        }
        let amount = task.pending_withdrawals[index].amount;
        let succeeded = env::promise_result_checked(0, 0).is_ok();

        let Some(after_pending) = task.withdrawal_pending.checked_sub(amount) else {
            return "ignored".to_string();
        };
        if succeeded {
            let Some(after_withdrawn) = task.withdrawn.checked_add(amount) else {
                return "ignored".to_string();
            };
            task.withdrawn = after_withdrawn;
        } else {
            let Some(after_available) = task.available.checked_add(amount) else {
                return "ignored".to_string();
            };
            task.available = after_available;
        }
        task.withdrawal_pending = after_pending;
        task.pending_withdrawals.remove(index);
        if !task.invariant_holds() {
            return "ignored".to_string();
        }
        let owner = task.owner.clone();
        self.tasks.insert(task_id.clone(), task);

        let outcome = if succeeded { "settled" } else { "released" };
        emit(
            "withdrawal_settled",
            json!({
                "task_id": task_id,
                "withdrawal_id": withdrawal_id,
                "owner": owner,
                "amount": U128(amount),
                "outcome": outcome,
            }),
        );
        outcome.to_string()
    }

    // ----------------------------------------------------------------------- views

    pub fn get_task(&self, task_id: String) -> Option<TaskView> {
        self.tasks.get(&task_id).cloned().map(TaskView::from)
    }

    pub fn get_policy(&self, task_id: String) -> Option<PolicyView> {
        self.tasks
            .get(&task_id)
            .map(|t| PolicyView::from(&t.policy))
    }

    pub fn get_budget(&self, task_id: String) -> Option<BudgetView> {
        let task = self.tasks.get(&task_id)?;
        Some(BudgetView {
            task_id: task.task_id.clone(),
            total_funded: U128(task.total_funded),
            available: U128(task.available),
            reserved: U128(task.reserved),
            spent: U128(task.spent),
            withdrawn: U128(task.withdrawn),
            withdrawal_pending: U128(task.withdrawal_pending),
            max_per_operation: U128(task.policy.max_per_operation),
            policy_version: task.policy.policy_version,
            invariant_holds: task.invariant_holds(),
            accounted_total: U128(task.accounted_total().unwrap_or(0)),
        })
    }

    pub fn list_agents(&self, task_id: String) -> Vec<AgentView> {
        match self.tasks.get(&task_id) {
            Some(task) => task
                .agents
                .iter()
                .map(|a| AgentView {
                    account_id: a.account_id.clone(),
                    public_key: a.public_key.clone(),
                    active: a.active,
                    registered_at_block: a.registered_at_block,
                })
                .collect(),
            None => Vec::new(),
        }
    }

    pub fn get_operation(
        &self,
        task_id: String,
        operation_id: String,
    ) -> Option<OperationView> {
        self.operations
            .get(&OperationKey {
                task_id,
                operation_id,
            })
            .cloned()
            .map(OperationView::from)
    }

    pub fn list_operations(
        &self,
        task_id: String,
        from_index: Option<u32>,
        limit: Option<u32>,
    ) -> Vec<OperationView> {
        let Some(task) = self.tasks.get(&task_id) else {
            return Vec::new();
        };
        let from = from_index.unwrap_or(0) as usize;
        let limit = limit.unwrap_or(20).min(MAX_OPERATIONS_PER_TASK) as usize;
        task.operation_ids
            .iter()
            .skip(from)
            .take(limit)
            .filter_map(|operation_id| {
                self.operations
                    .get(&OperationKey {
                        task_id: task_id.clone(),
                        operation_id: operation_id.clone(),
                    })
                    .cloned()
                    .map(OperationView::from)
            })
            .collect()
    }

    pub fn list_pending_withdrawals(&self, task_id: String) -> Vec<PendingWithdrawalView> {
        match self.tasks.get(&task_id) {
            Some(task) => task
                .pending_withdrawals
                .iter()
                .map(|w| PendingWithdrawalView {
                    withdrawal_id: w.id,
                    amount: U128(w.amount),
                })
                .collect(),
            None => Vec::new(),
        }
    }

    pub fn check_invariant(&self, task_id: String) -> Option<bool> {
        self.tasks.get(&task_id).map(Task::invariant_holds)
    }

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            contract_id: env::current_account_id(),
            owner: self.owner.clone(),
            max_agents: MAX_AGENTS as u32,
            max_providers: MAX_PROVIDERS as u32,
            max_operations_per_task: MAX_OPERATIONS_PER_TASK,
            max_operations_per_agent: MAX_OPERATIONS_PER_AGENT,
            max_pending_withdrawals: MAX_PENDING_WITHDRAWALS as u32,
            task_storage_deposit: U128(TASK_STORAGE_DEPOSIT_YOCTO),
            agent_storage_deposit: U128(AGENT_STORAGE_DEPOSIT_YOCTO),
            withdrawal_storage_deposit: U128(WITHDRAWAL_STORAGE_DEPOSIT_YOCTO),
        }
    }

    // --------------------------------------------------------------------- helpers

    fn require_task(&self, task_id: &str) -> Task {
        self.tasks
            .get(task_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("TASK_NOT_FOUND"))
    }

    /// The caller must be the registered agent account, it must be the direct signer
    /// (no cross-contract relay), and it must use the registered signing key.
    fn assert_agent(task: &Task) {
        require_signer_is_predecessor();
        let caller = env::predecessor_account_id();
        let agent = task
            .agent(&caller)
            .unwrap_or_else(|| env::panic_str("AGENT_NOT_REGISTERED"));
        require!(agent.active, "AGENT_REVOKED");
        require!(
            env::signer_account_pk() == agent.public_key,
            "AGENT_KEY_MISMATCH"
        );
    }
}
