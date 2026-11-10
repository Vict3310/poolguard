//! Data types for the PoolGuard contract.
//!
//! Financial values are always integer yoctoNEAR (`u128`). JSON views serialize them
//! through `U128`, which becomes a decimal string so JavaScript never touches a float.

use near_sdk::json_types::U128;
use near_sdk::{near, AccountId, PublicKey};

/// Maximum length of a caller-supplied task id.
pub const MAX_TASK_ID_LEN: usize = 48;
/// Maximum length of a task display name stored on chain.
pub const MAX_NAME_LEN: usize = 80;
/// Maximum length of a service identifier bound into an operation.
pub const MAX_SERVICE_ID_LEN: usize = 64;
/// Maximum number of allowed providers per task policy.
pub const MAX_PROVIDERS: usize = 8;
/// Maximum number of registered agents per task.
pub const MAX_AGENTS: usize = 6;
/// Bounded operation records per task. This is the storage-growth guard: workers
/// cannot attach deposits, so the owner pre-pays for this many records at creation.
pub const MAX_OPERATIONS_PER_TASK: u32 = 32;
/// Operation records any single agent may create on a task. Splits the task bound so
/// one compromised or buggy worker key cannot use up every slot (for example with
/// tiny reserve-and-cancel loops) and lock the other agents out of the task.
pub const MAX_OPERATIONS_PER_AGENT: u32 = 16;
/// Maximum number of simultaneously pending withdrawals per task.
pub const MAX_PENDING_WITHDRAWALS: usize = 3;
/// Upper bound for a reservation lifetime, in blocks.
pub const MAX_RESERVATION_TTL_BLOCKS: u64 = 100_000;

/// Fixed storage deposit required to create a task. Non-refundable in this MVP;
/// it pays for the task record, its bounded operation records, and future writes.
pub const TASK_STORAGE_DEPOSIT_YOCTO: u128 = 350_000_000_000_000_000_000_000; // 0.35 NEAR
/// Fixed storage deposit required per agent registration.
pub const AGENT_STORAGE_DEPOSIT_YOCTO: u128 = 20_000_000_000_000_000_000_000; // 0.02 NEAR
/// Fixed storage deposit required to start a withdrawal. Covers its pending record.
pub const WITHDRAWAL_STORAGE_DEPOSIT_YOCTO: u128 = 20_000_000_000_000_000_000_000; // 0.02 NEAR

/// On-chain payment state. Fulfillment is tracked off chain by the provider and API;
/// the contract makes no claim about whether a useful result was delivered.
#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PaymentState {
    Reserved,
    PayoutPending,
    Paid,
    PayoutFailed,
    Cancelled,
    Expired,
}

