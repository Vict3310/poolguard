//! Contract unit tests.
//!
//! These tests run against near-sdk's mocked blockchain with real receipt inspection.
//! They prove the financial state machine, the authorization paths and the accounting
//! invariant. A separate `tests/sandbox.rs` suite exercises the same contract in a real
//! neard sandbox; unit tests cannot prove runtime transfer success/failure, so those
//! outcomes are supplied as explicit promise results here.

use crate::*;
use near_sdk::json_types::U128;
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{
    get_created_receipts, testing_env_with_promise_results, VMContextBuilder,
};
use near_sdk::{env, testing_env, AccountId, Gas, NearToken, PromiseResult, PublicKey};

const CONTRACT_ID: &str = "poolguard.testnet";
const TASK: &str = "supplier-review";
const YOCTO: u128 = 1_000_000_000_000_000_000_000_000;

fn acct(id: &str) -> AccountId {
    id.parse().unwrap()
}

fn key(id: &str) -> PublicKey {
    id.parse().unwrap()
}

fn near(amount: u128) -> u128 {
    amount * YOCTO
}

fn op_id(seed: u32) -> String {
    format!("{seed:064x}")
}

fn hash(seed: u32) -> String {
    format!("{:064x}", seed as u128 + 0xabc_0000_0000_0000)
}

fn ctx_for(account: &AccountId, pk: &PublicKey, deposit: u128, height: u64) -> near_sdk::VMContext {
    VMContextBuilder::new()
        .current_account_id(acct(CONTRACT_ID))
        .signer_account_id(account.clone())
        .predecessor_account_id(account.clone())
        .signer_account_pk(pk.clone())
        .block_height(height)
        .block_timestamp(1_700_000_000_000_000_000)
        .account_balance(NearToken::from_near(10_000))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .prepaid_gas(Gas::from_tgas(300))
        .build()
}

#[derive(Clone, Copy)]
enum Role {
    Owner,
    AgentOne,
    AgentTwo,
    Outsider,
    Contract,
}

struct Harness {
    contract: PoolGuard,
    owner: AccountId,
    owner_pk: PublicKey,
    agent_one: AccountId,
    agent_one_pk: PublicKey,
    agent_two: AccountId,
    agent_two_pk: PublicKey,
    provider: AccountId,
    provider_two: AccountId,
    outsider: AccountId,
    outsider_pk: PublicKey,
    height: u64,
}

impl Harness {
    fn new() -> Self {
        let owner = acct("owner.testnet");
        let owner_pk = key("ed25519:67dBRVNe4VDhnseDAbbbDgNVAs67Qe3Cs6edLyxBu9ze");
        let agent_one = acct("agent-one.testnet");
        let agent_one_pk = key("ed25519:EywNJiPHpUahwqbttWfg7k3H1CoLoZdcVdDmUhdFRJjf");
        let agent_two = acct("agent-two.testnet");
        let agent_two_pk = key("ed25519:Dif9Mw9cNahXZ5kAiCYDPoLqkD49hwNN9GHGBGNo3T3B");
        let outsider = acct("mallory.testnet");
        let outsider_pk = key("ed25519:2Dva297S2g9sKaa2T2zbPHHCr93qyEC7DkRRZ237Ydgf");

        testing_env!(ctx_for(
            &owner,
            &owner_pk,
            TASK_STORAGE_DEPOSIT_YOCTO,
            100
        ));
        let contract = PoolGuard::new();

        Self {
            contract,
            owner,
            owner_pk,
            agent_one,
            agent_one_pk,
            agent_two,
            agent_two_pk,
            provider: acct("extractor.provider.testnet"),
            provider_two: acct("other.provider.testnet"),
            outsider,
            outsider_pk,
            height: 100,
        }
    }

    fn caller(&mut self, role: Role, deposit: u128) {
        let (account, pk) = match role {
            Role::Owner => (self.owner.clone(), self.owner_pk.clone()),
            Role::AgentOne => (self.agent_one.clone(), self.agent_one_pk.clone()),
            Role::AgentTwo => (self.agent_two.clone(), self.agent_two_pk.clone()),
            Role::Outsider => (self.outsider.clone(), self.outsider_pk.clone()),
            Role::Contract => (acct(CONTRACT_ID), self.owner_pk.clone()),
        };
        testing_env!(ctx_for(&account, &pk, deposit, self.height));
    }

    fn caller_with(&mut self, account: AccountId, pk: PublicKey, deposit: u128) {
        testing_env!(ctx_for(&account, &pk, deposit, self.height));
    }

    fn at_block(&mut self, height: u64) {
        self.height = height;
    }

    fn policy(&self) -> PolicyInput {
        PolicyInput {
            max_per_operation: U128(near(2) / 100), // 0.02 NEAR
            allowed_providers: vec![self.provider.clone()],
            reservation_ttl_blocks: 50,
            expires_at_block: 10_000,
        }
    }

    fn create_task(&mut self, task_id: &str) -> TaskView {
        self.caller(Role::Owner, TASK_STORAGE_DEPOSIT_YOCTO);
        self.contract
            .create_task(task_id.to_string(), "Supplier review".to_string(), self.policy())
    }

    fn setup_default_task(&mut self) {
        self.create_task(TASK);
        self.caller(Role::Owner, near(3) / 100);
        self.contract.fund_task(TASK.to_string());
        self.caller(Role::Owner, AGENT_STORAGE_DEPOSIT_YOCTO);
        self.contract.register_agent(
            TASK.to_string(),
            self.agent_one.clone(),
            self.agent_one_pk.clone(),
        );
        self.caller(Role::Owner, AGENT_STORAGE_DEPOSIT_YOCTO);
        self.contract.register_agent(
            TASK.to_string(),
            self.agent_two.clone(),
            self.agent_two_pk.clone(),
        );
    }

    fn request(&self, seed: u32, role: Role, amount: u128, policy_version: u32) -> ReserveRequest {
        let (agent_id, provider) = match role {
            Role::AgentOne => (self.agent_one.clone(), self.provider.clone()),
            Role::AgentTwo => (self.agent_two.clone(), self.provider.clone()),
            _ => (self.owner.clone(), self.provider.clone()),
        };
        ReserveRequest {
            task_id: TASK.to_string(),
            operation_id: op_id(seed),
            agent_id,
            provider_id: provider,
            amount: U128(amount),
            service_id: "doc-extract".to_string(),
            request_hash: hash(seed),
            output_schema_hash: hash(9_000 + seed),
            policy_version,
            expires_at_block: 9_000,
        }
    }

