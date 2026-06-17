import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TypedConfigService } from "../../../config/typed-config.service";
import {
  PromptBuildInput,
  PromptBuildOutput,
  RagHistoryTurn,
  RetrievedChunk,
} from "../types";

const FALLBACK_TEMPLATE =
  '你是五邑大学国际教育学院招生智能问答助手。\n# 严格基于参考资料回答;资料未覆盖则回复"暂无相关信息"。\n参考资料:\n${retrieved_chunks}\n禁答规则:\n${forbidden_rules}';

const CANDIDATE_PATHS = [
  join(__dirname, "system.txt"),
  join(process.cwd(), "src", "modules", "rag", "prompts", "system.txt"),
  join(process.cwd(), "dist", "src", "modules", "rag", "prompts", "system.txt"),
];

const CHARS_PER_TOKEN = 4;

@Injectable()
export class PromptBuilder implements OnModuleInit {
  private readonly logger = new Logger(PromptBuilder.name);
  private systemTemplate = "";

  constructor(private readonly cfg: TypedConfigService) {}

  onModuleInit(): void {
    const loaded = this.loadTemplate();
    if (loaded) {
      this.systemTemplate = loaded;
      this.logger.log("system prompt template loaded successfully");
      return;
    }
    this.logger.warn(
      "system prompt template not found in any candidate path, using fallback",
    );
    this.systemTemplate = FALLBACK_TEMPLATE;
  }

  private loadTemplate(): string | null {
    for (const p of CANDIDATE_PATHS) {
      try {
        if (existsSync(p)) {
          return readFileSync(p, "utf8");
        }
      } catch (err) {
        this.logger.warn(
          `failed to read system template at ${p}: ${(err as Error).message}`,
        );
      }
    }
    return null;
  }

  build(input: PromptBuildInput): PromptBuildOutput {
    const maxTokens = Math.max(256, this.cfg.rag.maxContextTokens);

    const chunksBlock = this.formatChunks(input.retrievedChunks ?? []);
    const forbiddenSummary =
      input.forbiddenSummary?.trim() || "默认禁答规则已开启";
    const system = this.replacePlaceholders(this.systemTemplate, {
      retrieved_chunks: chunksBlock || "（无相关参考片段）",
      forbidden_rules: forbiddenSummary,
    });

    const user = this.truncateToTokens(this.composeUser(input), maxTokens);
    const systemTrimmed = this.truncateToTokens(system, maxTokens);

    return { system: systemTrimmed, user };
  }

  private formatChunks(chunks: RetrievedChunk[]): string {
    if (chunks.length === 0) return "";
    return chunks
      .map(
        (c, i) =>
          `[${i + 1}] 文件:${c.filename || "(未知)"} 片段#${c.index} 相关度:${c.score.toFixed(3)}\n${c.content.trim()}`,
      )
      .join("\n\n");
  }

  private composeUser(input: PromptBuildInput): string {
    const parts: string[] = [];
    const history = (input.history ?? []).filter(
      (h): h is RagHistoryTurn =>
        !!h && typeof h.content === "string" && h.content.length > 0,
    );
    if (history.length > 0) {
      parts.push("# 多轮对话历史");
      for (const h of history) {
        const label =
          h.role === "user" ? "用户" : h.role === "assistant" ? "助手" : "系统";
        parts.push(`${label}:${h.content}`);
      }
      parts.push("");
    }
    if (input.faqAnswer) {
      parts.push("# 候选 FAQ 答案(供你参考或直接采用)");
      parts.push(input.faqAnswer.trim());
      parts.push("");
    }
    parts.push("# 用户当前问题");
    parts.push(input.question.trim());
    return parts.join("\n");
  }

  private replacePlaceholders(
    template: string,
    values: Record<string, string>,
  ): string {
    return template.replace(/\$\{(\w+)\}/g, (_, key: string) =>
      Object.prototype.hasOwnProperty.call(values, key)
        ? values[key]
        : `\${${key}}`,
    );
  }

  private truncateToTokens(text: string, maxTokens: number): string {
    if (!text) return text;
    const maxChars = maxTokens * CHARS_PER_TOKEN;
    if (text.length <= maxChars) return text;
    const tail = "\n…(上下文过长已截断)";
    const headBudget = Math.max(0, maxChars - tail.length);
    return text.slice(0, headBudget) + tail;
  }
}
