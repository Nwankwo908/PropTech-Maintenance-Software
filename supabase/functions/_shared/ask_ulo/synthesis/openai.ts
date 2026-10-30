import { observeAiJson } from "../../ai/telemetry.ts";
import { withAiDeadline } from '../../ai/deadline.ts'
/**
 * OpenAI synthesis — model call, prompts (via buildPrompt), temperature.
 */

import { ASK_ULO_ANSWER_MODEL, buildAskUloPrompt } from "./buildPrompt.ts";
import type { AskUloTokenUsage, AskUloToolPackets } from "./toolPackets.ts";

export const ANSWER_MODEL = ASK_ULO_ANSWER_MODEL;

function stripJsonFence(s: string): string {
  const t = s.trim();
  const m = t.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return m ? m[1].trim() : t;
}

export async function synthesizeWithOpenAI(
  apiKey: string,
  packets: AskUloToolPackets,
  options: { timeoutMs?: number; promptVariant?: 'full' | 'compact' } = {},
): Promise<
  { text: string; usage: AskUloTokenUsage | null; synthesizeMs: number } | null
> {
  const prompt = buildAskUloPrompt(packets, options.promptVariant);
  const started = Date.now();
  const { response: res, data } = await withAiDeadline(options.timeoutMs ?? 12000, (signal) => observeAiJson<{
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  }>(
    {
      traceId: crypto.randomUUID(),
      operation: "ask_ulo.synthesize",
      model: prompt.model,
      attempt: 1,
    },
    () =>
      fetch("https://api.openai.com/v1/chat/completions", {
        signal,
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: prompt.model,
          // Keep the answer in message.content. Sol spends the token budget on
          // reasoning unless effort is none.
          reasoning_effort: "none",
          max_completion_tokens: 4096,
          messages: prompt.messages,
        }),
      }),
    (value) => Boolean(value?.choices?.[0]?.message?.content?.trim()),
  ));
  if (!res.ok) {
    return null;
  }
  const content = data?.choices?.[0]?.message?.content;
  if (!content?.trim()) return null;

  const usageRaw = data?.usage;
  const usage: AskUloTokenUsage | null = usageRaw
    ? {
      promptTokens: typeof usageRaw.prompt_tokens === "number"
        ? usageRaw.prompt_tokens
        : null,
      completionTokens: typeof usageRaw.completion_tokens === "number"
        ? usageRaw.completion_tokens
        : null,
      totalTokens: typeof usageRaw.total_tokens === "number"
        ? usageRaw.total_tokens
        : null,
    }
    : null;

  return {
    text: stripJsonFence(content).trim(),
    usage,
    synthesizeMs: Date.now() - started,
  };
}
