"use client";

import * as React from "react";
import { api } from "@/lib/api";
import { feedback } from "@/lib/feedback";
import { ensureWalletAccount, getWalletSelector, signMessageWithWallet } from "@/lib/wallet";
import type { Challenge, Session } from "@/lib/types";

export type SignInStage = "idle" | "connecting" | "signing" | "verifying" | "success" | "error";

export const STAGE_COPY: Record<Exclude<SignInStage, "idle" | "error">, string> = {
  connecting: "Waiting for your wallet…",
  signing: "Approve the sign-in message in your wallet…",
  verifying: "Verifying the signature…",
  success: "Signed in",
};

export function friendlySignInError(error: unknown): string {
  if (error instanceof Error) {
    if (/not supported|signMessage/i.test(error.message)) {
      return "This wallet can’t sign messages (NEP-413). Try Sender, Nightly, Meteor or HERE.";
    }
    if (/reject|denied|cancel|closed/i.test(error.message)) {
      return "You cancelled the signature. Nothing was signed and nothing was spent.";
    }
    if (/timed out/i.test(error.message)) {
      return "The wallet didn’t respond in time. Open it and try again.";
    }
    if (/network|testnet|sandbox/i.test(error.message)) return error.message;
    return error.message.slice(0, 240);
  }
  return "Wallet sign-in failed. Try again.";
}

/** Walks the NEP-413 sign-in and reports each stage so the UI can show progress. */
export function useWalletSignIn(onSignedIn: (accountId: string) => Promise<void> | void) {
  const [stage, setStage] = React.useState<SignInStage>("idle");
  const [error, setError] = React.useState<string | null>(null);

  const signIn = React.useCallback(async () => {
    setError(null);
    setStage("connecting");
    try {
      const selector = await getWalletSelector();
      const wallet = await ensureWalletAccount(selector);
      const account = (await wallet.getAccounts())[0];
      if (!account) throw new Error("No wallet account was selected.");
      const challenge = await api<Challenge>("/auth/challenge", {
        method: "POST",
        body: JSON.stringify({ account_id: account.accountId }),
      });
      setStage("signing");
      const signed = await signMessageWithWallet({
        message: challenge.message,
        recipient: challenge.recipient,
        nonce: challenge.nonce,
      });
      setStage("verifying");
      await api<Session>("/auth/verify", {
        method: "POST",
        body: JSON.stringify({
          challenge_id: challenge.challenge_id,
          account_id: signed.accountId,
          public_key: signed.publicKey,
          signature: signed.signature,
        }),
      });
      setStage("success");
      feedback("success");
      await onSignedIn(signed.accountId);
    } catch (signInError) {
      setStage("error");
      setError(friendlySignInError(signInError));
      feedback("error");
    }
  }, [onSignedIn]);

  const reset = React.useCallback(() => {
    setStage("idle");
    setError(null);
  }, []);

  return { stage, error, signIn, reset, busy: stage === "connecting" || stage === "signing" || stage === "verifying" };
}
