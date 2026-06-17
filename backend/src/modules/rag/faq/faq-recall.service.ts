import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { EmbeddingService } from "../../../llm/embedding.service";
import { LlmService } from "../../../llm/llm.service";
import { PromService } from "../../../common/metrics/prom.service";
import { PrismaService } from "../../../database/prisma.service";
import { FaqHit } from "../types";

interface FaqRow {
  id: string;
  question: string;
  answer: string;
  aliases?: string[];
  keywords?: string[];
  score: number;
}

const STOP_WORDS = new Set([
  "的", "了", "是", "在", "我", "有", "和", "就", "不", "人", "都", "一", "一个", "上", "也",
  "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好", "自己", "这", "那",
  "吗", "呢", "啊", "吧", "么", "什", "什么", "怎么", "如何", "哪", "里", "为", "什么",
  "the", "a", "an", "is", "are", "do", "does", "can", "i", "you", "we", "they",
]);

/** 主题同义词表 — 同一概念的不同说法合并 */
const TOPIC_SYNONYMS: Record<string, string> = {
  学费: "费用", 费用: "学费", 多少钱: "费用", 怎么收: "费用", 标准: "费用",
  雅思: "语言", 语言: "雅思", 雅思考: "雅思", 雅思成绩: "雅思", 雅思考试: "雅思",
  出国: "出境", 出境: "出国", 留学: "出国", 国外: "出国",
  毕业证: "证书", 证书: "毕业证", 毕业证书: "毕业证", 学位证: "证书", 学位证书: "学位证",
  双学位: "双证", 双证: "双学位",
  联合培养: "合作办学", 合作办学: "联合培养", 中外合作: "联合培养",
  普本: "普通本科", 普通本科: "普本", 全日制: "普本",
  转专业: "转出", 转出: "转专业", 转入: "转专业",
  学分: "课程", 课程: "学分", 衔接: "学分",
  全英文: "教学", 教学: "全英文", 上课: "教学",
  选拔: "考试", 考试: "选拔", 录取: "选拔",

  // ===== 专业名称 =====
  计算机: "计科", 计科: "计算机", 计算机科学: "计算机", CS: "计算机",
  通信: "通信工程", 通信工程: "通信", telecom: "通信",
  AI: "人工智能", 人工智能: "AI", 智能科学: "人工智能",
  英语: "english", english: "英语", 英语专业: "英语",
  会计: "会计学", 会计学: "会计", accounting: "会计",
  金融: "金融学", 金融学: "金融", finance: "金融",
  法学: "法", 法律: "法学", law: "法学",
  // ===== 院校(简称 → 全称) =====
  朴次茅斯: "portsmouth", portsmouth: "朴次茅斯", 朴茨茅斯: "朴次茅斯",
  维多利亚: "vu", vu: "维多利亚",
  沃隆港: "uow", wollongong: "沃隆港", 卧龙岗: "沃隆港",
  萨塞克斯: "sussex", sussex: "萨塞克斯",
  麦考瑞: "mq", macquarie: "麦考瑞",
  悉尼科技: "uts", uts: "悉尼科技", 悉尼科技大学: "悉尼科技",
  斯旺西: "swansea", swansea: "斯旺西",
  // ===== 国家/地区 =====
  英国: "uk", uk: "英国", 英格兰: "英国", britain: "英国",
  澳洲: "澳大利亚", 澳大利亚: "澳洲", australia: "澳大利亚",
  // ===== 概念 =====
  推免: "保研", 保研: "推免",
  地国际化: "在地国际化", 本地化: "在地国际化",
  qs: "排名", 排名: "qs",
  acca: "认证", aacsb: "认证", neas: "认证", naati: "认证", bcs: "认证",
  双学士: "双学位",
  本硕连读: "连读", 连读: "本硕连读",
};

/** 把主题词展开成同义词集(递归展开,包含所有等价词) */
function expandTopic(token: string, depth = 0): Set<string> {
  if (depth > 3) return new Set([token]);
  const set = new Set([token]);
  const syn = TOPIC_SYNONYMS[token];
  if (syn) {
    for (const t of expandTopic(syn, depth + 1)) set.add(t);
  }
  return set;
}

/**
 * 意图信号:关键词 → 意图类别。
 * 只有 2+ 字的词汇有区分力,避免"中"这种单字噪音。
 * 每个意图组的词是 OR 关系 — 命中任一词即归类。
 */