    fn reserve(&mut self, role: Role, seed: u32, amount: u128) -> OperationView {
        let request = self.request(seed, role, amount, 1);
        self.caller(role, 0);
        self.contract.reserve(request)
    }

    fn execute(&mut self, role: Role, seed: u32) -> OperationView {
        self.caller(role, 0);
        self.contract.execute(TASK.to_string(), op_id(seed))
    }

    fn resolve_payout(&mut self, success: bool, seed: u32) -> String {
        let ctx = VMContextBuilder::new()
            .current_account_id(acct(CONTRACT_ID))
            .signer_account_id(acct(CONTRACT_ID))
            .predecessor_account_id(acct(CONTRACT_ID))
            .signer_account_pk(self.owner_pk.clone())
            .block_height(self.height)
            .attached_deposit(NearToken::from_yoctonear(0))
            .build();
        testing_env_with_promise_results(
            ctx,
            if success {
                PromiseResult::Successful(vec![])
            } else {
                PromiseResult::Failed
            },
        );
        self.contract
            .on_payout_complete(TASK.to_string(), op_id(seed))
    }

    fn resolve_withdrawal(&mut self, success: bool, withdrawal_id: u64) -> String {
        let ctx = VMContextBuilder::new()
            .current_account_id(acct(CONTRACT_ID))
            .signer_account_id(acct(CONTRACT_ID))
            .predecessor_account_id(acct(CONTRACT_ID))
            .signer_account_pk(self.owner_pk.clone())
            .block_height(self.height)
            .attached_deposit(NearToken::from_yoctonear(0))
            .build();
        testing_env_with_promise_results(
            ctx,
            if success {
                PromiseResult::Successful(vec![])
            } else {
                PromiseResult::Failed
            },
        );
        self.contract
            .on_withdrawal_complete(TASK.to_string(), withdrawal_id)
    }

    fn operation(&mut self, seed: u32) -> OperationView {
        self.contract
            .get_operation(TASK.to_string(), op_id(seed))
            .expect("operation")
    }
}


fn panic_text<T>(result: std::thread::Result<T>) -> String {
    match result {
        Ok(_) => "NO_PANIC".to_string(),
        Err(payload) => {
            if let Some(text) = payload.downcast_ref::<String>() {
                text.clone()
            } else if let Some(text) = payload.downcast_ref::<&str>() {
                (*text).to_string()
            } else {
                "UNKNOWN_PANIC".to_string()
            }
        }
    }
}

fn transfers() -> Vec<(AccountId, u128)> {
    get_created_receipts()
        .into_iter()
        .flat_map(|receipt| {
            receipt
                .actions
                .into_iter()
                .map(move |action| (receipt.receiver_id.clone(), action))
        })
        .filter_map(|(receiver, action)| match action {
            MockAction::Transfer { deposit, .. } => Some((receiver, deposit.as_yoctonear())),
            _ => None,
        })
        .collect()
}

fn callbacks() -> Vec<(AccountId, String, Vec<u8>)> {
    get_created_receipts()
        .into_iter()
        .flat_map(|receipt| {
            receipt
                .actions
                .into_iter()
                .map(move |action| (receipt.receiver_id.clone(), action))
        })
        .filter_map(|(receiver, action)| match action {
            MockAction::FunctionCallWeight {
                method_name, args, ..
            } => Some((
                receiver,
                String::from_utf8(method_name).unwrap(),
                args,
            )),
            _ => None,
        })
        .collect()
}

// ---------------------------------------------------------------- first milestone

#[test]
fn owner_creates_and_funds_a_task() {
    let mut h = Harness::new();
    let task = h.create_task(TASK);
    assert_eq!(task.owner, h.owner);
    assert_eq!(task.available.0, 0);
    assert_eq!(task.policy.policy_version, 1);

    h.caller(Role::Owner, near(3) / 100);
    let task = h.contract.fund_task(TASK.to_string());
    assert_eq!(task.total_funded.0, near(3) / 100);
    assert_eq!(task.available.0, near(3) / 100);
    assert!(h.contract.check_invariant(TASK.to_string()).unwrap());
}

#[test]
fn owner_registers_two_agents_and_an_allowlisted_provider() {
    let mut h = Harness::new();
    h.create_task(TASK);
    h.caller(Role::Owner, AGENT_STORAGE_DEPOSIT_YOCTO);
    h.contract.register_agent(
        TASK.to_string(),
        h.agent_one.clone(),
        h.agent_one_pk.clone(),
    );
    h.caller(Role::Owner, AGENT_STORAGE_DEPOSIT_YOCTO);
    let view = h.contract.register_agent(
        TASK.to_string(),
        h.agent_two.clone(),
        h.agent_two_pk.clone(),
    );
    assert!(view.active);

    let agents = h.contract.list_agents(TASK.to_string());
    assert_eq!(agents.len(), 2);
    assert_eq!(agents[0].public_key, h.agent_one_pk);
    assert_eq!(agents[1].public_key, h.agent_two_pk);
    assert!(h
        .contract
        .get_policy(TASK.to_string())
        .unwrap()
        .allowed_providers
        .contains(&h.provider));
}

#[test]
fn two_workers_race_for_insufficient_shared_budget() {
    let mut h = Harness::new();
    h.create_task(TASK);
    // 0.03 shared budget, each request is 0.02.
    h.caller(Role::Owner, near(3) / 100);
    h.contract.fund_task(TASK.to_string());
    h.caller(Role::Owner, AGENT_STORAGE_DEPOSIT_YOCTO);
    h.contract.register_agent(
        TASK.to_string(),
        h.agent_one.clone(),
        h.agent_one_pk.clone(),
    );
    h.caller(Role::Owner, AGENT_STORAGE_DEPOSIT_YOCTO);
    h.contract.register_agent(
        TASK.to_string(),
        h.agent_two.clone(),
        h.agent_two_pk.clone(),
    );

    let first = h.reserve(Role::AgentOne, 1, near(2) / 100);
    assert_eq!(first.payment_state, "reserved");
    assert_eq!(h.contract.get_budget(TASK.to_string()).unwrap().available.0, near(1) / 100);

    let request = h.request(2, Role::AgentTwo, near(2) / 100, 1);
    h.caller(Role::AgentTwo, 0);
    let denied = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        h.contract.reserve(request)
    }));
    let message = panic_text(denied);
    assert!(
        message.contains("INSUFFICIENT_AVAILABLE_BUDGET"),
        "unexpected denial: {message}"
    );

    let budget = h.contract.get_budget(TASK.to_string()).unwrap();
    assert_eq!(budget.available.0, near(1) / 100);
    assert_eq!(budget.reserved.0, near(2) / 100);
    assert!(budget.invariant_holds);
}

