import "dotenv/config";
import { z } from "zod";

// small helpers
const trim = (s?: string | null) => (s ?? "").trim();
const stripTrailingSlashes = (s?: string | null) => trim(s).replace(/\/+$/,"");

const EnvSchema = z.object({
  // existing
  NODE_ENV: z.enum(["development","test","production"]).default("development"),
  PORT: z.string().default("4000"),
  RPC_URL: z.string().min(1, "RPC_URL required"),
  PRIVATE_KEY: z.string().min(1, "PRIVATE_KEY required"),
  SESSION_VAULT: z.string().min(1, "SESSION_VAULT address required"),
  MERCHANT_ADDRESS: z.string().min(1, "MERCHANT_ADDRESS required"),

  // optional LLM fallback
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),

  // 🚀 Blockscout MCP (primary)
  // URL is optional for local dev; if empty we'll skip MCP and fall back to OpenAI/plain.
  BLOCKSCOUT_MCP_URL: z.string().optional()
    .transform(stripTrailingSlashes), // ensure no trailing slash
  BLOCKSCOUT_MCP_API_KEY: z.string().optional(),
})
  // normalize a couple fields after parse (e.g., default model)
  .transform((env) => ({
    ...env,
    OPENAI_MODEL: env.OPENAI_MODEL || "gpt-4o-mini",
  }));

export const ENV = EnvSchema.parse(process.env);