const INTENT_SIGNALS: Record<string, string[]> = {
  出国:      ["不出国", "出国", "出境", "留学", "国外", "在地国际化", "选拔", "是否要出国"],
  证书:      ["毕业证", "学位证", "证书", "双学位", "双证", "学位", "文凭"],
  学费:      ["学费", "费用", "多少钱", "收费", "学杂费"],
  语言:      ["雅思", "语言", "英语要求", "语言成绩", "雅思成绩", "语言要求"],
  转专业:    ["转专业", "转入", "转出", "换专业", "转其他"],
  招生计划:  ["招生计划", "招生人数", "计划人数", "名额", "招多少"],
  合作院校:  ["合作院校", "境外院校", "外方院校", "哪所大学", "哪所学校", "uts", "vu", "swansea", "portsmouth", "sussex", "mq", "uow"],
  课程:      ["课程", "学分", "教学", "上课", "全英文", "教学语言"],
  保研:      ["保研", "推免", "研究生", "升学"],
};

/** 从查询中检测意图类别列表(可多意图) */
function detectIntents(query: string): Set<string> {
  const lower = query.toLowerCase();
  const found = new Set<string>();
  for (const [intent, signals] of Object.entries(INTENT_SIGNALS)) {
    for (const sig of signals) {
      if (lower.includes(sig.toLowerCase())) {
        found.add(intent);
        break;
      }
    }
  }
  return found;
}

/** 检测一个 FAQ 候选覆盖哪些意图类别 */
function faqIntents(faq: FaqRow): Set<string> {
  const text = [faq.question, ...(faq.aliases ?? []), ...(faq.keywords ?? [])].join(" ").toLowerCase();
  const found = new Set<string>();
  for (const [intent, signals] of Object.entries(INTENT_SIGNALS)) {
    for (const sig of signals) {
      if (text.includes(sig.toLowerCase())) {
        found.add(intent);
        break;
      }
    }
  }
  return found;
}

/** 提取关键词:中文 2/3-gram,英文按词,过滤停用词,主题词展开 */
function extractKeywords(text: string): string[] {
  const tokens: string[] = [];
  const chineseRuns = text.match(/[一-鿿]+/g) ?? [];
  for (const run of chineseRuns) {
    // 2-gram + 3-gram
    for (let i = 0; i < run.length - 1; i++) {
      tokens.push(run.slice(i, i + 2));
    }
    for (let i = 0; i < run.length - 2; i++) {
      tokens.push(run.slice(i, i + 3));
    }
  }
  const enTokens = text
    .replace(/[一-鿿]+/g, " ")
    .split(/[\s,;.!?()]+/)
    .filter((t) => t.length >= 2);
  tokens.push(...enTokens);
  return Array.from(new Set(tokens)).filter((t) => !STOP_WORDS.has(t.toLowerCase()));
}

@Injectable()
export class FaqRecallService {
  private readonly logger = new Logger(FaqRecallService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embed: EmbeddingService,
    private readonly llm: LlmService,
    private readonly prom: PromService,
  ) {}

  async recall(
    question: string,
    _kbVersionId: string,
    threshold: number,
  ): Promise<FaqHit | null> {
    if (!question) return null;

    const minScore = Math.max(0, Math.min(1, threshold));
    this.logger.log(`faq recall: enter q="${question.slice(0, 40)}" threshold=${minScore}`);
    const endTimer = this.prom.vectorRecallDuration.startTimer({ kind: "faq" });
    try {
      // 1) 先尝试向量召回(失败不抛出,继续走关键词)
      try {
        const vectorHit = await this.vectorRecall(question, minScore);
        if (vectorHit) {
          this.logger.log(`faq vector hit: q="${question.slice(0, 30)}" → "${vectorHit.question.slice(0, 30)}"`);
          return vectorHit;
        }
        this.logger.log(`faq vector recall: no hit for q="${question.slice(0, 40)}"`);
      } catch (err) {
        this.logger.warn(
          `faq vector recall failed (fallback to keyword): ${(err as Error).message}`,
        );
      }

      // 2) 关键词兜底 — embedding 不可用时
      this.logger.log(`faq keyword recall: starting for q="${question.slice(0, 40)}"`);
      const keywordHit = await this.keywordRecall(question, minScore);
      if (keywordHit) {
        this.logger.log(`faq keyword hit: q="${question.slice(0, 30)}" → "${keywordHit.question.slice(0, 30)}"`);
        return keywordHit;
      }

      this.logger.log(`faq recall: no match for q="${question.slice(0, 40)}" (threshold=${minScore})`);
      return null;
    } finally {
      endTimer();
    }
  }

