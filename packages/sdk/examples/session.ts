/**
 * Runnable SDK example — no frontend required.
 *
 * Local sandbox:
 *   1. pnpm sandbox:up
 *   2. pnpm dev:api
 *   3. pnpm --filter @poolguard/sdk example
 *
 * Reads a task and its on-chain budget, then watches durable activity. Set
 * POOLGUARD_EXAMPLE_PURCHASE=1 to reserve and buy the extraction service with the
 * first registered agent (spends sandbox testNEAR).
 */
import { PoolGuard, PoolGuardApiError } from "../src/index.js";

const baseUrl = process.env.API_ORIGIN ?? "http://127.0.0.1:4100";
const guard = new PoolGuard({ baseUrl });

async function main() {
  await guard.devSession();
  const session = await guard.session();
  console.log(`Signed in as ${session.user?.accountId ?? "unknown"}`);

  const summaries = await guard.listTasks();
  if (summaries.length === 0) {
    console.log("No tasks. Create one in the app or run the sandbox seed first.");
    return;
  }
  const taskId = process.env.POOLGUARD_TASK_ID ?? summaries[0]!.id;
  const task = await guard.getTask(taskId);
  const budget = await guard.getBudget(taskId);
  console.log(
    JSON.stringify(
      {
        task: task.name,
        status: task.status,
        chainTaskId: task.chainTaskId,
        availableYocto: budget.available,
        reservedYocto: budget.reserved,
        spentYocto: budget.spent,
        fundedYocto: budget.total_funded,
        invariantHolds: budget.invariant_holds,
        source: "contract view",
      },
      null,
      2,
    ),
  );

  const watch = guard.watchTask(taskId, (event) => {
    console.log(`[event ${event.id}] ${event.type}: ${event.summary}`);
  });
  await new Promise((resolve) => setTimeout(resolve, 1_500));

  if (process.env.POOLGUARD_EXAMPLE_PURCHASE === "1") {
    const agent = task.agents.find((candidate) => candidate.status === "registered" && candidate.keyConfigured);
    const document = task.documents[0];
    if (!agent || !document) {
      console.log("No runnable agent or document.");
    } else {
      const reservation = await guard.reservePurchase(task.id, {
        agentAccountId: agent.accountId,
        serviceKey: "doc-extract",
        documentId: document.id,
      });
      console.log(`Reserved operation ${reservation.operation_id} (${reservation.payment_state})`);
      const execution = await guard.executePurchase(reservation.operation_id);
      console.log(`Payment ${execution.payment_state}; transaction ${execution.tx_hash}`);

      for (let attempt = 0; attempt < 20; attempt += 1) {
        const operation = await guard.getOperation(reservation.operation_id);
        console.log(`operation ${operation.paymentState} / delivery ${operation.fulfillmentState}`);
        if (operation.paymentState === "paid") {
          try {
            const result = await guard.getResult(reservation.operation_id);
            console.log(`Supplier: ${result.supplier.name ?? "unknown"}`);
            console.log(`Quotes: ${result.quotes.map((quote) => `${quote.amount} ${quote.currency}`).join(", ")}`);
          } catch (error) {
            if (error instanceof PoolGuardApiError && error.code === "RESULT_NOT_READY") {
              console.log("Waiting for provider delivery…");
            } else {
              throw error;
            }
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
    }
  }

  watch.close();
}

main().catch((error) => {
  if (error instanceof PoolGuardApiError) {
    console.error(`API ${error.status} ${error.code ?? ""}: ${error.message}`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
