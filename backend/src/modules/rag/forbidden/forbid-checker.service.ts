import { Injectable, Logger } from "@nestjs/common";
import type { ForbiddenRule } from "@prisma/client";
import { PrismaService } from "../../../database/prisma.service";
import { ForbiddenCheckResult } from "../types";

const CACHE_TTL_MS = 60_000;

@Injectable()
export class ForbidChecker {
  private readonly logger = new Logger(ForbidChecker.name);
  private cache: { rules: ForbiddenRule[]; expiresAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async check(question: string): Promise<ForbiddenCheckResult> {
    const rules = await this.loadRules();
    if (rules.length === 0 || !question) {
      return { hit: false };
    }

    for (const rule of rules) {
      const hit = this.matchRule(rule, question);
      if (hit) {
        this.logger.warn(
          `forbidden rule hit: id=${rule.id} name=${rule.name} type=${rule.ruleType}`,
        );
        return {
          hit: true,
          ruleId: rule.id,
          ruleName: rule.name,
          reason: rule.name,
          reply: rule.reply ?? undefined,
        };
      }
    }
    return { hit: false };
  }

  invalidate(): void {
    this.cache = null;
  }

  private matchRule(rule: ForbiddenRule, question: string): boolean {
    if (!rule.pattern) return false;
    try {
      switch (rule.ruleType) {
        case "KEYWORD":
          return question.toLowerCase().includes(rule.pattern.toLowerCase());
        case "REGEX": {
          const re = new RegExp(rule.pattern, "i");
          return re.test(question);
        }
        case "CATEGORY":
          return question.toLowerCase().includes(rule.pattern.toLowerCase());
        default:
          return false;
      }
    } catch (err) {
      this.logger.warn(
        `forbidden rule pattern invalid: id=${rule.id} type=${rule.ruleType} err=${(err as Error).message}`,
      );
      return false;
    }
  }

  private async loadRules(): Promise<ForbiddenRule[]> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.rules;
    }
    try {
      const rules = await this.prisma.forbiddenRule.findMany({
        where: { isActive: true },
      });
      this.cache = { rules, expiresAt: now + CACHE_TTL_MS };
      return rules;
    } catch (err) {
      this.logger.error(
        `failed to load forbidden rules: ${(err as Error).message}`,
      );
      // 规则加载失败时 fail-open:不阻断请求,避免禁答规则表挂了导致整体不可用
      return [];
    }
  }
}
