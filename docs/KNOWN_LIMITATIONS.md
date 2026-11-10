# Known limitations

PoolGuard is an experimental NEAR hackathon prototype. The limitations below are
intentional for the MVP; they are not hidden behind mock success paths. If a
capability is unavailable, the API or UI reports that state instead of inventing
a transaction, balance or result.

## Environment and safety

- **Testnet/sandbox only.** The application is designed for local NEAR sandbox
  and NEAR testnet. It is not deployed to mainnet and has no mainnet configuration.
- **Not audited.** The Rust contract, API, worker, provider and web app have not
  been audited. Do not custody real value with them.
- **No monetary value.** All displayed balances are test tokens with no monetary
  value. The UI repeats this on the workspace and landing pages.
- **No production authentication review.** The browser wallet path uses NEP-413,
  but the reproducible sandbox demo uses an explicitly labelled development
  session because sandbox accounts cannot be signed by a testnet wallet. The dev
  session is gated to `LOCAL_SANDBOX_MODE=true`,
  `ALLOW_DEV_SESSION=true` and `NODE_ENV!=production`; enabling it publicly would
  be a serious misconfiguration.
- **Browser wallet flow is not fully exercised here.** The local environment has
  no funded NEAR testnet product account or wallet session for an end-to-end
  owner-signed testnet setup. Sender, Nightly, Meteor and HERE are wired for
  testnet, but the tested journeys use the sandbox session and real sandbox
  transactions. Treat the wallet path as reviewed code, not as a demonstrated
  live testnet flow, until it is run with a funded account.
- **Local sandbox evidence is not public chain evidence.** Sandbox transaction
  hashes are recorded and queryable from the local RPC, but they have no public
  explorer page. Only a testnet deployment produces publicly inspectable
  transactions.
- **The testnet preflight is read-only.** `pnpm testnet:preflight` and
  `pnpm testnet:verify` can validate configuration, accounts, the deployed WASM
  hash, full-access-key removal, owner storage balance, restricted access keys,
  secure-cookie and dev-session metadata, the provider catalog binding and live
  services, but they cannot create accounts, add access keys, deploy the contract
  or sign transactions. Those steps require `near-cli`, key custody and explicit
  confirmation outside the app.
- **`.env.local` is sandbox-only.** The services refuse to start in production or
  testnet mode when `.env.local` exists, because it contains local sandbox keys and
  could silently override deployed configuration. Use `.env` plus `.env.testnet`
  (or `POOLGUARD_ENV_FILE`) on testnet hosts.

## AI and agent autonomy

- **Live model mode requires `AI_API_KEY`.** If the key is absent, the API starts
  runs in a clearly labelled `scripted` fixture mode. In that mode the contract,
  reservations, payouts, provider verification and accounting are real, but the
  model is not called and no live AI execution should be claimed. The API
  response and UI both state this distinction.
- **Inference cost is outside the task budget.** PoolGuard controls purchases
  routed through its contract. It does not meter or cap the owner's AI provider
  charges. `AI_API_KEY` and model costs are separate.
- **Bounded autonomy, not general autonomy.** Runs are limited to eight model
  steps, 5,000 reported tokens, 180 seconds and a small tool set. A run can stop
  `partial` at a limit. There is no long-running planning, sub-agent hierarchy,
  self-modification or arbitrary tool creation.
- **Model output is not authoritative.** The model picks a catalog `service_key`
  and writes a summary. Deterministic code makes the reservation and payment.
  The model cannot change policy, funding, recipients or transaction payloads.
  A model can still be manipulated into choosing a permitted but expensive
  service or writing a misleading narrative.
- **Scenario C is partly a contract probe.** The adversarial document is shown
  as untrusted text, and a separately labelled request attempts a non-allowlisted
  provider. A rejection proves the contract boundary; it does not prove the model
  resisted the prompt injection in a live run.

## Payments, accounting and recovery

- **No refunds, disputes or chargebacks.** A settled payout is final. A failed
  transfer releases the reservation, but there is no owner- or provider-initiated
  refund workflow. Fulfillment failures do not automatically reverse payment.
- **No universal exactly-once fulfillment.** The contract provides at-most-once
  payout per operation id. Provider deduplication and stored results are
  cooperative. A provider crash before storing a result can cause recomputation;
  a lost result can require retry.
