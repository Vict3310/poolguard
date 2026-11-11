"use client";

import * as React from "react";
import { api, ApiError } from "@/lib/api";
import { feedback } from "@/lib/feedback";
import { ensureWalletAccount, getWalletSelector, signMessageWithWallet } from "@/lib/wallet";
import type { Challenge, Session } from "@/lib/types";

/**
 * idle → connecting (pick a wallet, fetch the challenge) → review (show the exact
 * message) → signing → verifying → success. The user always sees what they sign.
 */
export type SignInStage = "idle" | "connecting" | "review" | "signing" | "verifying" | "success" | "error";

export const STAGE_COPY: Record<"connecting" | "signing" | "verifying" | "success", string> = {
  connecting: "Waiting for your wallet…",
  signing: "Approve the sign-in message in your wallet…",
  verifying: "Verifying the signature…",
  success: "Signed in",
};

export function friendlySignInError(error: unknown): string {
  if (error instanceof ApiError && error.code === "ACCOUNT_NOT_ALLOWED") return error.message;
  if (error instanceof ApiError && error.code === "ACCOUNT_SUSPENDED") return error.message;
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

export function useWalletSignIn(onSignedIn: (accountId: string) => Promise<void> | void) {
  const [stage, setStage] = React.useState<SignInStage>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [errorCode, setErrorCode] = React.useState<string | null>(null);
  const [challenge, setChallenge] = React.useState<(Challenge & { accountId: string }) | null>(null);

  const fail = (signInError: unknown) => {
    setStage("error");
    setError(friendlySignInError(signInError));
    setErrorCode(signInError instanceof ApiError ? signInError.code : null);
    feedback("error");
  };

  /** Step 1: choose a wallet and fetch the challenge, then pause for review. */
  const signIn = React.useCallback(async () => {
    setError(null);
    setErrorCode(null);
    setStage("connecting");
    try {
      const selector = await getWalletSelector();
      const wallet = await ensureWalletAccount(selector);
      const account = (await wallet.getAccounts())[0];
      if (!account) throw new Error("No wallet account was selected.");
      const next = await api<Challenge>("/auth/challenge", {
        method: "POST",
        body: JSON.stringify({ account_id: account.accountId }),
      });
      setChallenge({ ...next, accountId: account.accountId });
      setStage("review");
    } catch (signInError) {
      fail(signInError);
    }
  }, []);

  /** Step 2: the user has read the exact message; ask the wallet to sign it. */
  const confirm = React.useCallback(async () => {
    if (!challenge) return;
    setStage("signing");
    try {
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
      fail(signInError);
    }
  }, [challenge, onSignedIn]);

  const reset = React.useCallback(() => {
    setStage("idle");
    setError(null);
    setErrorCode(null);
    setChallenge(null);
  }, []);

  return {
    stage,
    error,
    errorCode,
    challenge,
    signIn,
    confirm,
    reset,
    busy: stage === "connecting" || stage === "signing" || stage === "verifying",
  };
}