#[test]
fn execute_dispatches_exactly_one_transfer_to_the_provider() {
    let mut h = Harness::new();
    h.setup_default_task();
    h.reserve(Role::AgentOne, 1, near(2) / 100);
    h.execute(Role::AgentOne, 1);

    let transfers = transfers();
    assert_eq!(transfers.len(), 1, "one payout receipt");
    assert_eq!(transfers[0].0, h.provider);
    assert_eq!(transfers[0].1, near(2) / 100);

    let callbacks = callbacks();
    assert_eq!(callbacks.len(), 1);
    assert_eq!(callbacks[0].0, acct(CONTRACT_ID));
    assert_eq!(callbacks[0].1, "on_payout_complete");

    assert_eq!(h.resolve_payout(true, 1), "settled");
    let op = h.operation(1);
    assert_eq!(op.payment_state, "paid");
    assert_eq!(op.payout_attempts, 1);
    let budget = h.contract.get_budget(TASK.to_string()).unwrap();
    assert_eq!(budget.reserved.0, 0);
    assert_eq!(budget.spent.0, near(2) / 100);
    assert!(budget.invariant_holds);
}

#[test]
fn repeated_execution_cannot_pay_twice() {
    let mut h = Harness::new();
    h.setup_default_task();
    h.reserve(Role::AgentOne, 1, near(2) / 100);
    h.execute(Role::AgentOne, 1);
    assert_eq!(transfers().len(), 1);

    // Retry while payout is pending: same operation, no new transfer.
    let again = h.execute(Role::AgentOne, 1);
    assert_eq!(again.payment_state, "payout_pending");
    assert!(transfers().is_empty(), "no second transfer while pending");

    h.resolve_payout(true, 1);
    let after = h.execute(Role::AgentOne, 1);
    assert_eq!(after.payment_state, "paid");
    assert!(transfers().is_empty(), "no transfer after settlement");
    assert_eq!(h.operation(1).payout_attempts, 1);
}

#[test]
fn failed_transfer_releases_the_reservation_exactly_once() {
    let mut h = Harness::new();
    h.setup_default_task();
    h.reserve(Role::AgentOne, 1, near(2) / 100);
    h.execute(Role::AgentOne, 1);
    assert_eq!(h.resolve_payout(false, 1), "released");

    let op = h.operation(1);
    assert_eq!(op.payment_state, "payout_failed");
    let budget = h.contract.get_budget(TASK.to_string()).unwrap();
    assert_eq!(budget.reserved.0, 0);
    assert_eq!(budget.available.0, near(3) / 100);
    assert_eq!(budget.spent.0, 0);
    assert!(budget.invariant_holds);

    // Duplicate callback is a no-op, not a second release.
    assert_eq!(h.resolve_payout(false, 1), "ignored");
    let budget = h.contract.get_budget(TASK.to_string()).unwrap();
    assert_eq!(budget.available.0, near(3) / 100);
    assert!(budget.invariant_holds);
}

#[test]
fn lost_client_response_does_not_create_a_new_payment() {
    let mut h = Harness::new();
    h.setup_default_task();
    h.reserve(Role::AgentOne, 1, near(2) / 100);

    // First execute succeeds on chain; imagine the worker never saw the response.
    h.execute(Role::AgentOne, 1);
    assert_eq!(transfers().len(), 1);

    // Worker restarts, reuses the same operation id and calls execute again.
    let recovered = h.execute(Role::AgentOne, 1);
    assert_eq!(recovered.payment_state, "payout_pending");
    assert!(transfers().is_empty());

    // Settlement is visible on the original operation.
    h.resolve_payout(true, 1);
    let op = h.operation(1);
    assert_eq!(op.payment_state, "paid");
    assert_eq!(op.operation_id, op_id(1));
    assert_eq!(op.payout_attempts, 1);
}

#[test]
fn replayed_reserve_is_idempotent_and_changed_arguments_are_rejected() {
    let mut h = Harness::new();
    h.setup_default_task();
    let first = h.reserve(Role::AgentOne, 1, near(2) / 100);
    assert_eq!(first.payment_state, "reserved");

    let replay = h.reserve(Role::AgentOne, 1, near(2) / 100);
    assert_eq!(replay.payment_state, "reserved");
    let budget = h.contract.get_budget(TASK.to_string()).unwrap();
    assert_eq!(budget.reserved.0, near(2) / 100);
    assert_eq!(budget.available.0, near(1) / 100);

    // Same operation id with a different amount is a different purchase attempt.
    let mut tampered = h.request(1, Role::AgentOne, near(1) / 100, 1);
    tampered.amount = U128(near(1) / 100);
    h.caller(Role::AgentOne, 0);
    let denied = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        h.contract.reserve(tampered)
    }));
    let message = panic_text(denied);
    assert!(message.contains("OPERATION_ID_CONFLICT"), "{message}");
}

#[test]
fn worker_credentials_cannot_invoke_owner_administration() {
    let mut h = Harness::new();
    h.setup_default_task();

    let owner_calls: Vec<Box<dyn FnOnce(&mut Harness)>> = vec![
        Box::new(|h| {
            h.contract.fund_task(TASK.to_string());
        }),
        Box::new(|h| {
            h.contract.pause_task(TASK.to_string());
        }),
        Box::new(|h| {
            h.contract
                .withdraw_available(TASK.to_string(), U128(near(1) / 100));
        }),
        Box::new(|h| {
            h.contract.revoke_agent(TASK.to_string(), h.agent_one.clone());
        }),
        Box::new(|h| {
            h.contract.register_agent(
                TASK.to_string(),
                h.outsider.clone(),
                h.outsider_pk.clone(),
            );
        }),
        Box::new(|h| {
            h.contract.update_policy(TASK.to_string(), h.policy());
        }),
    ];

    for call in owner_calls {
        h.caller(Role::AgentOne, WITHDRAWAL_STORAGE_DEPOSIT_YOCTO);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| call(&mut h)));
        let message = panic_text(result);
        assert!(
            message.contains("UNAUTHORIZED_OWNER"),
            "worker admin call was not rejected: {message}"
        );
    }
}

