import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Always load server/.env (works even when npm is started from repo root)
dotenv.config({ path: path.join(__dirname, "..", "..", ".env") });

const provider = (process.env.AI_PROVIDER || "openai").toLowerCase().trim();

const config = {
  provider,
  port: Number(process.env.PORT || 4000),
  models: {
    openai: process.env.OPENAI_MODEL || "gpt-4o-mini",
    openrouter: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
    gemini: process.env.GEMINI_MODEL || "gemini-2.0-flash",
  },
  keys: {
    openai: process.env.OPENAI_API_KEY || "",
    openrouter: process.env.OPENROUTER_API_KEY || "",
    gemini: process.env.GEMINI_API_KEY || "",
  },
};

export function getActiveAiConfig() {
  const p = config.provider;
  if (!["openai", "openrouter", "gemini"].includes(p)) {
    throw new Error(`Invalid AI_PROVIDER "${p}". Use openai | openrouter | gemini`);
  }
  const key = config.keys[p];
  if (!key || !String(key).trim()) {
    throw new Error(
      `Missing API key for provider "${p}". Set ${
        p === "openai"
          ? "OPENAI_API_KEY"
          : p === "openrouter"
            ? "OPENROUTER_API_KEY"
            : "GEMINI_API_KEY"
      } in server/.env`
    );
  }
  return {
    provider: p,
    model: config.models[p],
    apiKey: key.trim(),
  };
}

export default config;
