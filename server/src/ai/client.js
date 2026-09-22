import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getActiveAiConfig } from "./config.js";

function extractJson(text) {
  if (!text) throw new Error("Empty AI response");
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error("AI did not return valid JSON");
  }
}

async function chatOpenAICompatible({ apiKey, baseURL, model, system, user, json, maxTokens }) {
  const client = new OpenAI({ apiKey, baseURL });
  const res = await client.chat.completions.create({
    model,
    temperature: 0.2,
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
    ...(json ? { response_format: { type: "json_object" } } : {}),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  return res.choices?.[0]?.message?.content || "";
}

async function chatGemini({ apiKey, model, system, user, json, maxTokens }) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const gm = genAI.getGenerativeModel({
    model,
    systemInstruction: system,
    generationConfig: {
      temperature: 0.2,
      ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
      ...(json ? { responseMimeType: "application/json" } : {}),
    },
  });
  const result = await gm.generateContent(user);
  return result.response.text();
}

/**
 * Unified chat — provider from env (openai | openrouter | gemini)
 */
export async function aiChat({ system, user, json = true, maxTokens } = {}) {
  const { provider, model, apiKey } = getActiveAiConfig();
  let text = "";

  if (provider === "openai") {
    text = await chatOpenAICompatible({
      apiKey,
      model,
      system,
      user,
      json,
      maxTokens,
    });
  } else if (provider === "openrouter") {
    text = await chatOpenAICompatible({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      model,
      system,
      user,
      json,
      maxTokens,
    });
  } else if (provider === "gemini") {
    text = await chatGemini({ apiKey, model, system, user, json, maxTokens });
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  if (json) return extractJson(text);
  return text;
}

export function getProviderInfo() {
  try {
    const { provider, model } = getActiveAiConfig();
    return { provider, model, configured: true };
  } catch (e) {
    return {
      provider: process.env.AI_PROVIDER || "openai",
      model: null,
      configured: false,
      error: e.message,
    };
  }
}