impl PaymentState {
    pub fn as_str(self) -> &'static str {
        match self {
            PaymentState::Reserved => "reserved",
            PaymentState::PayoutPending => "payout_pending",
            PaymentState::Paid => "paid",
            PaymentState::PayoutFailed => "payout_failed",
            PaymentState::Cancelled => "cancelled",
            PaymentState::Expired => "expired",
        }
    }
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Agent {
    pub account_id: AccountId,
    pub public_key: PublicKey,
    pub active: bool,
    pub registered_at_block: u64,
    /// Operation records this agent has created on the task (never decremented).
    pub operation_count: u32,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct TaskPolicy {
    /// Maximum amount for any single operation, in yoctoNEAR.
    pub max_per_operation: u128,
    /// Provider accounts this task may pay.
    pub allowed_providers: Vec<AccountId>,
    /// Reservation lifetime in blocks, counted from reservation.
    pub reservation_ttl_blocks: u64,
    /// Task expiry as a block height.
    pub expires_at_block: u64,
    /// Incremented on every policy update. Reservations from an older version
    /// cannot execute and may be cancelled safely.
    pub policy_version: u32,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct PendingWithdrawal {
    pub id: u64,
    pub amount: u128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Task {
    pub task_id: String,
    pub owner: AccountId,
    pub name: String,
    pub created_at_block: u64,
    pub paused: bool,
    pub policy: TaskPolicy,
    pub total_funded: u128,
    pub available: u128,
    pub reserved: u128,
    pub spent: u128,
    pub withdrawn: u128,
    pub withdrawal_pending: u128,
    pub agents: Vec<Agent>,
    pub operation_ids: Vec<String>,
    pub pending_withdrawals: Vec<PendingWithdrawal>,
    pub next_withdrawal_id: u64,
}

impl Task {
    /// Conservation invariant: every unit of funding is in exactly one bucket.
    pub fn accounted_total(&self) -> Option<u128> {
        self.available
            .checked_add(self.reserved)?
            .checked_add(self.spent)?
            .checked_add(self.withdrawn)?
            .checked_add(self.withdrawal_pending)
    }

    pub fn invariant_holds(&self) -> bool {
        self.accounted_total() == Some(self.total_funded)
    }

    pub fn is_expired(&self, block_height: u64) -> bool {
        block_height > self.policy.expires_at_block
    }

    pub fn agent(&self, account_id: &AccountId) -> Option<&Agent> {
        self.agents.iter().find(|a| &a.account_id == account_id)
    }

    pub fn provider_allowed(&self, provider: &AccountId) -> bool {
        self.policy.allowed_providers.iter().any(|p| p == provider)
    }
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Operation {
    pub operation_id: String,
    pub task_id: String,
    pub agent_id: AccountId,
    pub agent_public_key: PublicKey,
    pub provider_id: AccountId,
    pub amount: u128,
    pub service_id: String,
    pub request_hash: String,
    pub output_schema_hash: String,
    pub policy_version: u32,
    pub created_at_block: u64,
    pub expires_at_block: u64,
    pub reservation_expires_at_block: u64,
    pub payment_state: PaymentState,
    pub payout_attempts: u32,
    pub settled_at_block: Option<u64>,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct OperationKey {
    pub task_id: String,
    pub operation_id: String,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct PolicyInput {
    pub max_per_operation: U128,
    pub allowed_providers: Vec<AccountId>,
    pub reservation_ttl_blocks: u64,
    pub expires_at_block: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct ReserveRequest {
    pub task_id: String,
    pub operation_id: String,
    pub agent_id: AccountId,
    pub provider_id: AccountId,
    pub amount: U128,
    pub service_id: String,
    pub request_hash: String,
    pub output_schema_hash: String,
    pub policy_version: u32,
    pub expires_at_block: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct AgentView {
    pub account_id: AccountId,
    pub public_key: PublicKey,
    pub active: bool,
    pub registered_at_block: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct PolicyView {
    pub max_per_operation: U128,
    pub allowed_providers: Vec<AccountId>,
    pub reservation_ttl_blocks: u64,
    pub expires_at_block: u64,
    pub policy_version: u32,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct TaskView {
    pub task_id: String,
    pub owner: AccountId,
    pub name: String,
    pub created_at_block: u64,
    pub paused: bool,
    pub policy: PolicyView,
    pub agents: Vec<AgentView>,
    pub total_funded: U128,
    pub available: U128,
    pub reserved: U128,
    pub spent: U128,
    pub withdrawn: U128,
    pub withdrawal_pending: U128,
    pub operation_count: u32,
    pub max_operations: u32,
    pub pending_withdrawals: u32,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct BudgetView {
    pub task_id: String,
    pub total_funded: U128,
    pub available: U128,
    pub reserved: U128,
    pub spent: U128,
    pub withdrawn: U128,
    pub withdrawal_pending: U128,
    pub max_per_operation: U128,
    pub policy_version: u32,
    pub invariant_holds: bool,
    pub accounted_total: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct OperationView {
    pub operation_id: String,
    pub task_id: String,
    pub agent_id: AccountId,
    pub agent_public_key: PublicKey,
    pub provider_id: AccountId,
    pub amount: U128,
    pub service_id: String,
    pub request_hash: String,
    pub output_schema_hash: String,
    pub policy_version: u32,
    pub created_at_block: u64,
    pub expires_at_block: u64,
    pub reservation_expires_at_block: u64,
    pub payment_state: String,
    pub payout_attempts: u32,
    pub settled_at_block: Option<u64>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct WithdrawalView {
    pub task_id: String,
    pub withdrawal_id: u64,
    pub amount: U128,
    pub owner: AccountId,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct PendingWithdrawalView {
    pub withdrawal_id: u64,
    pub amount: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct ConfigView {
    pub contract_id: AccountId,
    pub owner: AccountId,
    pub max_agents: u32,
    pub max_providers: u32,
    pub max_operations_per_task: u32,
    pub max_operations_per_agent: u32,
    pub max_pending_withdrawals: u32,
    pub task_storage_deposit: U128,
    pub agent_storage_deposit: U128,
    pub withdrawal_storage_deposit: U128,
}

impl From<Task> for TaskView {
    fn from(t: Task) -> Self {
        TaskView {
            policy: PolicyView {
                max_per_operation: U128(t.policy.max_per_operation),
                allowed_providers: t.policy.allowed_providers.clone(),
                reservation_ttl_blocks: t.policy.reservation_ttl_blocks,
                expires_at_block: t.policy.expires_at_block,
                policy_version: t.policy.policy_version,
            },
            agents: t
                .agents
                .iter()
                .map(|a| AgentView {
                    account_id: a.account_id.clone(),
                    public_key: a.public_key.clone(),
                    active: a.active,
                    registered_at_block: a.registered_at_block,
                })
                .collect(),
            operation_count: t.operation_ids.len() as u32,
            max_operations: MAX_OPERATIONS_PER_TASK,
            pending_withdrawals: t.pending_withdrawals.len() as u32,
            task_id: t.task_id,
            owner: t.owner,
            name: t.name,
            created_at_block: t.created_at_block,
            paused: t.paused,
            total_funded: U128(t.total_funded),
            available: U128(t.available),
            reserved: U128(t.reserved),
            spent: U128(t.spent),
            withdrawn: U128(t.withdrawn),
            withdrawal_pending: U128(t.withdrawal_pending),
        }
    }
}

impl From<Operation> for OperationView {
    fn from(o: Operation) -> Self {
        OperationView {
            operation_id: o.operation_id,
            task_id: o.task_id,
            agent_id: o.agent_id,
            agent_public_key: o.agent_public_key,
            provider_id: o.provider_id,
            amount: U128(o.amount),
            service_id: o.service_id,
            request_hash: o.request_hash,
            output_schema_hash: o.output_schema_hash,
            policy_version: o.policy_version,
            created_at_block: o.created_at_block,
            expires_at_block: o.expires_at_block,
            reservation_expires_at_block: o.reservation_expires_at_block,
            payment_state: o.payment_state.as_str().to_string(),
            payout_attempts: o.payout_attempts,
            settled_at_block: o.settled_at_block,
        }
    }
}

impl From<&TaskPolicy> for PolicyView {
    fn from(p: &TaskPolicy) -> Self {
        PolicyView {
            max_per_operation: U128(p.max_per_operation),
            allowed_providers: p.allowed_providers.clone(),
            reservation_ttl_blocks: p.reservation_ttl_blocks,
            expires_at_block: p.expires_at_block,
            policy_version: p.policy_version,
        }
    }
}
