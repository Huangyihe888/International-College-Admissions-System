/**
 * Markdown 解析层 — 纯函数,无 React 依赖
 * 仅暴露给 markdown.tsx 渲染时调用,以及 _internal 供单元测试 / debug 访问
 */

export type InlineToken =
  | { kind: 'text'; value: string }
  | { kind: 'bold'; value: string }
  | { kind: 'italic'; value: string }
  | { kind: 'code'; value: string }
  | { kind: 'link'; value: string; href: string }
  | { kind: 'image'; alt: string; src: string };

const ALLOWED_LINK = /^(https?:|mailto:)/i;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 把一段"已转义"的 inline 文本再切成 token
 * 顺序很重要:bold ( ** ) 必须在 italic ( * ) 之前匹配,避免双星被当成两个 italic
 */
export function tokenizeInline(raw: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  // 合并正则: image / bold / italic / inline code / link
  // image 必须在 link 前面匹配, 因为语法类似
  const pattern =
    /(!\[([^\]]*)\]\(([^)\s]+)\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)\s]+)\))/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(raw)) !== null) {
    if (m.index > lastIndex) {
      tokens.push({ kind: 'text', value: raw.slice(lastIndex, m.index) });
    }
    if (m[1]) {
      const src = m[3];
      if (ALLOWED_LINK.test(src) || src.startsWith('/')) {
        tokens.push({ kind: 'image', alt: m[2], src });
      } else {
        tokens.push({ kind: 'text', value: m[1] });
      }
    } else if (m[4]) {
      tokens.push({ kind: 'bold', value: m[5] });
    } else if (m[6]) {
      tokens.push({ kind: 'italic', value: m[7] });
    } else if (m[8]) {
      tokens.push({ kind: 'code', value: m[9] });
    } else if (m[10]) {
      const href = m[12];
      if (ALLOWED_LINK.test(href) || href.startsWith('/')) {
        tokens.push({ kind: 'link', value: m[11], href });
      } else {
        // 不安全链接降级成纯文本
        tokens.push({ kind: 'text', value: m[0] });
      }
    }
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < raw.length) {
    tokens.push({ kind: 'text', value: raw.slice(lastIndex) });
  }
  return tokens;
}

export interface BlockHeading {
  kind: 'heading';
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
}
export interface BlockList {
  kind: 'list';
  ordered: boolean;
  items: string[];
}
export interface BlockQuote {
  kind: 'quote';
  text: string;
}
export interface BlockCode {
  kind: 'code';
  lang?: string;
  text: string;
}
export interface BlockParagraph {
  kind: 'paragraph';
  text: string;
}

export type Block =
  | BlockHeading
  | BlockList
  | BlockQuote
  | BlockCode
  | BlockParagraph;

/**
 * 顶层解析:从一个完整 markdown 字符串产出 block 列表
 *  - 代码块优先(以 ``` 起止)
 *  - 否则按行扫描,识别 # / > / - / 数字.
 */
export function parseBlocks(src: string): Block[] {
  const lines = src.split(/\r?\n/);
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // 跳过空行(段落分隔)
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // 代码块 ```
    const fence = line.match(/^```\s*([\w-]*)\s*$/);
    if (fence) {
      const lang = fence[1] || undefined;
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i += 1;
      }
      // 吃掉收尾 ```
      if (i < lines.length) i += 1;
      blocks.push({ kind: 'code', lang, text: buf.join('\n') });
      continue;
    }

    // 标题 # ~ ######
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      blocks.push({
        kind: 'heading',
        level: h[1].length as BlockHeading['level'],
        text: h[2].trim(),
      });
      i += 1;
      continue;
    }

    // 引用 >  (合并连续 > 行)
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ kind: 'quote', text: buf.join(' ') });
      continue;
    }

    // 无序列表 - / *
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ''));
        i += 1;
      }
      blocks.push({ kind: 'list', ordered: false, items });
      continue;
    }

    // 有序列表 1. 2.
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      blocks.push({ kind: 'list', ordered: true, items });
      continue;
    }

    // 普通段落:连续非空行归一段
    const buf: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^[-*]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i]) &&
      !/^```/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i += 1;
    }
    blocks.push({ kind: 'paragraph', text: buf.join(' ') });
  }
  return blocks;
}

/** 仅暴露给单元测试 / debug 用,生产代码不必用 */
export const _internal = { parseBlocks, tokenizeInline, escapeHtml };
