/**
 * Minimal OpenAI-compatible chat-completions client with tool schemas.
 * Deliberately not an agent framework: the loop, validation and authorization live
 * in deterministic code in agent.ts.
 */
import { z } from "zod";

export interface ChatToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: RawToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface RawToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AiCompletion {
  content: string | null;
  toolCalls: ChatToolCall[];
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  model: string;
  finishReason: string | null;
}

export class AiConfigurationError extends Error {
  override name = "AiConfigurationError";
}

export class AiRequestError extends Error {
  override name = "AiRequestError";
  constructor(message: string, readonly status: number | null) {
    super(message);
  }
}

const responseSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({
          content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                id: z.string(),
                type: z.literal("function"),
                function: z.object({ name: z.string(), arguments: z.string() }),
              }),
            )
            .optional(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
    })
    .optional(),
});

export interface AiClientOptions {
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
  timeoutMs: number;
}

export class OpenAiCompatibleClient {
  constructor(private readonly options: AiClientOptions) {}

  configured(): boolean {
    return Boolean(this.options.apiKey && this.options.apiKey.trim());
  }

  async complete(input: {
    messages: ChatMessage[];
    tools: ToolDefinition[];
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
  }): Promise<AiCompletion> {
    if (!this.configured()) {
      throw new AiConfigurationError(
        "AI_NOT_CONFIGURED: set AI_API_KEY (and optionally AI_BASE_URL / AI_MODEL) to run live agents",
      );
    }
    const url = `${this.options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    const onAbort = () => controller.abort();
    input.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify({
          model: this.options.model,
          messages: input.messages,
          tools: input.tools,
          tool_choice: "auto",
          temperature: input.temperature ?? 0,
          max_tokens: input.maxTokens ?? 700,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = (await response.text()).slice(0, 600);
        throw new AiRequestError(
          `AI provider returned ${response.status}: ${body.replace(/\s+/g, " ")}`,
          response.status,
        );
      }
      const parsed = responseSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new AiRequestError("AI provider returned an unexpected response shape", response.status);
      }
      const choice = parsed.data.choices[0]!;
      return {
        content: choice.message.content ?? null,
        toolCalls: (choice.message.tool_calls ?? []).map((call) => ({
          id: call.id,
          name: call.function.name,
          argumentsJson: call.function.arguments,
        })),
        usage: {
          promptTokens: parsed.data.usage?.prompt_tokens ?? 0,
          completionTokens: parsed.data.usage?.completion_tokens ?? 0,
          totalTokens: parsed.data.usage?.total_tokens ?? 0,
        },
        model: parsed.data.model ?? this.options.model,
        finishReason: choice.finish_reason ?? null,
      };
    } catch (error) {
      if (error instanceof AiConfigurationError || error instanceof AiRequestError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new AiRequestError("AI request timed out or was cancelled", null);
      }
      throw new AiRequestError(
        `AI request failed: ${error instanceof Error ? error.message : String(error)}`,
        null,
      );
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", onAbort);
    }
  }
}
