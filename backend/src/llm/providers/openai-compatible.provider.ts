import { Injectable, Logger } from "@nestjs/common";
import { Readable } from "node:stream";
import axios, { AxiosError, AxiosInstance } from "axios";
import { createParser } from "eventsource-parser";
import {
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ChatChunk,
  EmbeddingProviderConfig,
  EmbeddingResponse,
  LlmProvider,
  LlmProviderConfig,
} from "../types";

export interface UpstreamError extends Error {
  status?: number;
  body?: unknown;
  code?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isTimeout(err: unknown): boolean {
  if (axios.isAxiosError(err)) {
    return (
      err.code === "ECONNABORTED" ||
      err.code === "ETIMEDOUT" ||
      err.message.toLowerCase().includes("timeout")
    );
  }
  return false;
}

function buildChatBody(
  options: ChatOptions,
  model: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: options.messages.map<ChatMessage>((m) => ({
      role: m.role,
      content: m.content,
      name: m.name,
    })),
    stream: options.stream === true,
  };
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;
  if (options.topP !== undefined) body.top_p = options.topP;
  if (options.stop !== undefined && options.stop.length > 0)
    body.stop = options.stop;
  return body;
}

@Injectable()
export class OpenAiCompatibleProvider {
  private readonly logger = new Logger(OpenAiCompatibleProvider.name);

  private buildClient(timeoutMs: number): AxiosInstance {
    return axios.create({
      timeout: timeoutMs,
      validateStatus: () => true,
    });
  }

  private toUpstreamError(
    err: unknown,
    fallbackMessage: string,
  ): UpstreamError {
    if (axios.isAxiosError(err)) {
      const ax = err as AxiosError<unknown>;
      const wrapped: UpstreamError = new Error(
        ax.response?.status
          ? `Upstream HTTP ${ax.response.status}: ${typeof ax.response.data === "string" ? ax.response.data.slice(0, 200) : ax.message || fallbackMessage}`
          : ax.message || fallbackMessage,
      ) as UpstreamError;
      wrapped.status = ax.response?.status;
      wrapped.body = ax.response?.data;
      wrapped.code = ax.code;
      return wrapped;
    }
    const wrapped: UpstreamError = new Error(
      (err as Error)?.message ?? fallbackMessage,
    );
    return wrapped;
  }

