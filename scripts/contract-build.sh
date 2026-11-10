#!/usr/bin/env bash
# Reproducible WASM build for the PoolGuard contract.
# The contract is a plain near-sdk cdylib, so cargo is sufficient; cargo-near is
# optional and not required on a fresh machine.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$ROOT/contracts/poolguard/Cargo.toml"
OUT="$ROOT/contracts/poolguard/res/poolguard.wasm"

if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo is required. Install Rust: https://rustup.rs" >&2
  exit 1
fi

if ! rustup target list --installed 2>/dev/null | grep -qx wasm32-unknown-unknown; then
  echo "Adding the wasm32-unknown-unknown target…"
  rustup target add wasm32-unknown-unknown
fi

# Run from the contract directory so its .cargo/config.toml applies the
# `--cfg near` flag that near-sdk needs for host bindings and panic messages.
cd "$ROOT/contracts/poolguard"
cargo build --manifest-path "$MANIFEST" --target wasm32-unknown-unknown --release --locked

mkdir -p "$(dirname "$OUT")"
cp "$ROOT/contracts/poolguard/target/wasm32-unknown-unknown/release/poolguard.wasm" "$OUT"

SIZE="$(wc -c <"$OUT" | tr -d ' ')"
echo "Built $OUT (${SIZE} bytes)"
