import { ConfigurationError, loadServerConfig, type ServerConfig } from "@poolguard/agent-runtime";

export type WorkerConfig = ServerConfig;

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const config = loadServerConfig(env);
  if (config.workerAccounts.length === 0) {
    throw new ConfigurationError(
      "At least one worker account is required: WORKER_ONE_ACCOUNT_ID and WORKER_ONE_PRIVATE_KEY",
    );
  }
  if (!config.documentEncryptionKey) {
    throw new ConfigurationError("DOCUMENT_ENCRYPTION_KEY is required to read assigned documents");
  }
  if (config.workerConcurrency > config.workerAccounts.length) {
    // Concurrency is allowed (a single key may run several jobs sequentially), but
    // only one process may sign with a given key at a time. Warn via the value.
    return { ...config, workerConcurrency: Math.min(config.workerConcurrency, 4) };
  }
  return config;
}
