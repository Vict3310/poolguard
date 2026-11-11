import { z } from "zod";
import { isYoctoString } from "./amount.js";
import { paymentStateSchema, fulfillmentStateSchema } from "./states.js";

export const ACCOUNT_ID_REGEX = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export const accountIdSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(ACCOUNT_ID_REGEX, "Not a valid lowercase NEAR account id");

export const taskChainIdSchema = z
  .string()
  .min(3)
  .max(48)
  .regex(/^[a-z0-9_-]+$/, "Use lowercase letters, digits, dash and underscore");

export const hex64Schema = z.string().regex(/^[0-9a-f]{64}$/, "Expected 32-byte lowercase hex");

export const yoctoStringSchema = z
  .string()
  .refine(isYoctoString, "Expected a canonical non-negative integer string");

export const networkSchema = z.enum(["sandbox", "testnet"]);

export const contractReserveRequestSchema = z.object({
  task_id: taskChainIdSchema,
  operation_id: hex64Schema,
  agent_id: accountIdSchema,
  provider_id: accountIdSchema,
  amount: yoctoStringSchema,
  service_id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9._:-]+$/),
  request_hash: hex64Schema,
  output_schema_hash: hex64Schema,
  policy_version: z.number().int().min(1),
  expires_at_block: z.number().int().positive(),
});
export type ContractReserveRequest = z.infer<typeof contractReserveRequestSchema>;

export const contractPolicyInputSchema = z.object({
  max_per_operation: yoctoStringSchema,
  allowed_providers: z.array(accountIdSchema).max(8),
  reservation_ttl_blocks: z.number().int().min(1).max(100_000),
  expires_at_block: z.number().int().positive(),
});
export type ContractPolicyInput = z.infer<typeof contractPolicyInputSchema>;

export const chainAgentViewSchema = z.object({
  account_id: accountIdSchema,
  public_key: z.string().min(1),
  active: z.boolean(),
  registered_at_block: z.number().int().nonnegative(),
});

export const chainPolicyViewSchema = z.object({
  max_per_operation: yoctoStringSchema,
  allowed_providers: z.array(accountIdSchema),
  reservation_ttl_blocks: z.number().int(),
  expires_at_block: z.number().int(),
  policy_version: z.number().int(),
});

export const chainTaskViewSchema = z.object({
  task_id: z.string(),
  owner: accountIdSchema,
  name: z.string(),
  created_at_block: z.number().int().nonnegative(),
  paused: z.boolean(),
  policy: chainPolicyViewSchema,
  agents: z.array(chainAgentViewSchema),
  total_funded: yoctoStringSchema,
  available: yoctoStringSchema,
  reserved: yoctoStringSchema,
  spent: yoctoStringSchema,
  withdrawn: yoctoStringSchema,
  withdrawal_pending: yoctoStringSchema,
  operation_count: z.number().int(),
  max_operations: z.number().int(),
  pending_withdrawals: z.number().int(),
});
export type ChainTaskView = z.infer<typeof chainTaskViewSchema>;

export const chainOperationViewSchema = z.object({
  operation_id: hex64Schema,
  task_id: z.string(),
  agent_id: accountIdSchema,
  agent_public_key: z.string(),
  provider_id: accountIdSchema,
  amount: yoctoStringSchema,
  service_id: z.string(),
  request_hash: hex64Schema,
  output_schema_hash: hex64Schema,
  policy_version: z.number().int(),
  created_at_block: z.number().int(),
  expires_at_block: z.number().int(),
  reservation_expires_at_block: z.number().int(),
  payment_state: paymentStateSchema,
  payout_attempts: z.number().int(),
  settled_at_block: z.number().int().nullable(),
});
export type ChainOperationView = z.infer<typeof chainOperationViewSchema>;

export const chainBudgetViewSchema = z.object({
  task_id: z.string(),
  total_funded: yoctoStringSchema,
  available: yoctoStringSchema,
  reserved: yoctoStringSchema,
  spent: yoctoStringSchema,
  withdrawn: yoctoStringSchema,
  withdrawal_pending: yoctoStringSchema,
  max_per_operation: yoctoStringSchema,
  policy_version: z.number().int(),
  invariant_holds: z.boolean(),
  accounted_total: yoctoStringSchema,
});
export type ChainBudgetView = z.infer<typeof chainBudgetViewSchema>;

export const chainConfigViewSchema = z.object({
  contract_id: accountIdSchema,
  owner: accountIdSchema,
  max_agents: z.number().int(),
  max_providers: z.number().int(),
  max_operations_per_task: z.number().int(),
  // Optional so a projection read from an older deployment still parses.
  max_operations_per_agent: z.number().int().optional(),
  max_pending_withdrawals: z.number().int(),
  task_storage_deposit: yoctoStringSchema,
  agent_storage_deposit: yoctoStringSchema,
  withdrawal_storage_deposit: yoctoStringSchema,
});
export type ChainConfigView = z.infer<typeof chainConfigViewSchema>;

// ---------------------------------------------------------------- provider wire

export const evidenceSchema = z.object({
  line: z.number().int().positive(),
  quote: z.string().max(400),
});

