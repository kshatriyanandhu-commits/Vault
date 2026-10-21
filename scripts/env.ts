/**
 * Loads environment variables for CLI scripts. Import this module before any
 * module that reads process.env (import order is preserved by ESM evaluation).
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

export {};
