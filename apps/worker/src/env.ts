/**
 * Loads `.env`, an explicit testnet overlay (or `.env.testnet`) and, only
 * outside production/testnet, the generated `.env.local` sandbox file.
 */
export { loadRootEnv } from "@poolguard/shared/env";