export const supplierExtractionSchema = z.object({
  schema_version: z.literal("1.0.0"),
  service_key: z.string(),
  supplier: z.object({
    name: z.string().nullable(),
    confidence: z.number().min(0).max(1),
    evidence: z.array(evidenceSchema).max(12),
  }),
  products: z
    .array(
      z.object({
        name: z.string(),
        quantity: z.string().nullable(),
        unit: z.string().nullable(),
        evidence: z.array(evidenceSchema).max(6),
      }),
    )
    .max(40),
  quotes: z
    .array(
      z.object({
        amount: z.string(),
        currency: z.string(),
        raw: z.string(),
        evidence: z.array(evidenceSchema).max(6),
      }),
    )
    .max(20),
  delivery: z.object({
    terms: z.array(z.string()).max(20),
    evidence: z.array(evidenceSchema).max(12),
  }),
  missing_fields: z.array(z.string()).max(20),
  warnings: z.array(z.string()).max(20),
  document: z.object({
    label: z.string(),
    sha256: hex64Schema,
    characters: z.number().int().nonnegative(),
    lines: z.number().int().nonnegative(),
  }),
  processed_at: z.string(),
  engine: z.string(),
});
export type SupplierExtraction = z.infer<typeof supplierExtractionSchema>;

/** Machine-readable output contract for the extraction service. Its hash is bound
 * into every operation, so a provider changing the shape changes the operation id. */
export const SUPPLIER_EXTRACTION_JSON_SCHEMA = {
  title: "poolguard.supplier-extraction",
  version: "1.0.0",
  type: "object",
  required: [
    "supplier",
    "products",
    "quotes",
    "delivery",
    "missing_fields",
    "warnings",
    "document",
  ],
  properties: {
    supplier: {
      type: "object",
      properties: {
        name: { type: ["string", "null"] },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        evidence: { type: "array" },
      },
    },
    products: { type: "array" },
    quotes: { type: "array" },
    delivery: { type: "object" },
    missing_fields: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } },
    document: { type: "object" },
  },
  additionalProperties: true,
} as const;

export const serviceCatalogEntrySchema = z.object({
  provider_account_id: accountIdSchema,
  service_id: z.string(),
  service_key: z.string(),
  name: z.string(),
  description: z.string(),
  price_yocto: yoctoStringSchema,
  output_schema_hash: hex64Schema,
  version: z.string(),
  engine: z.string(),
  operator_controlled: z.boolean(),
  active: z.boolean(),
});
export type ServiceCatalogEntry = z.infer<typeof serviceCatalogEntrySchema>;

export const quoteRequestSchema = z.object({
  service_key: z.string().min(1).max(64),
  document_label: z.string().min(1).max(120),
  document_text: z.string().min(1).max(80_000),
});
export type QuoteRequest = z.infer<typeof quoteRequestSchema>;

export const quoteResponseSchema = z.object({
  quote_id: z.string(),
  service_key: z.string(),
  service_id: z.string(),
  provider_account_id: accountIdSchema,
  price_yocto: yoctoStringSchema,
  output_schema_hash: hex64Schema,
  request_hash: hex64Schema,
  document_sha256: hex64Schema,
  expires_at: z.string(),
  pricing: z.literal("fixed_catalog"),
});
export type QuoteResponse = z.infer<typeof quoteResponseSchema>;

export const providerAuthSchema = z.object({
  agent_account_id: accountIdSchema,
  public_key: z.string().min(1),
  signature_base64: z.string().min(1).max(200),
  issued_at: z.string(),
  nonce: z.string().min(16).max(128),
  /**
   * "ed25519" (default): raw signature over the challenge digest, from a key the
   * worker holds. "nep413": a NEP-413 signed message whose text is the digest in
   * hex, used by custody wallets (OutLayer) that never expose a private key.
   */
  scheme: z.enum(["ed25519", "nep413"]).optional(),
});
export type ProviderAuth = z.infer<typeof providerAuthSchema>;

export const purchaseRequestSchema = z.object({
  operation_id: hex64Schema,
  task_id: taskChainIdSchema,
  service_key: z.string().min(1).max(64),
  request_hash: hex64Schema,
  output_schema_hash: hex64Schema,
  document_label: z.string().min(1).max(120),
  document_text: z.string().min(1).max(80_000),
  auth: providerAuthSchema,
});
export type PurchaseRequest = z.infer<typeof purchaseRequestSchema>;

export const providerResultResponseSchema = z.object({
  operation_id: hex64Schema,
  status: z.enum(["processing", "delivered", "delivery_failed"]),
  request_hash: hex64Schema,
  output_schema_hash: hex64Schema,
  result: supplierExtractionSchema.nullable(),
  delivered_at: z.string().nullable(),
  attempts: z.number().int(),
  note: z.string().nullable(),
});
export type ProviderResultResponse = z.infer<typeof providerResultResponseSchema>;

export const catalogResponseSchema = z.object({
  provider_account_id: accountIdSchema,
  network: networkSchema,
  contract_id: accountIdSchema,
  pricing: z.literal("fixed_catalog"),
  services: z.array(serviceCatalogEntrySchema),
});
export type CatalogResponse = z.infer<typeof catalogResponseSchema>;

// ------------------------------------------------------------------------ misc

export const paymentViewSchema = z.object({
  state: paymentStateSchema,
  attempts: z.number().int(),
  settledAtBlock: z.number().int().nullable(),
});

export const fulfillmentViewSchema = z.object({
  state: fulfillmentStateSchema,
  deliveredAt: z.string().nullable(),
  hasResult: z.boolean(),
});

export const taskObjectiveSchema = z.string().trim().min(10).max(280);
export const taskNameSchema = z.string().trim().min(3).max(80);
export const documentLabelSchema = z.string().trim().min(1).max(120);
export const documentTextSchema = z.string().min(1).max(80_000);

export const rateLimitErrorSchema = z.object({
  error: z.string(),
  retryAfterSeconds: z.number().int().optional(),
});