// ------------------------------------------------------------------- authorization

#[test]
#[should_panic(expected = "AGENT_KEY_MISMATCH")]
fn wrong_worker_key_is_rejected() {
    let mut h = Harness::new();
    h.setup_default_task();
    let wrong_key = h.outsider_pk.clone();
    h.caller_with(h.agent_one.clone(), wrong_key, 0);
    h.contract.reserve(h.request(1, Role::AgentOne, near(2) / 100, 1));
}

#[test]
#[should_panic(expected = "AGENT_NOT_REGISTERED")]
fn unregistered_agent_is_rejected() {
    let mut h = Harness::new();
    h.setup_default_task();
    h.caller(Role::Outsider, 0);
    h.contract.reserve(h.request(3, Role::Outsider, near(1) / 100, 1));
}

#[test]
#[should_panic(expected = "AGENT_REVOKED")]
fn revoked_agent_cannot_reserve() {
    let mut h = Harness::new();
    h.setup_default_task();
    h.caller(Role::Owner, 0);
    h.contract
        .revoke_agent(TASK.to_string(), h.agent_one.clone());
    h.caller(Role::AgentOne, 0);
    h.contract.reserve(h.request(1, Role::AgentOne, near(1) / 100, 1));
}

#[test]
#[should_panic(expected = "UNAUTHORIZED_OWNER")]
fn non_owner_cannot_fund_task() {
    let mut h = Harness::new();
    h.create_task(TASK);
    h.caller(Role::Outsider, near(1));
    h.contract.fund_task(TASK.to_string());
}

#[test]
#[should_panic(expected = "PROVIDER_NOT_ALLOWED")]
fn unauthorized_provider_is_rejected() {
    let mut h = Harness::new();
    h.setup_default_task();
    let mut request = h.request(1, Role::AgentOne, near(1) / 100, 1);
    request.provider_id = h.provider_two.clone();
    h.caller(Role::AgentOne, 0);
    h.contract.reserve(request);
}

#[test]
#[should_panic(expected = "AGENT_ID_MISMATCH")]
fn agent_cannot_reserve_for_another_agent() {
    let mut h = Harness::new();
    h.setup_default_task();
    let mut request = h.request(1, Role::AgentOne, near(1) / 100, 1);
    request.agent_id = h.agent_two.clone();
    h.caller(Role::AgentOne, 0);
    h.contract.reserve(request);
}

#[test]
#[should_panic(expected = "UNAUTHORIZED_AGENT_OPERATION")]
fn agent_cannot_execute_another_agents_operation() {
    let mut h = Harness::new();
    h.setup_default_task();
    h.reserve(Role::AgentOne, 1, near(1) / 100);
    h.execute(Role::AgentTwo, 1);
}

// ---------------------------------------------------------------- policies & limits

#[test]
#[should_panic(expected = "PER_OPERATION_CAP_EXCEEDED")]
fn per_operation_cap_is_enforced() {
    let mut h = Harness::new();
    h.setup_default_task();
    h.reserve(Role::AgentOne, 1, near(2) / 100 + 1);
}

#[test]
fn exact_boundary_amounts_are_allowed() {
    let mut h = Harness::new();
    h.setup_default_task();
    // Exactly the per-operation cap (and less than available) succeeds.
    h.reserve(Role::AgentOne, 1, near(2) / 100);
    let budget = h.contract.get_budget(TASK.to_string()).unwrap();
    assert_eq!(budget.available.0, near(1) / 100);
    // Exactly the remaining available succeeds for a second operation.
    h.reserve(Role::AgentTwo, 2, near(1) / 100);
    let budget = h.contract.get_budget(TASK.to_string()).unwrap();
    assert_eq!(budget.available.0, 0);
    assert_eq!(budget.reserved.0, near(3) / 100);
}

#[test]
#[should_panic(expected = "TASK_PAUSED")]
fn paused_task_blocks_new_reservations() {
    let mut h = Harness::new();
    h.setup_default_task();
    h.caller(Role::Owner, 0);
    h.contract.pause_task(TASK.to_string());
    h.caller(Role::AgentOne, 0);
    h.contract.reserve(h.request(1, Role::AgentOne, near(1) / 100, 1));
}

#[test]
#[should_panic(expected = "TASK_PAUSED")]
fn paused_task_blocks_execution_of_an_existing_reservation() {
    let mut h = Harness::new();
    h.setup_default_task();
    h.reserve(Role::AgentOne, 1, near(1) / 100);
    h.caller(Role::Owner, 0);
    h.contract.pause_task(TASK.to_string());
    h.caller(Role::AgentOne, 0);
    h.contract.execute(TASK.to_string(), op_id(1));
}

#[test]
fn resume_restores_reservation_and_execution() {
    let mut h = Harness::new();
    h.setup_default_task();
    h.reserve(Role::AgentOne, 1, near(1) / 100);
    h.caller(Role::Owner, 0);
    h.contract.pause_task(TASK.to_string());
    h.caller(Role::Owner, 0);
    let task = h.contract.resume_task(TASK.to_string());
    assert!(!task.paused);
    h.execute(Role::AgentOne, 1);
    assert_eq!(transfers().len(), 1);
}

#[test]
#[should_panic(expected = "TASK_EXPIRED")]
fn expired_task_blocks_reservations() {
    let mut h = Harness::new();
    h.setup_default_task();
    h.at_block(10_001);
    h.caller(Role::AgentOne, 0);
    h.contract.reserve(h.request(1, Role::AgentOne, near(1) / 100, 1));
}

#[test]
#[should_panic(expected = "POLICY_VERSION_STALE")]
fn stale_policy_version_is_rejected_at_reservation() {
    let mut h = Harness::new();
    h.setup_default_task();
    h.caller(Role::Owner, 0);
    let mut policy = h.policy();
    policy.max_per_operation = U128(near(1) / 100);
    h.contract.update_policy(TASK.to_string(), policy);
    // Old version 1 request is now stale.
    h.caller(Role::AgentOne, 0);
    h.contract.reserve(h.request(1, Role::AgentOne, near(5) / 1000, 1));
}

