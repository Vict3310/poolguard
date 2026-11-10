"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import type { Meta, Session } from "@/lib/types";

interface AuthContextValue {
  session: Session | null;
  meta: Meta | null;
  loading: boolean;
  error: string | null;
  authenticated: boolean;
  accountId: string | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  startDevSession: () => Promise<void>;
  devSessionPending: boolean;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({
    queryKey: ["session"],
    queryFn: () => api<Session>("/auth/session"),
    staleTime: 15_000,
    retry: 1,
  });
  const metaQuery = useQuery({
    queryKey: ["meta"],
    queryFn: () => api<Meta>("/meta"),
    staleTime: 60_000,
    retry: 1,
  });
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["session"] });
    await queryClient.invalidateQueries();
  }, [queryClient]);

  const signOut = React.useCallback(async () => {
    await api("/auth/logout", { method: "POST" });
    queryClient.clear();
    await queryClient.invalidateQueries({ queryKey: ["session"] });
  }, [queryClient]);

  const devMutation = useMutation({
    mutationFn: () => api<Session>("/dev/session", { method: "POST" }),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries();
    },
    onError: (mutationError) => {
      setError(mutationError instanceof Error ? mutationError.message : "Sandbox session failed");
    },
  });

  const startDevSession = React.useCallback(async () => {
    setError(null);
    await devMutation.mutateAsync();
  }, [devMutation]);

  const session = sessionQuery.data ?? null;
  const value: AuthContextValue = {
    session,
    meta: metaQuery.data ?? null,
    loading: sessionQuery.isLoading || metaQuery.isLoading,
    error:
      error ??
      (sessionQuery.error instanceof ApiError
        ? sessionQuery.error.message
        : metaQuery.error instanceof ApiError
          ? metaQuery.error.message
          : null),
    authenticated: Boolean(session?.authenticated),
    accountId: session?.user?.accountId ?? null,
    refresh,
    signOut,
    startDevSession,
    devSessionPending: devMutation.isPending,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = React.useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
