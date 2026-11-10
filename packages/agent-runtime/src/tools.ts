import type { ToolDefinition } from "./ai.js";

/**
 * Tool arguments are intentionally tiny. The model never supplies a recipient,
 * amount, operation id or transaction payload. It selects a catalog service key;
 * deterministic code resolves the price, provider and operation id from trusted
 * server state, and the contract enforces the policy.
 */
export const AGENT_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "inspect_catalog",
      description:
        "List the services this task may buy, with fixed prices and the remaining shared budget.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "request_quote",
      description:
        "Request a fixed-price quote for one catalog service. This does not spend money.",
      parameters: {
        type: "object",
        properties: {
          service_key: { type: "string", description: "Exact service_key from the catalog" },
        },
        required: ["service_key"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reserve_purchase",
      description:
        "Reserve shared task budget for a service before paying. May be denied by policy or by other agents already reserving the budget.",
      parameters: {
        type: "object",
        properties: {
          service_key: { type: "string" },
        },
        required: ["service_key"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "execute_purchase",
      description:
        "Dispatch payment for the active reservation of a service. At most one payout can happen per purchase. If the response is lost, the operation can be recovered.",
      parameters: {
        type: "object",
        properties: {
          service_key: { type: "string" },
        },
        required: ["service_key"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "retrieve_result",
      description:
        "Retrieve the stored provider result for a paid operation. The provider verifies finalized on-chain payment.",
      parameters: {
        type: "object",
        properties: {
          service_key: { type: "string" },
        },
        required: ["service_key"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "finish",
      description:
        "Finish this agent's work with a short factual summary. Never claim a payment or delivery that did not happen.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "At most 600 characters" },
        },
        required: ["summary"],
        additionalProperties: false,
      },
    },
  },
];

export const AGENT_TOOL_NAMES = AGENT_TOOL_DEFINITIONS.map((tool) => tool.function.name);