#[test]
fn policy_update_invalidates_existing_reservation_and_allows_safe_cancel() {
    let mut h = Harness::new();
    h.setup_default_task();
    h.reserve(Role::AgentOne, 1, near(2) / 100);
    h.caller(Role::Owner, 0);
    let mut policy = h.policy();
    policy.max_per_operation = U128(near(1) / 100);
    h.contract.update_policy(TASK.to_string(), policy);
    assert_eq!(
        h.contract.get_policy(TASK.to_string()).unwrap().policy_version,
        2
    );

    h.caller(Role::AgentOne, 0);
    let denied = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        h.contract.execute(TASK.to_string(), op_id(1))
    }));
    let message = panic_text(denied);
    assert!(message.contains("POLICY_VERSION_STALE"), "{message}");
    assert!(transfers().is_empty());

    // Agent cancels its stale reservation; funds return to available.
    h.caller(Role::AgentOne, 0);
    let cancelled = h.contract.cancel_reservation(TASK.to_string(), op_id(1));
    assert_eq!(cancelled.payment_state, "cancelled");
    let budget = h.contract.get_budget(TASK.to_string()).unwrap();
    assert_eq!(budget.available.0, near(3) / 100);
    assert_eq!(budget.reserved.0, 0);
    assert!(budget.invariant_holds);
}

#[test]
#[should_panic(expected = "OPERATION_NOT_CANCELLABLE")]
fn dispatched_payout_cannot_be_cancelled() {
    let mut h = Harness::new();
    h.setup_default_task();
    h.reserve(Role::AgentOne, 1, near(1) / 100);
    h.execute(Role::AgentOne, 1);
    h.caller(Role::Owner, 0);
    h.contract.cancel_reservation(TASK.to_string(), op_id(1));
}

#[test]
#[should_panic(expected = "OPERATION_NOT_PAYABLE")]
fn failed_payout_cannot_be_repaid_without_a_new_logical_operation() {
    let mut h = Harness::new();
    h.setup_default_task();
    h.reserve(Role::AgentOne, 1, near(1) / 100);
    h.execute(Role::AgentOne, 1);
    h.resolve_payout(false, 1);
    h.caller(Role::AgentOne, 0);
    h.contract.execute(TASK.to_string(), op_id(1));
}

// ------------------------------------------------------- reservation expiry & recovery

#[test]
fn expired_reservation_is_released_permissionlessly_and_only_once() {
    let mut h = Harness::new();
    h.setup_default_task();
    h.reserve(Role::AgentOne, 1, near(2) / 100);
    h.at_block(151);
    h.caller(Role::Outsider, 0);
    let expired = h
        .contract
        .expire_reservation(TASK.to_string(), op_id(1));
    assert_eq!(expired.payment_state, "expired");
    let budget = h.contract.get_budget(TASK.to_string()).unwrap();
    assert_eq!(budget.available.0, near(3) / 100);
    assert_eq!(budget.reserved.0, 0);
    assert!(budget.invariant_holds);

    let again = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        h.contract.expire_reservation(TASK.to_string(), op_id(1))
    }));
    assert!(panic_text(again).contains("OPERATION_NOT_EXPIRABLE"));
    assert!(h.contract.check_invariant(TASK.to_string()).unwrap());
}

#[test]
#[should_panic(expected = "RESERVATION_NOT_EXPIRED")]
fn permissionless_expiry_cannot_cancel_a_live_reservation() {
    let mut h = Harness::new();
    h.setup_default_task();
    h.reserve(Role::AgentOne, 1, near(2) / 100);
    h.caller(Role::Outsider, 0);
    h.contract.expire_reservation(TASK.to_string(), op_id(1));
}

#[test]
#[should_panic(expected = "OPERATION_NOT_EXPIRABLE")]
fn expiry_cannot_touch_a_payout_pending_operation() {
    let mut h = Harness::new();
    h.setup_default_task();
    h.reserve(Role::AgentOne, 1, near(1) / 100);
    h.execute(Role::AgentOne, 1);
    h.at_block(200);
    h.caller(Role::Outsider, 0);
    h.contract.expire_reservation(TASK.to_string(), op_id(1));
}

#[test]
#[should_panic(expected = "RESERVATION_EXPIRED")]
fn execution_after_reservation_expiry_is_rejected() {
    let mut h = Harness::new();
    h.setup_default_task();
    h.reserve(Role::AgentOne, 1, near(1) / 100);
    h.at_block(151);
    h.caller(Role::AgentOne, 0);
    h.contract.execute(TASK.to_string(), op_id(1));
}

#[test]
fn cancellation_releases_only_the_reserving_agents_operation() {
    let mut h = Harness::new();
    h.setup_default_task();
    h.reserve(Role::AgentOne, 1, near(1) / 100);
    h.reserve(Role::AgentTwo, 2, near(1) / 100);
    h.caller(Role::AgentTwo, 0);
    let denied = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        h.contract.cancel_reservation(TASK.to_string(), op_id(1))
    }));
    assert!(panic_text(denied).contains("UNAUTHORIZED_AGENT_OPERATION"));
    h.caller(Role::AgentTwo, 0);
    let own = h.contract.cancel_reservation(TASK.to_string(), op_id(2));
    assert_eq!(own.payment_state, "cancelled");
    assert_eq!(h.operation(1).payment_state, "reserved");
}

// ----------------------------------------------------------------------- withdrawals

#[test]
fn owner_withdraws_available_funds_after_successful_transfer() {
    let mut h = Harness::new();
    h.setup_default_task();
    h.caller(Role::Owner, WITHDRAWAL_STORAGE_DEPOSIT_YOCTO);
    let withdrawal = h
        .contract
        .withdraw_available(TASK.to_string(), U128(near(1) / 100));
    assert_eq!(withdrawal.withdrawal_id, 0);
    assert_eq!(transfers()[0].0, h.owner);
    assert_eq!(transfers()[0].1, near(1) / 100);

    let budget = h.contract.get_budget(TASK.to_string()).unwrap();
    assert_eq!(budget.available.0, near(2) / 100);
    assert_eq!(budget.withdrawal_pending.0, near(1) / 100);
    assert_eq!(budget.withdrawn.0, 0);
    assert!(budget.invariant_holds);

    assert_eq!(h.resolve_withdrawal(true, 0), "settled");
    let budget = h.contract.get_budget(TASK.to_string()).unwrap();
    assert_eq!(budget.withdrawal_pending.0, 0);
    assert_eq!(budget.withdrawn.0, near(1) / 100);
    assert_eq!(h.contract.list_pending_withdrawals(TASK.to_string()).len(), 0);
    assert!(budget.invariant_holds);
    assert_eq!(h.resolve_withdrawal(true, 0), "ignored");
    assert!(h.contract.check_invariant(TASK.to_string()).unwrap());
}

