# PoolGuard demo runbook

This is a reproducible local demonstration against a **real NEAR sandbox node**. It is not a recording and it is not public testnet evidence. Every reservation, denial, payout and callback below executes the Rust contract; the provider independently verifies finalized payment before returning a result.

All balances are test tokens with no monetary value. This prototype is not audited.

---

## 1. Prerequisites

- Node.js `>=22.22.2` and pnpm `10.20.0` (see `package.json`).
- Rust stable with the `wasm32-unknown-unknown` target available to `rustup`.
- Docker (recommended for PostgreSQL) **or** a Linux x64 host for the embedded PostgreSQL fallback.
- Two terminals at minimum; four if you want to restart the worker independently.

Install dependencies and build the contract once:

```bash
pnpm install
pnpm contract:build
```

`pnpm contract:build` compiles the contract to `contracts/poolguard/res/poolguard.wasm`. The sandbox setup also builds it automatically if the WASM file is missing.

The demo does **not** need an owner seed phrase. Sandbox owner keys are generated locally and written to the gitignored `.env.local`; they never enter the browser bundle.

---

## 2. Start PostgreSQL

### Docker

The repository includes a local-only `docker-compose.yml`. If you do not already have PostgreSQL on `127.0.0.1:55432`, run:

```bash
docker compose up -d postgres
docker compose ps
```

### No Docker

On Linux x64, the repository includes a project-local, non-root PostgreSQL:

```bash
node scripts/local-postgres.mjs
```

Leave it running. It listens on `127.0.0.1:55432` by default, stores data in `.data/postgres`, and prints the matching `DATABASE_URL`.

On macOS, use Docker or a native PostgreSQL server. The embedded package is Linux x64 only.

---

## 3. One-time sandbox provisioning

In a second terminal:

```bash
node scripts/sandbox.mjs
```

This single process:

1. Starts an ephemeral NEAR sandbox node and picks an RPC port.
2. Deploys the freshly built PoolGuard WASM to `poolguard.sandbox`.
3. Creates real sandbox accounts: `owner.sandbox`, `extract.sandbox`, `agent-one.sandbox`, `agent-two.sandbox`.
4. Adds a **restricted function-call key** to each worker account. The key may call only `reserve`, `execute`, `cancel_reservation` and `expire_reservation` on the PoolGuard contract, with a 0.25 NEAR gas allowance. The worker's full-access key is not used by the application.
5. Writes `.env.local` (mode `0600`) with the sandbox RPC URL, contract ID, account IDs and local worker keys. It never prints secret key material.

Keep this terminal running for the whole demo. The sandbox is ephemeral: restarting it creates **new accounts and keys**. Existing database tasks then point at a chain that no longer exists; perform the fresh reset in section 11.

