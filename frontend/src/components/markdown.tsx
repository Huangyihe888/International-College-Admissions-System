import * as React from 'react';

import { cn } from '@/lib/utils';
import {
  parseBlocks,
  tokenizeInline,
  type Block,
  type InlineToken,
} from './markdown.helpers';

/**
 * 轻量 Markdown 渲染器(自研,不引第三方包)
 * 招生问答场景只用得到:标题 / 列表 / 引用 / 代码块 / 链接 / 粗体 / 斜体 / 行内代码 / 段落
 * 解析层(escapeHtml / tokenizeInline / parseBlocks)拆到 markdown.helpers.ts,
 * 避免 react-refresh only-export-components 误报。
 */

function renderInline(tokens: InlineToken[]): React.ReactNode {
  return tokens.map((t, i) => {
    if (t.kind === 'text') {
      // text 段保持原始字符,React 自动转义
      return <React.Fragment key={i}>{t.value}</React.Fragment>;
    }
    if (t.kind === 'bold') {
      return (
        <strong key={i} className="font-semibold">
          {t.value}
        </strong>
      );
    }
    if (t.kind === 'italic') {
      return (
        <em key={i} className="italic">
          {t.value}
        </em>
      );
    }
    if (t.kind === 'code') {
      return (
        <code
          key={i}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]"
        >
          {t.value}
        </code>
      );
    }
    if (t.kind === 'image') {
      return (
        <img
          key={i}
          src={t.src}
          alt={t.alt}
          className="my-2 max-w-[200px] w-full h-auto rounded-lg border border-slate-200 shadow-sm"
          loading="lazy"
        />
      );
    }
    // link
    return (
      <a
        key={i}
        href={t.href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline-offset-2 hover:underline"
      >
        {t.value}
      </a>
    );
  });
}

function renderBlock(b: Block, idx: number): React.ReactNode {
  if (b.kind === 'heading') {
    const sizeClass: Record<number, string> = {
      1: 'text-2xl font-semibold mt-4 mb-2',
      2: 'text-xl font-semibold mt-3 mb-2',
      3: 'text-lg font-semibold mt-3 mb-1.5',
      4: 'text-base font-semibold mt-2 mb-1',
      5: 'text-sm font-semibold mt-2 mb-1',
      6: 'text-xs font-semibold mt-2 mb-1',
    };
    const Tag = (`h${b.level}` as unknown) as keyof React.JSX.IntrinsicElements;
    return (
      <Tag key={idx} className={sizeClass[b.level]}>
        {renderInline(tokenizeInline(b.text))}
      </Tag>
    );
  }
  if (b.kind === 'list') {
    const Tag = b.ordered ? 'ol' : 'ul';
    const cls = b.ordered
      ? 'list-decimal pl-6 my-2 space-y-1'
      : 'list-disc pl-6 my-2 space-y-1';
    return (
      <Tag key={idx} className={cls}>
        {b.items.map((it, j) => (
          <li key={j}>{renderInline(tokenizeInline(it))}</li>
        ))}
      </Tag>
    );
  }
  if (b.kind === 'quote') {
    return (
      <blockquote
        key={idx}
        className="my-2 border-l-2 border-primary/40 bg-muted/40 px-3 py-1.5 text-sm italic text-muted-foreground"
      >
        {renderInline(tokenizeInline(b.text))}
      </blockquote>
    );
  }
  if (b.kind === 'code') {
    return (
      <pre
        key={idx}
        className="my-2 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs"
      >
        <code>{b.text}</code>
      </pre>
    );
  }
  // paragraph
  return (
    <p key={idx} className="my-1.5 leading-relaxed break-words">
      {renderInline(tokenizeInline(b.text))}
    </p>
  );
}

export interface MarkdownProps {
  source: string;
  className?: string;
}

/**
 * Markdown 渲染入口
 *  - source: 原始 markdown 文本(可能含 HTML,会被转义)
 *  - 输出语义化 HTML,无第三方依赖
 */
function sanitize(text: string): string {
  // 移除 Unicode 替换字符 (U+FFFD) 和其他无效字符
  return text.replace(/�/g, '');
}

export function Markdown({ source, className }: MarkdownProps) {
  const blocks = React.useMemo(() => parseBlocks(sanitize(source ?? '')), [source]);
  return (
    <div className={cn('text-sm leading-relaxed', className)}>
      {blocks.map((b, i) => renderBlock(b, i))}
    </div>
  );
}