  private async vectorRecall(
    question: string,
    threshold: number,
  ): Promise<FaqHit | null> {
    const emb = await this.embed.embed([question]);
    const item = emb.items[0];
    if (!item || !item.embedding || item.embedding.length === 0) {
      return null;
    }
    const vec = Prisma.raw(`'[${item.embedding.join(",")}]'::vector`);

    // Fetch top-10 to allow intent-based filtering before rerank
    const rows = await this.prisma.$queryRaw<FaqRow[]>(Prisma.sql`
      SELECT id, question, answer, aliases, keywords,
        1 - (embedding <=> ${vec}) AS score
      FROM "FaqItem"
      WHERE "isActive" = true
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vec}
      LIMIT 10
    `);

    // Filter to those above threshold
    let candidates = rows
      .filter((r) => Number(r.score) >= threshold)
      .map((r) => ({ ...r, score: Number(r.score), final: Number(r.score), jaccard: Number(r.score), topicScore: 0, interSize: 0 }));

    if (candidates.length === 0) return null;

    // Intent-based filtering: if query has a clear intent, restrict to intent-matched FAQs.
    // This prevents "学费" FAQ hitting "招生计划" queries, "备案" FAQ hitting "不出国" queries, etc.
    const queryIntents = detectIntents(question);
    if (queryIntents.size > 0) {
      const intentMatched = candidates.filter((c) => {
        const ci = faqIntents(c);
        return [...queryIntents].some((i) => ci.has(i));
      });
      if (intentMatched.length > 0) {
        candidates = intentMatched;
      }
    }

    const top = candidates[0];
    const topScore = top.score;

    // Post intent-filter: ≥0.85 is highly reliable — return directly
    if (topScore >= 0.85 || candidates.length === 1) {
      this.bumpHitCount(top.id);
      return { faqId: top.id, question: top.question, answer: top.answer, score: topScore };
    }

    // Borderline (threshold–0.85): LLM rerank top-5 to pick the most relevant
    const topN = candidates.slice(0, Math.min(5, candidates.length));
    const reranked = await this.llmRerank(question, topN);
    if (!reranked) {
      this.logger.log(
        `faq vector-rerank: LLM said NONE for q="${question.slice(0, 30)}" (top score=${topScore.toFixed(2)})`,
      );
      return null;
    }

    this.bumpHitCount(reranked.id);
    this.logger.log(
      `faq vector-rerank: q="${question.slice(0, 30)}" → "${reranked.question.slice(0, 30)}" ` +
        `(score=${reranked.score.toFixed(3)}, intents=[${[...queryIntents].join(",")}])`,
    );
    return { faqId: reranked.id, question: reranked.question, answer: reranked.answer, score: reranked.score };
  }