- **Timeouts are not failure proofs.** A `payout_pending` operation can only be
  settled or released by its callback. There is deliberately no owner escape
  hatch. A callback that never executes leaves the operation pending, and its
  funds remain reserved.
- **Provider results share the application database.** The MVP runs the provider
  against the same PostgreSQL instance as the API. It is not an independent
  custody boundary. The provider is operator-controlled and trusted to store and
  return the correct result.
- **Fixed-price trusted catalog.** Prices are seeded catalog values; quotes are
  not cryptographically signed. A provider quote is an informational fixed price,
  and the contract enforces the amount in the operation. There is no dynamic
  pricing, bidding or marketplace discovery.
- **Deterministic extraction, not a paid LLM extraction service.** The paid
  supplier-document service uses a deterministic `rules-v1` extractor that finds
  supplier fields, amounts, delivery terms and evidence lines. It is a real
  service that processes the supplied document and returns structured data, but
  it is not an LLM-based document model and can miss unusual formats.
- **No mainnet tokens, stablecoins, Intents or Chain Signatures.** The MVP uses
  native testNEAR only. There is no custom token, stablecoin, cross-chain intent,
  chain signature, trading or general merchant checkout.
- **No reputation or public agent marketplace.** Agents and providers are
  configured per task. There is no reputation token, public provider discovery,
  arbitration or general agent-to-agent market.
- **Bounded records are permanent in this MVP.** Tasks are limited to 32
  operations (at most 16 per agent), 6 agents, 8 allowed providers and 3 pending
  withdrawals. Storage deposits are non-refundable; only an amount attached above the
  required deposit is returned. A worker can exhaust its own 16 operation slots with
  cancelled or expired reservations, but not the other agents'; the owner can revoke
  that worker, and must create a new task once all slots are used.
- **Single-process API and provider guards.** Identical purchase requests are
  serialized, per-account worker-transaction quotas are counted, and provider
  authorization nonces are remembered in process memory. Running several API or
  provider instances needs a shared store (database rows or advisory locks) for these
  guards.
- **Withdrawal callbacks have no manual recovery.** A pending withdrawal resolves
  only when its transfer callback runs. At most three can be pending per task.

## Keys and operations

- **Worker restricted keys live in server environment variables.** They are
  function-call keys scoped to the PoolGuard contract, not owner keys, but a host
  or process compromise can read them. There is no HSM, KMS, key rotation or
  per-process key isolation.
- **Sandbox owner key exists only for local setup.** `SANDBOX_OWNER_PRIVATE_KEY`
  lets the gated local setup helper create, fund and register a sandbox task
  without a browser wallet. It must never be configured for testnet or
  production. The application does not otherwise hold an owner key.
- **Contract deploy/upgrade authority is outside the app.** Whoever controls the
  contract account can replace the code. That is the highest trust assumption in
  any deployment and is not governed by the PoolGuard contract.
- **The model and backend see document plaintext.** Documents are encrypted at
  rest, but the API/worker decrypt them to run the task and the model receives
  the assigned document. Database access plus the encryption key is equivalent
  to document access.
- **Provider and RPC endpoints are trusted configuration.** The backend does not
  accept user-supplied URLs. A compromised provider, RPC or AI endpoint can lie
  about results or availability.

## Product and UI

- **One service category.** The only paid category is supplier-document
  extraction, with two fixed-price services. This is enough to demonstrate a real
  purchase, not a general tool marketplace.
- **No general checkout or arbitrary recipients.** The recipient must be an
  allowlisted provider and the payload must match the service catalog.
- **The landing-page product window is illustrative.** It is visibly labelled as
  sample data, not live chain evidence. Live task, operation and activity screens
  use real API data.
- **No mobile native app or offline mode.** The responsive web app targets
  browsers; it depends on the API, RPC and provider being reachable.
- **No hosted demo or submission.** The repository contains setup scripts and
  demo instructions. Publishing, deploying to a public host, posting on X and
  submitting the hackathon entry are human decisions and were not performed.

## Deliberately out of scope

Mainnet, custom tokens, stablecoins, NEAR Intents, Chain Signatures, token
trading, arbitrary-depth agent hierarchies, general merchant checkout, public
agent marketplaces, reputation tokens, general dispute arbitration, confidential
computing and a custom authentication system are not implemented. Extension
points are intentionally small rather than speculative infrastructure.
