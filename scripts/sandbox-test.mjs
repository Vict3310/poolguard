#!/usr/bin/env node
/**
 * Contract proof against a real NEAR sandbox node.
 *
 * Starts near-sandbox, deploys a freshly built WASM, creates real accounts with
 * restricted function-call keys, and exercises the financial boundaries. This is
 * deliberately a script rather than a mocked test: every assertion below observes
 * finalized sandbox state and native token balances.
 */
import assert from "node:assert/strict";
import {
  Account,
  KeyPairSigner,
  actions,
  nearToYocto,
  teraToGas,
} from "near-api-js";
import { provisionSandbox } from "./sandbox-lib.mjs";

const TASK = "sandbox-proof";
const PRICE = nearToYocto("0.02").toString();
const SMALL = nearToYocto("0.005").toString();
const BUDGET = nearToYocto("0.03").toString();
const hash = (n) => n.toString(16).padStart(64, "0");
const op = (n) => (n + 1000n).toString(16).padStart(64, "0");
const fmt = (value) => (typeof value === "bigint" ? value.toString() : JSON.stringify(value));

let passed = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ✓ ${name}`);
    })
    .catch((error) => {
      console.error(`  ✗ ${name}`);
      throw error;
    });
}

const handles = await provisionSandbox({ log: (message) => console.log(`  · ${message}`) });
const { provider, owner, workers, contract, providerAccount } = handles;
const contractId = contract.accountId;
const ownerAccount = owner.account;
const workerAccounts = workers.map((worker) => worker.account);
const restricted = workers.map((worker) => worker.restrictedKey);

async function view(method, args) {
  return provider.callFunction({ contractId, method, args });
}

async function balance(accountId) {
  return BigInt((await provider.viewAccount({ accountId })).amount);
}

function reserveArgs(index, operationId, overrides = {}) {
  return {
    request: {
      task_id: TASK,
      operation_id: operationId,
      agent_id: workers[index].accountId,
      provider_id: providerAccount.accountId,
      amount: PRICE,
      service_id: "doc-extract-v1",
      request_hash: hash(1n),
      output_schema_hash: hash(2n),
      policy_version: 1,
      expires_at_block: 999_999,
      ...overrides,
    },
  };
}

async function call(account, method, args, gas = 60) {
  return account.signAndSendTransaction({
    receiverId: contractId,
    actions: [actions.functionCall(method, args, teraToGas(String(gas)))],
    waitUntil: "FINAL",
  });
}

async function denial(promise) {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

console.log("\nPoolGuard sandbox proof\n");

try {
  await check("owner creates and funds a task", async () => {
    const policy = {
      max_per_operation: PRICE,
      allowed_providers: [providerAccount.accountId],
      reservation_ttl_blocks: 250,
      expires_at_block: 999_999,
    };
    await ownerAccount.signAndSendTransaction({
      receiverId: contractId,
      actions: [
        actions.functionCall(
          "create_task",
          { task_id: TASK, name: "Sandbox proof", policy },
          teraToGas("50"),
          nearToYocto("0.35"),
        ),
        actions.functionCall("fund_task", { task_id: TASK }, teraToGas("50"), BUDGET),
        actions.functionCall(
          "register_agent",
          {
            task_id: TASK,
            account_id: workers[0].accountId,
            public_key: restricted[0].getPublicKey().toString(),
          },
          teraToGas("50"),
          nearToYocto("0.02"),
        ),
        actions.functionCall(
          "register_agent",
          {
            task_id: TASK,
            account_id: workers[1].accountId,
            public_key: restricted[1].getPublicKey().toString(),
          },
          teraToGas("50"),
          nearToYocto("0.02"),
        ),
      ],
      waitUntil: "FINAL",
    });
    const task = await view("get_task", { task_id: TASK });
    assert.equal(task.owner, owner.accountId);
    assert.equal(task.total_funded, BUDGET);
    assert.equal(task.available, BUDGET);
    assert.equal(task.agents.length, 2);
  });

  await check("two workers hold real restricted keys", async () => {
    const keys = await provider.viewAccessKey({
      accountId: workers[0].accountId,
      publicKey: restricted[0].getPublicKey().toString(),
    });
    assert.ok(keys.permission.FunctionCall);
    assert.equal(keys.permission.FunctionCall.receiver_id, contractId);
    assert.ok(!keys.permission.FunctionCall.method_names.includes("pause_task"));
  });

  await check("concurrent race cannot overdraw the shared budget", async () => {
    const results = await Promise.allSettled([
      call(workerAccounts[0], "reserve", reserveArgs(0, op(1n))),
      call(workerAccounts[1], "reserve", reserveArgs(1, op(2n))),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    if (fulfilled.length !== 1) {
      console.error(
        "    race results:",
        results.map((result) =>
          result.status === "rejected" ? String(result.reason?.message ?? result.reason) : "ok",
        ),
      );
    }
    assert.equal(fulfilled.length, 1, "exactly one reservation must win");
    assert.equal(rejected.length, 1, "the loser must be denied");
    const message = String(rejected[0].reason?.message ?? rejected[0].reason);
    assert.match(message, /INSUFFICIENT_AVAILABLE_BUDGET/);
    const task = await view("get_task", { task_id: TASK });
    assert.equal(task.reserved, PRICE);
    assert.equal(task.available, nearToYocto("0.01").toString());
    assert.equal(task.invariant_holds, undefined); // TaskView has no invariant field
  });

  const winnerIndex = (await view("get_operation", { task_id: TASK, operation_id: op(1n) }))
    ? 0
    : 1;
  const winningOperation = op(BigInt(winnerIndex + 1));

  await check("an approved operation pays its provider exactly once", async () => {
    const before = await balance(providerAccount.accountId);
    await call(workerAccounts[winnerIndex], "execute", {
      task_id: TASK,
      operation_id: winningOperation,
    }, 120);
    const after = await balance(providerAccount.accountId);
    assert.equal(after - before, BigInt(PRICE));
    const operation = await view("get_operation", {
      task_id: TASK,
      operation_id: winningOperation,
    });
    assert.equal(operation.payment_state, "paid");
    assert.equal(operation.payout_attempts, 1);
  });

  await check("repeated execution cannot produce a second payout", async () => {
    const before = await balance(providerAccount.accountId);
    await call(workerAccounts[winnerIndex], "execute", {
      task_id: TASK,
      operation_id: winningOperation,
    }, 120);
    const after = await balance(providerAccount.accountId);
    assert.equal(after, before);
    const operation = await view("get_operation", {
      task_id: TASK,
      operation_id: winningOperation,
    });
    assert.equal(operation.payout_attempts, 1);
  });

  await check("changed parameters for the same operation id are rejected", async () => {
    const message = await denial(
      call(workerAccounts[winnerIndex], "reserve", reserveArgs(winnerIndex, winningOperation, { amount: SMALL })),
    );
    assert.ok(message, "a changed-argument replay must fail");
    assert.match(message, /OPERATION_ID_CONFLICT/);
  });

  await check("unauthorized provider is rejected by the contract", async () => {
    const message = await denial(
      call(workerAccounts[0], "reserve", reserveArgs(0, op(7n), { provider_id: "not-allowed.sandbox" })),
    );
    assert.ok(message);
    assert.match(message, /PROVIDER_NOT_ALLOWED/);
  });

  await check("a worker key cannot invoke owner administration", async () => {
    const before = await view("get_task", { task_id: TASK });
    const message = await denial(call(workerAccounts[0], "pause_task", { task_id: TASK }, 20));
    assert.ok(message);
    const after = await view("get_task", { task_id: TASK });
    assert.equal(after.paused, before.paused);
  });

  await check("cancel releases a reservation exactly once", async () => {
    const operationId = op(8n);
    await call(workerAccounts[0], "reserve", reserveArgs(0, operationId, { amount: SMALL }));
    const reserved = await view("get_budget", { task_id: TASK });
    await call(workerAccounts[0], "cancel_reservation", { task_id: TASK, operation_id: operationId });
    const after = await view("get_budget", { task_id: TASK });
    assert.equal(BigInt(after.available) - BigInt(reserved.available), BigInt(SMALL));
    const operation = await view("get_operation", { task_id: TASK, operation_id: operationId });
    assert.equal(operation.payment_state, "cancelled");
  });

  await check("a lost response is recoverable from chain state", async () => {
    const operationId = op(9n);
    await call(workerAccounts[0], "reserve", reserveArgs(0, operationId, { amount: SMALL }));
    const before = await balance(providerAccount.accountId);
    // Submit without waiting, then discard the returned promise: the transaction is
    // already accepted by the node. Recovery uses the stable operation id.
    await workerAccounts[0].signAndSendTransaction({
      receiverId: contractId,
      actions: [actions.functionCall("execute", { task_id: TASK, operation_id: operationId }, teraToGas("120"))],
      waitUntil: "NONE",
    });
    let operation = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      operation = await view("get_operation", { task_id: TASK, operation_id: operationId });
      if (operation?.payment_state === "paid") break;
    }
    assert.equal(operation?.payment_state, "paid");
    const after = await balance(providerAccount.accountId);
    assert.equal(after - before, BigInt(SMALL));
    const replay = await denial(
      call(workerAccounts[0], "execute", { task_id: TASK, operation_id: operationId }, 120),
    );
    assert.equal(replay, null, "repeat execute is idempotent and succeeds");
    assert.equal(await balance(providerAccount.accountId), after);
  });

  await check("accounting invariant holds after the sequence", async () => {
    const budget = await view("get_budget", { task_id: TASK });
    assert.equal(budget.invariant_holds, true);
    const total =
      BigInt(budget.available) +
      BigInt(budget.reserved) +
      BigInt(budget.spent) +
      BigInt(budget.withdrawn) +
      BigInt(budget.withdrawal_pending);
    assert.equal(total, BigInt(budget.total_funded));
  });

  console.log(`\nSandbox proof passed: ${passed} checks.\n`);
} catch (error) {
  console.error("\nSandbox proof failed:", error);
  process.exitCode = 1;
} finally {
  await handles.tearDown().catch(() => undefined);
  process.exit(process.exitCode ?? 0);
}