  private async keywordRecall(
    question: string,
    threshold: number,
  ): Promise<FaqHit | null> {
    const queryNgrams = extractKeywords(question);
    if (queryNgrams.length === 0) return null;

    // 主题词展开:用同义词集做 SQL filter
    const topicTokens = new Set<string>();
    for (const k of queryNgrams) {
      for (const t of expandTopic(k)) {
        // 只保留 2+ 字的主题词,避免噪音
        if (t.length >= 2) topicTokens.add(t);
      }
    }

    // SQL filter:用主题词 + 长 n-gram(3+ 字)做 ILIKE,2-gram 不入 filter
    // 避免"联合""培养"等高频 2-gram 把所有 FAQ 都召回来
    const filterTokens = new Set<string>();
    for (const t of topicTokens) filterTokens.add(t);
    for (const t of queryNgrams) {
      if (t.length >= 3) filterTokens.add(t);
    }
    if (filterTokens.size === 0) return null;

    const orConditions = Array.from(filterTokens).map(
      (k) => Prisma.sql`(
        question ILIKE ${"%" + k + "%"} OR
        answer ILIKE ${"%" + k + "%"} OR
        EXISTS (SELECT 1 FROM unnest(aliases) a WHERE a ILIKE ${"%" + k + "%"}) OR
        EXISTS (SELECT 1 FROM unnest(keywords) kw WHERE kw ILIKE ${"%" + k + "%"})
      )`,
    );
    // 反向匹配:用户问题包含 alias（alias 是用户问题的子串）
    const reverseAlias = Prisma.sql`EXISTS (SELECT 1 FROM unnest(aliases) a WHERE ${question} ILIKE '%' || a || '%')`;
    const whereSql = Prisma.sql`"isActive" = true AND ((${Prisma.join(orConditions, " OR ")}) OR ${reverseAlias})`;

    const candidates = await this.prisma.$queryRaw<FaqRow[]>(Prisma.sql`
      SELECT id, question, answer, aliases, keywords, 0.0 AS score
      FROM "FaqItem"
      WHERE ${whereSql}
      LIMIT 30
    `);

    // 反向 alias 匹配:用户问题包含 alias（alias 是用户问题的子串）
    // 用应用层做，因为 Prisma 参数化在 ILIKE 拼接里不工作
    const allActiveFaqs = await this.prisma.$queryRaw<FaqRow[]>(Prisma.sql`
      SELECT id, question, answer, aliases, keywords, 0.0 AS score
      FROM "FaqItem"
      WHERE "isActive" = true
    `);
    const existingIds = new Set(candidates.map(c => c.id));
    const lowerQ = question.toLowerCase();
    for (const row of allActiveFaqs) {
      if (existingIds.has(row.id)) continue;
      const aliases = row.aliases ?? [];
      const matched = aliases.some(a => lowerQ.includes(a.toLowerCase()) || a.toLowerCase().includes(lowerQ));
      if (matched) {
        candidates.push({ ...row, score: 1.0 });
        existingIds.add(row.id);
      }
    }

    if (candidates.length === 0) return null;

    // Scoring:用 coverage 召回率(归一化,避免长 FAQ 不公平优势)
    // query 侧:展开后的全部 token
    const querySet = new Set<string>();
    for (const t of queryNgrams) querySet.add(t);
    for (const t of topicTokens) querySet.add(t);

    // 主题词命中(强信号):原词匹配 question/aliases/keywords 给加权
    const originalTopicSet = new Set<string>();
    for (const k of queryNgrams) {
      if (k.length >= 2) originalTopicSet.add(k);
    }

    const scored = candidates.map((c) => {
      // 提取该 FAQ 的 n-gram 集合
      const faqNgrams = new Set<string>();
      for (const t of extractKeywords(c.question)) faqNgrams.add(t);
      for (const t of extractKeywords(c.answer)) faqNgrams.add(t);
      for (const a of c.aliases ?? []) for (const t of extractKeywords(a)) faqNgrams.add(t);
      for (const kw of c.keywords ?? []) faqNgrams.add(kw);

      // 直接匹配 aliases:如果用户问题包含某个 alias，直接给高分
      const lowerQ = question.toLowerCase();
      let aliasDirectHit = 0;
      for (const a of c.aliases ?? []) {
        if (lowerQ.includes(a.toLowerCase()) || a.toLowerCase().includes(lowerQ)) {
          aliasDirectHit = 1;
          break;
        }
      }
      // 直接匹配 keywords
      let keywordDirectHit = 0;
      for (const kw of c.keywords ?? []) {
        if (lowerQ.includes(kw.toLowerCase())) {
          keywordDirectHit = 1;
          break;
        }
      }

      // Coverage(召回率):用交集/查询集大小,惩罚"长 FAQ 误匹配"
      const inter = new Set([...querySet].filter((t) => faqNgrams.has(t)));
      const coverage = querySet.size > 0 ? inter.size / querySet.size : 0;

      // 主题词命中加权:原主题词在 question/aliases 命中 = 强信号
      let topicHit = 0;
      for (const t of originalTopicSet) {
        if (c.question.includes(t) || c.aliases?.some((a) => a.includes(t))) topicHit += 1;
      }
      const topicScore = originalTopicSet.size > 0
        ? topicHit / originalTopicSet.size
        : 0;

      // 综合分 = coverage * 0.4 + topicScore * 0.3 + aliasDirectHit * 0.2 + keywordDirectHit * 0.1
      // alias/keyword 直接命中给高权重，确保口语化提问能匹配
      const final = coverage * 0.4 + topicScore * 0.3 + aliasDirectHit * 0.2 + keywordDirectHit * 0.1;

      return { ...c, jaccard: coverage, topicScore, final, interSize: inter.size, aliasDirectHit, keywordDirectHit } as FaqRow & { final: number; jaccard: number; topicScore: number; interSize: number; aliasDirectHit: number; keywordDirectHit: number };
    });

    scored.sort((a, b) => b.final - a.final || b.interSize - a.interSize);

    // === 意图预过滤:防止"不出国"匹配到"转专业"/"雅思"类 FAQ ===
    // 只有在查询有明确意图且候选中存在意图匹配的情况下才过滤
    const queryIntents = detectIntents(question);
    let filteredScored = scored;
    if (queryIntents.size > 0) {
      const intentMatched = scored.filter(c => {
        const ci = faqIntents(c);
        // 候选 FAQ 有交集意图 → 保留
        return [...queryIntents].some(i => ci.has(i));
      });
      // 只有过滤后仍有候选才收窄；否则退回全量（避免漏召回）
      if (intentMatched.length > 0) {
        filteredScored = intentMatched;
      }
    }
    const top = filteredScored[0];
    if (top.final < 0.15) return null;

    // alias/keyword 直接命中时跳过 LLM rerank，直接返回
    if (top.aliasDirectHit || top.keywordDirectHit) {
      this.bumpHitCount(top.id);
      this.logger.log(
        `faq direct hit: q="${question.slice(0, 30)}" → "${top.question.slice(0, 30)}" (alias=${top.aliasDirectHit}, kw=${top.keywordDirectHit})`,
      );
      const score = Math.min(0.95, 0.7 + top.final * 0.3);
      if (score < threshold) return null;
      return { faqId: top.id, question: top.question, answer: top.answer, score };
    }

    // 高置信度门槛:0.85 以上跳过 LLM rerank(直接信任关键词命中)
    // 0.85 以下强制走 LLM rerank,避免"中外联合培养项目"等通用前缀造成的误匹配
    let chosen = top as any;
    let llmReranked = false;
    if (top.final < 0.85 && filteredScored.length > 1) {
      const topN = filteredScored.slice(0, Math.min(3, filteredScored.length));
      const reranked = await this.llmRerank(question, topN);
      if (reranked) {
        chosen = reranked;
        llmReranked = true;
      } else {
        this.logger.log(
          `faq reject: LLM rerank said NONE for q="${question.slice(0, 30)}" (top score=${top.final.toFixed(2)})`,
        );
        return null;
      }
    }

    this.bumpHitCount(chosen.id);
    this.logger.log(
      `faq keyword hit: q="${question.slice(0, 30)}" → "${chosen.question.slice(0, 30)}" ` +
        `(coverage=${chosen.jaccard.toFixed(3)}, topic=${chosen.topicScore.toFixed(2)}, final=${chosen.final.toFixed(3)}, llmReranked=${llmReranked})`,
    );
    const score = Math.min(0.95, 0.6 + chosen.final * 0.5);
    if (score < threshold) {
      return null;
    }
    return {
      faqId: chosen.id,
      question: chosen.question,
      answer: chosen.answer,
      score,
    };
  }