  private chatUrl(baseUrl: string): string {
    return `${baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
  }

  private embedUrl(baseUrl: string): string {
    return `${baseUrl.replace(/\/+$/, "")}/v1/embeddings`;
  }

  private authHeaders(apiKey: string): Record<string, string> {
    return {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  private isRetryableStatus(status: number | undefined): boolean {
    return status === undefined || status >= 500;
  }

  async chat(
    provider: LlmProvider,
    config: LlmProviderConfig,
    options: ChatOptions,
  ): Promise<ChatResponse> {
    const url = this.chatUrl(config.baseUrl);
    const body = buildChatBody(options, config.model);
    const client = this.buildClient(config.timeoutMs);
    try {
      const res = await client.post<unknown>(url, body, {
        headers: this.authHeaders(config.apiKey),
        signal: options.signal,
      });
      if (res.status < 200 || res.status >= 300) {
        const err: UpstreamError = new Error(
          `Upstream HTTP ${res.status}`,
        ) as UpstreamError;
        err.status = res.status;
        err.body = res.data;
        throw err;
      }
      return this.parseChatResponse(res.data, provider, config);
    } catch (err) {
      const upstream = this.toUpstreamError(err, "chat request failed");
      if (!upstream.status && isTimeout(err)) {
        (upstream as UpstreamError).code = (err as AxiosError).code;
      }
      throw upstream;
    }
  }

  chatStream(
    provider: LlmProvider,
    config: LlmProviderConfig,
    options: ChatOptions,
  ): AsyncIterable<ChatChunk> {
    return this.streamInternal(provider, config, options);
  }

  private async *streamInternal(
    provider: LlmProvider,
    config: LlmProviderConfig,
    options: ChatOptions,
  ): AsyncIterable<ChatChunk> {
    const url = this.chatUrl(config.baseUrl);
    const body = buildChatBody({ ...options, stream: true }, config.model);
    const client = this.buildClient(config.timeoutMs);

    let response: Awaited<ReturnType<typeof client.post<Readable>>>;
    try {
      response = await client.post<Readable>(url, body, {
        headers: {
          ...this.authHeaders(config.apiKey),
          Accept: "text/event-stream",
        },
        responseType: "stream",
        signal: options.signal,
      });
    } catch (err) {
      throw this.toUpstreamError(err, "stream request failed");
    }

    if (response.status < 200 || response.status >= 300) {
      const stream = response.data;
      if (stream && typeof (stream as Readable).on === "function") {
        (stream as Readable).destroy();
      }
      const err: UpstreamError = new Error(
        `Upstream HTTP ${response.status}`,
      ) as UpstreamError;
      err.status = response.status;
      throw err;
    }

    const stream = response.data as Readable;
    const queue: ChatChunk[] = [];
    const waiterRef: { current: (() => void) | null } = { current: null };
    let done = false;
    let streamError: Error | null = null;
    let finalUsage: ChatChunk["usage"] | undefined;

    const wake = (): void => {
      const w = waiterRef.current;
      waiterRef.current = null;
      w?.();
    };

    const parser = createParser((event) => {
      if (event.type !== "event") return;
      const data = event.data;
      if (!data) return;
      if (data === "[DONE]") {
        done = true;
        wake();
        return;
      }
      try {
        const json: unknown = JSON.parse(data);
        if (!isRecord(json)) return;
        const usage = json.usage;
        if (isRecord(usage)) {
          const prompt = Number(usage.prompt_tokens ?? 0);
          const completion = Number(usage.completion_tokens ?? 0);
          const total = Number(usage.total_tokens ?? prompt + completion);
          finalUsage = {
            promptTokens: Number.isFinite(prompt) ? prompt : 0,
            completionTokens: Number.isFinite(completion) ? completion : 0,
            totalTokens: Number.isFinite(total) ? total : 0,
          };
        }
        const choices = json.choices;
        if (!Array.isArray(choices) || choices.length === 0) return;
        const choice = choices[0];
        if (!isRecord(choice)) return;
        const delta = choice.delta;
        const content =
          isRecord(delta) && typeof delta.content === "string"
            ? delta.content
            : "";
        const finishReasonRaw = choice.finish_reason;
        const finishReason =
          typeof finishReasonRaw === "string" && finishReasonRaw.length > 0
            ? finishReasonRaw
            : undefined;
        if (content || finishReason) {
          queue.push({ content, finishReason });
          wake();
        }
      } catch {
        // ignore malformed SSE chunk
      }
    });

    (async () => {
      try {
        for await (const chunk of stream) {
          parser.feed((chunk as Buffer).toString("utf8"));
        }
      } catch (e) {
        streamError = this.toUpstreamError(e, "stream read failed");
      } finally {
        done = true;
        wake();
      }
    })();

    try {
      while (true) {
        if (queue.length > 0) {
          const next = queue.shift()!;
          if (next.usage) {
            finalUsage = next.usage;
          }
          yield next;
        } else if (streamError) {
          throw streamError;
        } else if (done) {
          return;
        } else {
          await new Promise<void>((resolve) => {
            waiterRef.current = resolve;
          });
        }
      }
    } finally {
      if (!stream.destroyed) stream.destroy();
    }
  }

  async embed(
    config: EmbeddingProviderConfig,
    texts: string[],
  ): Promise<EmbeddingResponse> {
    if (texts.length === 0) {
      return {
        items: [],
        model: config.model,
        dim: config.dim,
        usage: { promptTokens: 0, totalTokens: 0 },
      };
    }
    const url = this.embedUrl(config.baseUrl);
    const client = this.buildClient(config.timeoutMs);
    try {
      const res = await client.post<unknown>(
        url,
        { model: config.model, input: texts },
        { headers: this.authHeaders(config.apiKey) },
      );
      if (res.status < 200 || res.status >= 300) {
        const err: UpstreamError = new Error(
          `Upstream HTTP ${res.status}`,
        ) as UpstreamError;
        err.status = res.status;
        err.body = res.data;
        throw err;
      }
      return this.parseEmbedResponse(res.data, config);
    } catch (err) {
      throw this.toUpstreamError(err, "embed request failed");
    }
  }

  private parseChatResponse(
    data: unknown,
    provider: LlmProvider,
    config: LlmProviderConfig,
  ): ChatResponse {
    if (!isRecord(data)) {
      throw new Error("Invalid chat response: not an object");
    }
    const choices = data.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      throw new Error("Invalid chat response: no choices");
    }
    const first = choices[0];
    if (!isRecord(first))
      throw new Error("Invalid chat response: malformed choice");
    const message = first.message;
    const content =
      isRecord(message) && typeof message.content === "string"
        ? message.content
        : "";
    const finishReasonRaw = first.finish_reason;
    const finishReason =
      typeof finishReasonRaw === "string" && finishReasonRaw.length > 0
        ? finishReasonRaw
        : undefined;
    const usage = data.usage;
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    if (isRecord(usage)) {
      promptTokens = Number(usage.prompt_tokens ?? 0) || 0;
      completionTokens = Number(usage.completion_tokens ?? 0) || 0;
      totalTokens =
        Number(usage.total_tokens ?? promptTokens + completionTokens) || 0;
    }
    const model = typeof data.model === "string" ? data.model : config.model;
    return {
      content,
      finishReason,
      usage: { promptTokens, completionTokens, totalTokens },
      model,
      provider,
    };
  }

  private parseEmbedResponse(
    data: unknown,
    config: EmbeddingProviderConfig,
  ): EmbeddingResponse {
    if (!isRecord(data))
      throw new Error("Invalid embed response: not an object");
    const list = data.data;
    if (!Array.isArray(list))
      throw new Error("Invalid embed response: no data array");
    const items = list
      .map((entry) => {
        if (!isRecord(entry)) return null;
        const index = Number(entry.index);
        const embeddingRaw = entry.embedding;
        if (!Array.isArray(embeddingRaw)) return null;
        const embedding = embeddingRaw.map((v) => Number(v));
        if (
          !Number.isFinite(index) ||
          embedding.some((v) => !Number.isFinite(v))
        )
          return null;
        return { index, embedding };
      })
      .filter((v): v is { index: number; embedding: number[] } => v !== null)
      .sort((a, b) => a.index - b.index);
    const usage = data.usage;
    let promptTokens = 0;
    let totalTokens = 0;
    if (isRecord(usage)) {
      promptTokens = Number(usage.prompt_tokens ?? 0) || 0;
      totalTokens = Number(usage.total_tokens ?? promptTokens) || 0;
    }
    const model = typeof data.model === "string" ? data.model : config.model;
    const dim = items[0]?.embedding.length ?? config.dim;
    return {
      items: items.map((it) => ({ index: it.index, embedding: it.embedding })),
      model,
      dim,
      usage: { promptTokens, totalTokens },
    };
  }
}

export type { LlmProvider };
