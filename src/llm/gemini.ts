// src/llm/gemini.ts
import { GoogleGenAI } from "@google/genai";
import type { ClassifyInput, ClassifyResult, LLMProvider } from "./provider.js";

const MODEL = "gemini-3.5-flash";

export function parseClassifyJson(text: string): ClassifyResult {
  const obj = JSON.parse(text) as Record<string, unknown>;
  // recall bias: missing/unknown important => treat as important+suspicious
  const importantGiven = typeof obj.important === "boolean";
  const important = importantGiven ? (obj.important as boolean) : true;
  const suspicious = typeof obj.suspicious === "boolean" ? (obj.suspicious as boolean) : !importantGiven;
  const reason = typeof obj.reason === "string" ? obj.reason : "";
  return { important, suspicious, reason };
}

function prompt(i: ClassifyInput): string {
  const rules = i.memoryIndex.map(m => `- ${m.description}`).join("\n") || "(none yet)";
  return [
    "You decide whether a new email deserves the user's attention NOW.",
    "Bias toward IMPORTANT when unsure (set suspicious=true for borderline cases).",
    "Bulk/marketing/notifications are usually NOT important; personal, transactional,",
    "financial, security, and human-reply emails usually ARE.",
    `Learned preferences:\n${rules}`,
    `Email:\nFrom: ${i.email.from}\nSubject: ${i.email.subject}\nSnippet: ${i.email.snippet}`,
    `Signals: bulk=${i.risk.bulk} transactional=${i.risk.transactional}`,
    'Reply ONLY as JSON: {"important":bool,"suspicious":bool,"reason":string}',
  ].join("\n\n");
}

export function geminiProvider(apiKey: string): LLMProvider {
  const ai = new GoogleGenAI({ apiKey });
  return {
    async classifyImportance(input) {
      const res = await ai.models.generateContent({
        model: MODEL,
        contents: prompt(input),
        config: { responseMimeType: "application/json", temperature: 0 },
      });
      return parseClassifyJson(res.text ?? "");
    },
  };
}