#[test]
fn failed_withdrawal_returns_funds_once() {
    let mut h = Harness::new();
    h.setup_default_task();
    h.caller(Role::Owner, WITHDRAWAL_STORAGE_DEPOSIT_YOCTO);
    h.contract
        .withdraw_available(TASK.to_string(), U128(near(1) / 100));
    assert_eq!(h.resolve_withdrawal(false, 0), "released");
    let budget = h.contract.get_budget(TASK.to_string()).unwrap();
    assert_eq!(budget.available.0, near(3) / 100);
    assert_eq!(budget.withdrawal_pending.0, 0);
    assert_eq!(budget.withdrawn.0, 0);
    assert!(budget.invariant_holds);
    assert_eq!(h.resolve_withdrawal(false, 0), "ignored");
    assert_eq!(
        h.contract.get_budget(TASK.to_string()).unwrap().available.0,
        near(3) / 100
    );
}

#[test]
#[should_panic(expected = "INSUFFICIENT_AVAILABLE_FUNDS")]
fn reserved_funds_cannot_be_withdrawn() {
    let mut h = Harness::new();
    h.setup_default_task();
    h.reserve(Role::AgentOne, 1, near(2) / 100);
    // Available is 0.01; try to withdraw 0.02.
    h.caller(Role::Owner, WITHDRAWAL_STORAGE_DEPOSIT_YOCTO);
    h.contract
        .withdraw_available(TASK.to_string(), U128(near(2) / 100));
}

#[test]
#[should_panic(expected = "WITHDRAWAL_STORAGE_DEPOSIT_REQUIRED")]
fn withdrawal_requires_its_storage_deposit() {
    let mut h = Harness::new();
    h.setup_default_task();
    h.caller(Role::Owner, 0);
    h.contract
        .withdraw_available(TASK.to_string(), U128(near(1) / 100));
}

#[test]
fn cross_task_accounting_is_isolated() {
    let mut h = Harness::new();
    h.create_task(TASK);
    h.caller(Role::Owner, near(5) / 100);
    h.contract.fund_task(TASK.to_string());
    h.create_task("second-task");
    h.caller(Role::Owner, near(2) / 100);
    h.contract.fund_task("second-task".to_string());

    h.caller(Role::Owner, WITHDRAWAL_STORAGE_DEPOSIT_YOCTO);
    h.contract
        .withdraw_available(TASK.to_string(), U128(near(1) / 100));
    h.resolve_withdrawal(true, 0);

    let first = h.contract.get_budget(TASK.to_string()).unwrap();
    let second = h.contract.get_budget("second-task".to_string()).unwrap();
    assert_eq!(first.available.0, near(4) / 100);
    assert_eq!(first.withdrawn.0, near(1) / 100);
    assert_eq!(second.available.0, near(2) / 100);
    assert_eq!(second.withdrawn.0, 0);
    assert!(first.invariant_holds && second.invariant_holds);
}

#[test]
#[should_panic(expected = "UNAUTHORIZED_OWNER")]
fn other_task_owner_cannot_withdraw_this_task() {
    let mut h = Harness::new();
    h.create_task(TASK);
    h.caller(Role::Owner, near(1));
    h.contract.fund_task(TASK.to_string());

    // Mallory owns a different task but must not touch this one.
    h.caller(Role::Outsider, TASK_STORAGE_DEPOSIT_YOCTO);
    h.contract
        .create_task("mallory-task".to_string(), "Mallory".to_string(), h.policy());
    h.caller(Role::Outsider, WITHDRAWAL_STORAGE_DEPOSIT_YOCTO);
    h.contract
        .withdraw_available(TASK.to_string(), U128(near(1) / 10));
}

// ------------------------------------------------------- storage, overflow, invariants

#[test]
#[should_panic(expected = "TASK_STORAGE_DEPOSIT_REQUIRED")]
fn task_creation_requires_a_storage_deposit() {
    let mut h = Harness::new();
    h.caller(Role::Owner, 0);
    h.contract
        .create_task(TASK.to_string(), "Supplier review".to_string(), h.policy());
}

#[test]
#[should_panic(expected = "OPERATION_LIMIT_REACHED")]
fn bounded_operation_records_stop_unpaid_storage_growth() {
    let mut h = Harness::new();
    h.caller(Role::Owner, TASK_STORAGE_DEPOSIT_YOCTO);
    let mut policy = h.policy();
    policy.max_per_operation = U128(near(1) / 1000);
    policy.allowed_providers = vec![h.provider.clone()];
    h.contract
        .create_task(TASK.to_string(), "Bounded".to_string(), policy);
    h.caller(Role::Owner, near(1));
    h.contract.fund_task(TASK.to_string());
    h.caller(Role::Owner, AGENT_STORAGE_DEPOSIT_YOCTO);
    h.contract.register_agent(
        TASK.to_string(),
        h.agent_one.clone(),
        h.agent_one_pk.clone(),
    );
    h.caller(Role::Owner, AGENT_STORAGE_DEPOSIT_YOCTO);
    h.contract.register_agent(
        TASK.to_string(),
        h.agent_two.clone(),
        h.agent_two_pk.clone(),
    );

    for seed in 0..MAX_OPERATIONS_PER_TASK {
        let role = if seed % 2 == 0 { Role::AgentOne } else { Role::AgentTwo };
        let request = h.request(seed, role, near(5) / 10_000, 1);
        h.caller(role, 0);
        h.contract.reserve(request);
        h.caller(role, 0);
        h.contract
            .cancel_reservation(TASK.to_string(), op_id(seed));
    }

    let task = h.contract.get_task(TASK.to_string()).unwrap();
    assert_eq!(task.operation_count, MAX_OPERATIONS_PER_TASK);
    h.caller(Role::AgentOne, 0);
    h.contract.reserve(h.request(999, Role::AgentOne, near(1) / 10_000, 1));
}