  /**
   * LLM 重排序:用 LLM 判断哪个候选 FAQ 最能回答用户问题
   *  - 返回最佳候选(如果都不相关返回 null)
   *  - 轻量单次 LLM 调用,prompt 极简,加 5s timeout
   */
  private async llmRerank(
    question: string,
    candidates: Array<FaqRow & { final: number; jaccard: number; topicScore: number; interSize: number; aliasDirectHit?: number; keywordDirectHit?: number }>,
  ): Promise<(FaqRow & { final: number; jaccard: number; topicScore: number; interSize: number; aliasDirectHit?: number; keywordDirectHit?: number }) | null> {
    try {
      const list = candidates
        .map((c, i) => `[${i}] Q:${c.question}\n    A:${c.answer.slice(0, 80)}`)
        .join("\n\n");
      const prompt = `你是招生问答匹配助手。判断下列哪个 FAQ 最贴切地回答了用户问题。
- 必须严格匹配用户意图(如"不出国"应匹配关于"是否要出国/在地国际化"的 FAQ,不要匹配"转专业")
- 如果都不相关或意图不匹配,回复 NONE
- 否则只回复一个数字(0/1/2)

用户问题:${question}

候选 FAQ:
${list}

答案:`;
      const resp = await this.llm.chat({
        messages: [
          { role: "system", content: "你是招生 FAQ 匹配助手,严格判断意图,只输出数字或 NONE。" },
          { role: "user", content: prompt },
        ],
        temperature: 0,
        maxTokens: 4,
      });
      const text = (resp.content ?? "").trim();
      const idx = parseInt(text, 10);
      if (isNaN(idx) || idx < 0 || idx >= candidates.length) {
        this.logger.log(`faq llmRerank: LLM said "${text}" (no match)`);
        return null;
      }
      this.logger.log(`faq llmRerank: LLM picked #${idx} for q="${question.slice(0, 30)}"`);
      return candidates[idx];
    } catch (err) {
      this.logger.warn(
        `faq llmRerank failed (fallback to top-1): ${(err as Error).message}`,
      );
      return null;
    }
  }

  private bumpHitCount(id: string): void {
    this.prisma.faqItem
      .update({ where: { id }, data: { hitCount: { increment: 1 } } })
      .catch((err) =>
        this.logger.warn(
          `faq hitCount increment failed: id=${id} err=${(err as Error).message}`,
        ),
      );
  }
}
