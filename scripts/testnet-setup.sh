#!/usr/bin/env bash
# PoolGuard testnet setup. Run it yourself, from the repository root:
#
#   bash scripts/testnet-setup.sh
#
# It creates the missing provider and worker accounts (testnet faucet), deploys and
# initializes the contract, gives each worker a restricted function-call key derived
# from .env.testnet, and removes the workers' full-access keys.
#
# Every on-chain step is printed first and waits for your "y". Steps that are
# already done are skipped, so it is safe to re-run. Testnet NEAR has no value.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="${POOLGUARD_ENV_FILE:-.env.testnet}"
[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE"; exit 1; }
get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'"; }

CONTRACT="$(get POOLGUARD_CONTRACT_ID)"
PROVIDER="$(get PROVIDER_ACCOUNT_ID)"
W1="$(get WORKER_ONE_ACCOUNT_ID)"
W2="$(get WORKER_TWO_ACCOUNT_ID)"
WASM="contracts/poolguard/res/poolguard.wasm"
METHODS="reserve, execute, cancel_reservation, expire_reservation"
ALLOWANCE="0.25 NEAR"
NET="network-config testnet"

helper() { node scripts/testnet-keys.mjs "$@"; }

confirm() {
  echo
  echo "▶ $1"
  echo "  $2"
  read -r -p "  Run this? [y/N] " answer
  [[ "$answer" == "y" || "$answer" == "Y" ]]
}

step() { echo; echo "──── $1"; }

command -v near >/dev/null || { echo "Install near-cli-rs first: cargo install near-cli-rs"; exit 1; }
[[ -f "$WASM" ]] || { echo "Build the contract first: pnpm contract:build"; exit 1; }

echo "Contract: $CONTRACT · provider: $PROVIDER · workers: $W1, $W2"
W1_PUB="$(helper worker-public-key 1)"
W2_PUB="$(helper worker-public-key 2)"
echo "Worker one restricted key: $W1_PUB"
echo "Worker two restricted key: $W2_PUB"

step "1. Accounts"
for account in "$PROVIDER" "$W1" "$W2"; do
  if [[ "$(helper account-state "$account")" == missing ]]; then
    cmd="near account create-account sponsor-by-faucet-service $account autogenerate-new-keypair --signature-scheme ed25519 save-to-keychain $NET create"
    if confirm "Create $account from the testnet faucet" "$cmd"; then eval "$cmd"; sleep 3; fi
  else
    echo "✓ $account already exists"
  fi
done

step "2. Contract"
state="$(helper account-state "$CONTRACT")"
if [[ "$state" == missing ]]; then
  echo "✗ $CONTRACT does not exist. Create it first, then re-run."; exit 1
elif [[ "$state" == "exists yes" ]]; then
  echo "✓ $CONTRACT already has code deployed (not redeploying; upgrades need their own review)"
else
  cmd="near contract deploy $CONTRACT use-file $WASM with-init-call new json-args '{}' prepaid-gas '50 Tgas' attached-deposit '0 NEAR' $NET sign-with-keychain send"
  if confirm "Deploy and initialize PoolGuard on $CONTRACT" "$cmd"; then eval "$cmd"; sleep 3; fi
fi

step "3. Restricted worker keys"
for pair in "$W1|$W1_PUB" "$W2|$W2_PUB"; do
  account="${pair%%|*}"; pub="${pair##*|}"
  if [[ "$(helper account-state "$account")" == missing ]]; then echo "✗ $account missing; skipping"; continue; fi
  if [[ "$(helper has-key "$account" "$pub")" == yes ]]; then
    echo "✓ $account already has its restricted key"
  else
    cmd="near account add-key $account grant-function-call-access --allowance '$ALLOWANCE' --contract-account-id $CONTRACT --function-names '$METHODS' use-manually-provided-public-key $pub $NET sign-with-keychain send"
    if confirm "Add the restricted PoolGuard key to $account" "$cmd"; then eval "$cmd"; sleep 3; fi
  fi
done

step "4. Remove worker full-access keys"
echo "  The deployment gate requires workers to hold ONLY the restricted key."
echo "  After this the worker accounts cannot be administered (that is the point)."
for pair in "$W1|$W1_PUB" "$W2|$W2_PUB"; do
  account="${pair%%|*}"; pub="${pair##*|}"
  if [[ "$(helper has-key "$account" "$pub")" != yes ]]; then
    echo "✗ $account has no restricted key yet; keeping its full-access key"; continue
  fi
  full="$(helper full-access-keys "$account" | tr '\n' ' ' | sed 's/ *$//')"
  if [[ -z "$full" ]]; then echo "✓ $account has no full-access key"; continue; fi
  cmd="near account delete-keys $account public-keys '$full' $NET sign-with-keychain send"
  if confirm "Delete full-access key(s) from $account" "$cmd"; then eval "$cmd"; sleep 3; fi
done

echo
echo "Done. Next, the read-only gate (move .env.local aside on this machine first):"
echo "  pnpm testnet:preflight"