#[test]
fn bounded_state_fits_inside_the_owner_paid_storage_deposit() {
    let mut h = Harness::new();
    let before = env::storage_usage();
    h.create_task(TASK);
    h.caller(Role::Owner, AGENT_STORAGE_DEPOSIT_YOCTO);
    h.contract.register_agent(
        TASK.to_string(),
        h.agent_one.clone(),
        h.agent_one_pk.clone(),
    );
    h.caller(Role::Owner, AGENT_STORAGE_DEPOSIT_YOCTO);
    h.contract.register_agent(
        TASK.to_string(),
        h.agent_two.clone(),
        h.agent_two_pk.clone(),
    );
    h.caller(Role::Owner, near(1));
    h.contract.fund_task(TASK.to_string());

    for seed in 0..MAX_OPERATIONS_PER_TASK {
        let role = if seed % 2 == 0 { Role::AgentOne } else { Role::AgentTwo };
        h.caller(role, 0);
        h.contract
            .reserve(h.request(seed, role, near(1) / 1000, 1));
        h.caller(role, 0);
        h.contract
            .cancel_reservation(TASK.to_string(), op_id(seed));
    }

    let used = env::storage_usage().saturating_sub(before) as u128;
    let paid = TASK_STORAGE_DEPOSIT_YOCTO + 2 * AGENT_STORAGE_DEPOSIT_YOCTO;
    let charged = used * env::storage_byte_cost().as_yoctonear();
    assert!(
        charged <= paid,
        "bounded state costs {charged} yocto but only {paid} was collected ({used} bytes)"
    );
    assert!(h.contract.check_invariant(TASK.to_string()).unwrap());
}

#[test]
#[should_panic(expected = "TOTAL_FUNDED_OVERFLOW")]
fn funding_overflow_is_checked() {
    let mut h = Harness::new();
    h.create_task(TASK);
    // Craft the pre-state directly so the mock's account balance cannot overflow
    // before the contract's own checked arithmetic is exercised.
    let mut task = h.contract.tasks.get(&TASK.to_string()).unwrap().clone();
    task.total_funded = u128::MAX;
    task.available = u128::MAX;
    h.contract.tasks.insert(TASK.to_string(), task);

    h.caller(Role::Owner, 1);
    h.contract.fund_task(TASK.to_string());
}

#[test]
fn conservation_invariant_holds_after_a_mixed_operation_sequence() {
    let mut h = Harness::new();
    h.setup_default_task();

    h.reserve(Role::AgentOne, 1, near(2) / 100);
    h.execute(Role::AgentOne, 1);
    h.resolve_payout(true, 1);

    h.reserve(Role::AgentTwo, 2, near(1) / 100);
    h.caller(Role::AgentTwo, 0);
    h.contract.cancel_reservation(TASK.to_string(), op_id(2));

    h.reserve(Role::AgentOne, 3, near(5) / 1000);
    h.execute(Role::AgentOne, 3);
    h.resolve_payout(false, 3);

    h.caller(Role::Owner, WITHDRAWAL_STORAGE_DEPOSIT_YOCTO);
    h.contract
        .withdraw_available(TASK.to_string(), U128(near(5) / 1000));
    h.resolve_withdrawal(true, 0);

    let budget = h.contract.get_budget(TASK.to_string()).unwrap();
    assert_eq!(
        budget.total_funded.0,
        budget.available.0
            + budget.reserved.0
            + budget.spent.0
            + budget.withdrawn.0
            + budget.withdrawal_pending.0
    );
    assert_eq!(budget.total_funded.0, near(3) / 100);
    assert_eq!(budget.spent.0, near(2) / 100);
    assert!(budget.invariant_holds);
    assert!(h.contract.check_invariant(TASK.to_string()).unwrap());
}

#[test]
fn duplicate_and_late_callbacks_are_idempotent() {
    let mut h = Harness::new();
    h.setup_default_task();
    h.reserve(Role::AgentOne, 1, near(1) / 100);
    h.execute(Role::AgentOne, 1);
    assert_eq!(h.resolve_payout(true, 1), "settled");
    assert_eq!(h.resolve_payout(true, 1), "ignored");
    assert_eq!(h.resolve_payout(false, 1), "ignored");
    let budget = h.contract.get_budget(TASK.to_string()).unwrap();
    assert_eq!(budget.spent.0, near(1) / 100);
    assert_eq!(budget.available.0, near(2) / 100);
    assert!(budget.invariant_holds);
}

#[test]
#[should_panic(expected = "CALLBACK_NOT_PRIVATE")]
fn external_account_cannot_forge_a_payout_callback() {
    let mut h = Harness::new();
    h.setup_default_task();
    h.reserve(Role::AgentOne, 1, near(1) / 100);
    h.execute(Role::AgentOne, 1);
    h.caller(Role::Outsider, 0);
    h.contract
        .on_payout_complete(TASK.to_string(), op_id(1));
}

#[test]
fn task_id_and_policy_validation_rejects_bad_input() {
    let mut h = Harness::new();
    h.caller(Role::Owner, TASK_STORAGE_DEPOSIT_YOCTO);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        h.contract.create_task(
            "Bad Task!".to_string(),
            "x".to_string(),
            h.policy(),
        )
    }));
    assert!(panic_text(result).contains("TASK_ID_INVALID"));

    let mut duplicate_providers = h.policy();
    duplicate_providers
        .allowed_providers
        .push(h.provider.clone());
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        h.contract
            .create_task(TASK.to_string(), "x".to_string(), duplicate_providers)
    }));
    assert!(panic_text(result).contains("POLICY_DUPLICATE_PROVIDER"));
}

#[test]
fn agent_limit_is_bounded() {
    let mut h = Harness::new();
    h.create_task(TASK);
    let pk = key("ed25519:2Dva297S2g9sKaa2T2zbPHHCr93qyEC7DkRRZ237Ydgf");
    for i in 0..MAX_AGENTS {
        let account: AccountId = format!("agent-{i}.testnet").parse().unwrap();
        h.caller(Role::Owner, AGENT_STORAGE_DEPOSIT_YOCTO);
        let view = h.contract.register_agent(TASK.to_string(), account, pk.clone());
        assert!(view.active);
    }
    let extra: AccountId = "one-too-many.testnet".parse().unwrap();
    h.caller(Role::Owner, AGENT_STORAGE_DEPOSIT_YOCTO);
    let denied = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        h.contract
            .register_agent(TASK.to_string(), extra, pk.clone())
    }));
    assert!(panic_text(denied).contains("AGENT_LIMIT_REACHED"));
}

