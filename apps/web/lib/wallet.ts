"use client";

import type { WalletSelector } from "@near-wallet-selector/core";
import { transactions } from "near-api-js";
import type { TxPlan } from "@/lib/types";

let selectorPromise: Promise<WalletSelector> | null = null;
let modalPromise: Promise<{ show: () => void; hide: () => void }> | null = null;

export async function getWalletSelector(): Promise<WalletSelector> {
  if (selectorPromise) return selectorPromise;
  selectorPromise = (async () => {
    const [
      { setupWalletSelector },
      { setupMeteorWallet },
      { setupHereWallet },
      { setupNightly },
      { setupSender },
    ] = await Promise.all([
      import("@near-wallet-selector/core"),
      import("@near-wallet-selector/meteor-wallet"),
      import("@near-wallet-selector/here-wallet"),
      import("@near-wallet-selector/nightly"),
      import("@near-wallet-selector/sender"),
    ]);
    return setupWalletSelector({
      network: "testnet",
      // Sender and Nightly are the broadest testnet browser wallets; Meteor
      // and HERE remain for users already signed in there.
      modules: [setupSender(), setupNightly(), setupMeteorWallet(), setupHereWallet()],
    });
  })();
  return selectorPromise;
}

export async function getWalletModal(selector: WalletSelector) {
  if (modalPromise) return modalPromise;
  modalPromise = (async () => {
    const { setupModal } = await import("@near-wallet-selector/modal-ui");
    return setupModal(selector, {
      contractId: process.env.NEXT_PUBLIC_POOLGUARD_CONTRACT_ID ?? "poolguard.testnet",
      theme: "dark",
    });
  })();
  return modalPromise;
}

export async function ensureWalletAccount(selector: WalletSelector) {
  if (selector.store.getState().accounts.length === 0) {
    const modal = await getWalletModal(selector);
    await new Promise<void>((resolve, reject) => {
      const subscription = selector.store.observable.subscribe((state) => {
        if (state.accounts.length > 0) {
          subscription.unsubscribe();
          resolve();
        }
      });
      const timer = setTimeout(() => {
        subscription.unsubscribe();
        reject(new Error("Wallet selection timed out."));
      }, 180_000);
      void timer;
      modal.show();
    });
    (await getWalletModal(selector)).hide();
  }
  return selector.wallet();
}

function toGasYocto(gasTgas: number): string {
  return (BigInt(gasTgas) * 1_000_000_000_000n).toString();
}

/**
 * Convert a server-built plan into wallet actions. The server decides method,
 * arguments and deposits; the wallet only authorizes the exact displayed plan.
 */
export async function signAndSendPlan(plan: TxPlan): Promise<string> {
  const selector = await getWalletSelector();
  const wallet = await ensureWalletAccount(selector);
  // Wallet Selector 10 re-exports its own @near-js/transactions copy; the runtime
  // Action shape is identical, but the duplicated type identities differ.
  const walletActions = plan.actions.map((action) =>
    transactions.functionCall(
      action.method_name,
      action.args,
      BigInt(toGasYocto(action.gas_tgas)),
      BigInt(action.deposit_yocto),
    ),
  ) as unknown as Parameters<typeof wallet.signAndSendTransaction>[0]["actions"];
  const result = (await wallet.signAndSendTransaction({
    receiverId: plan.receiver_id,
    actions: walletActions,
  })) as unknown as
    | { transaction?: { hash?: string } }
    | Array<{ transaction?: { hash?: string } }>;
  const outcome = Array.isArray(result) ? result[result.length - 1] : result;
  const hash = outcome?.transaction?.hash;
  if (!hash) throw new Error("Wallet did not return a transaction hash.");
  return hash;
}

export async function signMessageWithWallet(challenge: {
  message: string;
  recipient: string;
  nonce: string;
}): Promise<{ accountId: string; publicKey: string; signature: string }> {
  const selector = await getWalletSelector();
  const wallet = await ensureWalletAccount(selector);
  const signer = wallet as unknown as {
    signMessage?: (input: {
      message: string;
      recipient: string;
      nonce: Uint8Array;
    }) => Promise<{ accountId: string; publicKey: string; signature: string | Uint8Array }>;
  };
  if (typeof signer.signMessage !== "function") {
    throw new Error("This wallet does not support signMessage (NEP-413).");
  }
  const nonce = Uint8Array.from(atob(challenge.nonce), (char) => char.charCodeAt(0));
  const signed = await signer.signMessage({
    message: challenge.message,
    recipient: challenge.recipient,
    nonce,
  });
  const signature =
    typeof signed.signature === "string"
      ? signed.signature
      : btoa(String.fromCharCode(...signed.signature));
  return { accountId: signed.accountId, publicKey: signed.publicKey, signature };
}