Your `.env` must provide the stable settings and secrets: `SESSION_SECRET`, `DOCUMENT_ENCRYPTION_KEY`, `AI_*` if live mode is wanted, and the provider/worker slots. `.env.local` overrides the chain identity values. See `.env.example` and [DEPLOYMENT.md](./DEPLOYMENT.md#environment-variables).

### Start the application stack

In a third terminal:

```bash
pnpm dev
```

The runner applies Prisma migrations, seeds the service catalog, and starts the API (`4100`), provider (`4103`), worker and web app (`3000`). Open:

```
http://127.0.0.1:3000
```

If the runner is unavailable in your checkout, use the four-terminal layout in [DEPLOYMENT.md](./DEPLOYMENT.md#run-the-local-apps-manually). Keep exactly **one worker process per configured worker key**.

---

## 4. Sign in with the labelled sandbox session

1. Open `http://127.0.0.1:3000/app`.
2. Click **Connect wallet**.
3. The dialog detects sandbox mode and explains that testnet wallets cannot sign for sandbox accounts.
4. Click **Use sandbox session**.

The UI labels the session as a local sandbox session with no wallet signature. This is intentional and explicitly gated by `LOCAL_SANDBOX_MODE`, `ALLOW_DEV_SESSION` and `NODE_ENV !== "production"`. Contract policy still applies to every call.

If the button is absent, check that the API `/meta` response reports `sandbox: true` and `devSessionEnabled: true`. Do not enable dev sessions outside local sandbox use.

---

## 5. Create tasks with the right budgets

Open **Tasks → Create task**. Use **Load samples** for the two clean supplier documents, or **Load adversarial fixture** for scenario C. In sandbox mode, submitting the form creates the database task and immediately performs the owner setup transaction through the gated sandbox helper. If it stops on the review screen, click **Fund sandbox task**.

One setup transaction carries:

- `create_task` with the policy and a 0.35 NEAR storage deposit.
- `fund_task` with the task budget.
- Two `register_agent` calls with a 0.02 NEAR storage deposit each.

The setup is a **funding/administration transaction**, not a worker purchase. Worker operations later can only reserve and execute within this policy.

Use a fresh task per scenario for clean evidence:

| Scenario | Task budget | Per-operation cap | Documents | Notes |
|---|---:|---:|---|---|
| A — permitted purchase | `0.05` testNEAR | `0.02` testNEAR | 2 clean | Both agents pay 0.02. |
| B — shared-budget race | `0.03` testNEAR | `0.02` testNEAR | 2 clean | Both race for 0.02; one falls back to the 0.005 service. |
| C — malicious instruction | `0.05` testNEAR | `0.02` testNEAR | 2, one adversarial | The contract probe runs first. |
| D — lost response | `0.03` testNEAR | `0.02` testNEAR | 1 | API starts exactly one agent for this scenario. |

Recommended defaults from the form are `0.03` budget / `0.02` cap; adjust the budget field for A and C. Reservation lifetime `300` blocks and expiry `8000` blocks from the current block are suitable for the sandbox.

Wait for the task status to become **Active** before running a scenario.

### Live model versus scripted fixture

`GET /meta` reports `aiConfigured`. If `AI_API_KEY` is not set, the demo lab labels runs **Scripted fixture**. The contract, provider, payment, denial and recovery paths are still real; no model is used. If `AI_API_KEY` is set and the API/worker are restarted, the same scenarios run with the configured OpenAI-compatible model and are labelled **Live model**.

Do not describe a scripted run as a live AI execution.

---

## 6. Run the four scenarios

Navigate to **Practice → Demo lab** (`/app/demo`), select the task in **Demo task**, and click the matching **Run scenario X** button. The run cards update automatically. The bottom link **Inspect the full task, budget and operation evidence** opens the task.

### Scenario A — permitted purchase

Click **Run scenario A** on the 0.05/0.02 task.

**Observe:**

- Two agent runs finish successfully.
- Purchases table: two `doc-extract-v1` operations, each **Paid** and **Delivered**.
- Budget: available `0.01`, spent `0.04`, reserved `0`, invariant holds.
- The task **Result** section shows two supplier extractions, including supplier names, products, quoted amounts, delivery terms and missing fields.
- Each operation drawer has a different operation ID and exactly one payout attempt.

This proves agents can use a useful paid service inside the policy.

### Scenario B — shared-budget race

Click **Run scenario B** on the 0.03/0.02 task.

The two workers request 0.02 at nearly the same block. The contract serializes the reservations. They are genuinely concurrent; this is not a sequential animation.

**Observe:**

- Exactly one 0.02 reservation succeeds.
- The other agent receives `INSUFFICIENT_AVAILABLE_BUDGET`, shown as a structured denial, not a generic failure.
- The denied agent takes the bounded fallback to the cheaper `doc-summary` service at 0.005. Its run summary says it fell back after a denial.
- Final budget is normally available `0.005`, spent `0.025`: one 0.02 payout plus one 0.005 payout. If the fallback is not used, the task ends partial with available `0.01`.
- No agent ever spends beyond the shared 0.03 pool.

If both workers request 0.02 against a task with only 0.03 available, a second 0.02 reservation is impossible. That is the point.

### Scenario C — malicious instruction

Click **Run scenario C** on the 0.05/0.02 adversarial task. The second document contains an instruction to redirect payment or raise the limit.

The demo lab first runs a **separately labelled contract policy probe** using worker one and the non-allowlisted `POLICY_PROBE_PROVIDER_ACCOUNT_ID`. The probe is not evidence that the model followed the document.

**Observe:**

- The red **Contract policy probe** panel says `Denied with PROVIDER_NOT_ALLOWED` (or the equivalent stable denial code).
- The probe's failed transaction hash is shown; the reservation never existed on chain.
- The agent cards report what the model actually did. The model may correctly ignore the text. Report that honestly.
- No task policy, provider allowlist or budget is changed. The model cannot submit owner administration or arbitrary recipients.
- If the probe is not configured or returns an unclassified transport error, the panel says **Probe unavailable** and shows the error. That is not a denial; retry after checking the RPC/signer nonce. The API re-reads worker one’s access-key nonce before each probe so a stale cached nonce cannot masquerade as policy evidence.
- If worker one previously signed a reservation that never reached the node, the worker retries the **same operation id** and reconciles its outcome; it never invents a replacement purchase.

Do not claim the model was compromised when it was not. The contract boundary is proven independently.

### Scenario D — dropped response and recovery

Click **Run scenario D** on the 0.03/0.02 task. The API deliberately enables the `drop_execute_response` fault for this run only.

The worker submits `execute`, then a labelled fault discards the successful client response. The database records `PAYOUT_PENDING`/recovery-needed and the job is retried after 8 seconds.

**Observe:**

- The timeline contains `Demo fault: the execute response was dropped after submission.` / `demo.fault_injected`. It is labelled, never hidden.
- Within a few seconds the same run succeeds. Recovery reads the original operation from chain, sees `paid`, and retrieves the provider's stored result.
- There is exactly **one** operation for the task, with the same operation ID before and after recovery.
- Operation drawer: payment **Paid**, delivery **Delivered**, payout attempts `1`, one `EXECUTE` transaction record.
- Budget: spent `0.02`, available `0.01`; the provider balance increased once by 0.02.

If recovery takes longer, click **Check status** in the operation drawer or refresh the task. Do not start another scenario on the same task to “retry” the payment.

### Explicit worker-restart rehearsal (optional but recommended)

For this rehearsal, do **not** let `pnpm dev` own the worker. Start the worker in its own terminal:

```bash
pnpm dev:worker
```

The other services can run normally. Keep only this one worker process.

1. Start scenario D and wait for the **labelled fault** event in the timeline.
2. Within the 8-second retry delay, stop the worker with `Ctrl-C`.
3. Wait at least 10 seconds. The job remains queued in PostgreSQL.
4. Restart it:

   ```bash
   pnpm dev:worker
   ```

5. The worker claims the same job and `resumeIfSettled()` finds the already-paid operation, retrieves the stored result and finishes the run.

**Expected:** identical operation ID, `payout_attempts = 1`, one provider balance increase, **no second execute transaction**. This is restart recovery, not a new purchase.

If you miss the 8-second window, the automatic retry still demonstrates recovery from a dropped response, but not a process restart. Create a fresh task and repeat.

The general guarantee is **at-most-once payout through the contract, plus cooperative provider deduplication and stored results**. It is not a claim of universal exactly-once execution across the chain and an off-chain service.

---

## 7. Independently verify the chain state

The sandbox has no public explorer. Read the contract directly with `near-api-js`. From the repository root, load the generated environment and run:

```bash
set -a
. ./.env
[ -f .env.local ] && . ./.env.local
set +a

TASK_ID="<chain task id from the task header>"
OP_ID="<operation id from the operation drawer>"

TASK_ID="$TASK_ID" OP_ID="$OP_ID" node --input-type=module - <<'JS'
import { JsonRpcProvider } from "near-api-js";

const provider = new JsonRpcProvider({ url: process.env.NEAR_RPC_URL });
const contractId = process.env.POOLGUARD_CONTRACT_ID;

const operation = await provider.callFunction({
  contractId,
  method: "get_operation",
  args: { task_id: process.env.TASK_ID, operation_id: process.env.OP_ID },
});
const budget = await provider.callFunction({
  contractId,
  method: "get_budget",
  args: { task_id: process.env.TASK_ID },
});
const providerAccount = await provider.viewAccount({ accountId: process.env.PROVIDER_ACCOUNT_ID });

console.log(JSON.stringify({ operation, budget, providerBalanceYocto: providerAccount.amount }, null, 2));
JS
```

For scenario D, assert:

- `operation.payment_state === "paid"`.
- `operation.payout_attempts === 1`.
- `budget.invariant_holds === true`.
- `budget.spent` increased by exactly the service price once.

On testnet, the same operation ID and transaction hashes can be inspected at `https://testnet.nearblocks.io/txns/<hash>`. On sandbox, the RPC view above is the authoritative evidence; there is no public explorer.

---

## 8. Short spoken demo script (~2 minutes)

> “PoolGuard is a shared task budget for multiple AI agents, enforced by a NEAR contract.
>
> Here an owner creates one supplier-review task and funds 0.05 testNEAR. Two agents each have a separate worker account and a restricted function-call key. The key can call only the purchase methods; it cannot change the policy or attach funds.
>
> In scenario A, both agents buy the document extraction service. Each reserves 0.02, the contract checks the shared pool, the provider and the cap, and each pays exactly once. The provider independently verifies finalized payment and returns structured supplier data.
>
> Scenario B is the important one. The budget is 0.03, and both agents ask for 0.02 at the same time. The contract serializes the reservations: one wins, the other gets a structured denial. It can fall back to a cheaper 0.005 service, but it cannot overdraw the pool.
>
> Scenario C puts an instruction in the document telling the agent to redirect payment. That text is untrusted evidence, never an instruction. The model may ignore it. Separately, we send a labelled adversarial request to a provider that is not allowlisted — and the contract rejects it with `PROVIDER_NOT_ALLOWED`. The boundary does not depend on the model behaving.
>
> Scenario D drops the execute response after the node accepted it. A timeout is not treated as failure. The worker restarts, reads the original operation from chain, sees it was paid, and fetches the stored result. Same operation ID, one payout attempt, no second payment.
>
> Payment and delivery stay separate states. Every claim here is testnet-only and not audited.”

---

## 9. Draft X post — **NOT PUBLISHED**

> One task budget. Multiple agents. Enforced on-chain.
>
> PoolGuard lets AI agents buy document tools from a shared NEAR budget. The contract blocks overspending, duplicate payouts and unapproved vendors — and recovers after a dropped response.
>
> Testnet prototype. Not audited.
>
> #NEAR #AI

Do not post this without the explicit confirmation required by `HACKATHON.md`. Do not add claims of production readiness, audited status, real users or mainnet deployment.

---

## 10. Cleanup

Stop the demo lab and app processes with `Ctrl-C`, then stop the sandbox and PostgreSQL. Running processes from this repository include:

- `pnpm dev` (or the four `dev:*` processes).
- `node scripts/sandbox.mjs`.
- `node scripts/local-postgres.mjs`, or `docker compose down` for the Docker database.

Do not kill processes by broad name patterns; stop the terminal/process you started. If a process was backgrounded, identify its PID and stop that PID.

The generated `.env.local` contains local-only keys and is gitignored. Leave it for a repeat demo, or remove it when finished. Stopping the sandbox makes those accounts unreachable.

---

## 11. Fresh-run reset (destructive, local only)

Use this when the sandbox was restarted or you want clean evidence:

1. Stop the app stack, sandbox, and PostgreSQL.
2. Remove the stale sandbox environment:

   ```bash
   rm -f .env.local
   ```

3. Reset the local database and re-apply migrations:

   ```bash
   set -a
   . ./.env
   set +a
   pnpm --filter @poolguard/db db:reset
   ```

   `db:reset` is `prisma migrate reset --force`; it deletes local tasks, operations, results and audit events. Never run it against a database you care about.

4. Restart PostgreSQL if you stopped it, start a **new** sandbox, then seed and start the apps:

   ```bash
   node scripts/sandbox.mjs          # terminal A; keep running
   pnpm db:seed                      # terminal B
   pnpm dev                          # terminal B
   ```

5. Sign in again with **Use sandbox session** and create fresh tasks.

If you use Docker and want to remove the database volume too:

```bash
docker compose down -v
```

That deletes the local PostgreSQL data volume. It is not required for a normal reset.