#[test]
fn provider_allowlist_update_applies_to_future_reservations() {
    let mut h = Harness::new();
    h.setup_default_task();
    h.caller(Role::Owner, 0);
    let mut policy = h.policy();
    policy.allowed_providers = vec![h.provider_two.clone()];
    h.contract.update_policy(TASK.to_string(), policy);

    let mut stale = h.request(1, Role::AgentOne, near(1) / 100, 1);
    stale.policy_version = 2;
    stale.provider_id = h.provider.clone();
    h.caller(Role::AgentOne, 0);
    let denied = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        h.contract.reserve(stale)
    }));
    assert!(panic_text(denied).contains("PROVIDER_NOT_ALLOWED"));

    let mut allowed = h.request(2, Role::AgentOne, near(1) / 100, 2);
    allowed.provider_id = h.provider_two.clone();
    h.caller(Role::AgentOne, 0);
    let op = h.contract.reserve(allowed);
    assert_eq!(op.payment_state, "reserved");
}

#[test]
fn task_owner_controls_pause_and_revocation_but_not_other_tasks() {
    let mut h = Harness::new();
    h.setup_default_task();
    h.caller(Role::Outsider, TASK_STORAGE_DEPOSIT_YOCTO);
    h.contract
        .create_task("mallory-task".to_string(), "Mallory".to_string(), h.policy());

    h.caller(Role::Outsider, 0);
    let denied = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        h.contract.pause_task(TASK.to_string())
    }));
    assert!(panic_text(denied).contains("UNAUTHORIZED_OWNER"));

    h.caller(Role::Outsider, 0);
    let denied = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        h.contract.revoke_agent(TASK.to_string(), h.agent_one.clone())
    }));
    assert!(panic_text(denied).contains("UNAUTHORIZED_OWNER"));
}

#[test]
fn owner_may_cancel_a_stale_reservation() {
    let mut h = Harness::new();
    h.setup_default_task();
    h.reserve(Role::AgentOne, 1, near(1) / 100);
    h.caller(Role::Owner, 0);
    let cancelled = h
        .contract
        .cancel_reservation(TASK.to_string(), op_id(1));
    assert_eq!(cancelled.payment_state, "cancelled");
    assert_eq!(
        h.contract.get_budget(TASK.to_string()).unwrap().available.0,
        near(3) / 100
    );
}

#[test]
fn padding_and_storage_are_not_counted_as_task_money() {
    let mut h = Harness::new();
    h.setup_default_task();
    // Storage deposits were attached to create/register; they must never appear in
    // the task's funded accounting.
    let budget = h.contract.get_budget(TASK.to_string()).unwrap();
    assert_eq!(budget.total_funded.0, near(3) / 100);
    assert_eq!(budget.available.0, near(3) / 100);
    assert!(budget.invariant_holds);
}

// ---------------------------------------------------------------- review hardening

#[test]
fn one_agent_cannot_exhaust_every_operation_slot() {
    let mut h = Harness::new();
    h.setup_default_task();

    for seed in 0..MAX_OPERATIONS_PER_AGENT {
        h.reserve(Role::AgentOne, seed, 1);
        h.caller(Role::AgentOne, 0);
        h.contract.cancel_reservation(TASK.to_string(), op_id(seed));
    }
    let blocked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        h.reserve(Role::AgentOne, 500, 1);
    }));
    assert!(panic_text(blocked).contains("AGENT_OPERATION_LIMIT_REACHED"));

    // The other agent still has its own slots and can make a real purchase.
    let view = h.reserve(Role::AgentTwo, 600, near(2) / 100);
    assert_eq!(view.payment_state, "reserved");
    assert!(h.contract.check_invariant(TASK.to_string()).unwrap());
}

#[test]
fn idempotent_reserve_replay_does_not_consume_an_agent_slot() {
    let mut h = Harness::new();
    h.setup_default_task();
    h.reserve(Role::AgentOne, 1, near(1) / 100);
    h.reserve(Role::AgentOne, 1, near(1) / 100);
    let agent = h.contract.tasks.get(&TASK.to_string()).unwrap().agents[0].clone();
    assert_eq!(agent.operation_count, 1);
}

#[test]
fn excess_task_storage_deposit_is_refunded() {
    let mut h = Harness::new();
    let extra = near(1) / 10;
    h.caller(Role::Owner, TASK_STORAGE_DEPOSIT_YOCTO + extra);
    h.contract
        .create_task(TASK.to_string(), "Supplier review".to_string(), h.policy());
    assert_eq!(transfers(), vec![(h.owner.clone(), extra)]);
}

#[test]
fn exact_task_storage_deposit_creates_no_refund() {
    let mut h = Harness::new();
    h.create_task(TASK);
    assert!(transfers().is_empty());
}

#[test]
fn excess_agent_deposit_is_refunded_and_reactivation_refunds_everything() {
    let mut h = Harness::new();
    h.create_task(TASK);
    let extra = near(1) / 100;
    h.caller(Role::Owner, AGENT_STORAGE_DEPOSIT_YOCTO + extra);
    h.contract.register_agent(
        TASK.to_string(),
        h.agent_one.clone(),
        h.agent_one_pk.clone(),
    );
    assert_eq!(transfers(), vec![(h.owner.clone(), extra)]);

    // Re-registering an existing agent needs no new storage, so it refunds all of it.
    h.caller(Role::Owner, AGENT_STORAGE_DEPOSIT_YOCTO);
    h.contract.register_agent(
        TASK.to_string(),
        h.agent_one.clone(),
        h.agent_one_pk.clone(),
    );
    assert_eq!(transfers(), vec![(h.owner.clone(), AGENT_STORAGE_DEPOSIT_YOCTO)]);
}

#[test]
fn excess_withdrawal_deposit_is_refunded_alongside_the_withdrawal() {
    let mut h = Harness::new();
    h.setup_default_task();
    let extra = near(1) / 100;
    h.caller(Role::Owner, WITHDRAWAL_STORAGE_DEPOSIT_YOCTO + extra);
    h.contract
        .withdraw_available(TASK.to_string(), U128(near(1) / 100));
    let sent = transfers();
    assert!(sent.contains(&(h.owner.clone(), extra)));
    assert!(sent.contains(&(h.owner.clone(), near(1) / 100)));
    assert!(h.contract.check_invariant(TASK.to_string()).unwrap());
}
