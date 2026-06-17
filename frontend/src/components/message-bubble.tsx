import * as React from 'react';
import { ChevronDown, FileText, ThumbsDown, ThumbsUp, User2 } from 'lucide-react';
import { toast } from 'sonner';

import { cn, sanitizeInput } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Markdown } from '@/components/markdown';
import { ChatApi, type CitationVO, type MessageVO } from '@/lib/api/endpoints';

export interface MessageBubbleProps {
  message: MessageVO & { streaming?: boolean };
  onFeedbackSubmitted?: (messageId: string, rating: 1 | -1 | 0) => void;
}

/**
 * 消息气泡:USER 右对齐、ASSISTANT 左对齐
 *  - Markdown 渲染
 *  - 来源折叠(ASSISTANT 才有)
 *  - 反馈按钮(ASSISTANT 才有,仅在非流式状态下)
 *  - feedback 走 ChatApi.submitFeedback(messageId, rating, comment)
 *    重复提交会被后端 upsert 兜底,前端按钮本地置 disabled
 */
export function MessageBubble({
  message,
  onFeedbackSubmitted,
}: MessageBubbleProps) {
  const isUser = message.role?.toLowerCase() === 'user';
  const isStreaming = Boolean(message.streaming);

  return (
    <div
      className={cn(
        'group flex w-full gap-2 sm:gap-3 px-1 py-1.5 sm:py-2',
        isUser ? 'flex-row-reverse justify-start' : 'flex-row justify-start',
      )}
    >
      <div
        className={cn(
          'flex h-9 w-9 sm:h-12 sm:w-12 shrink-0 items-center justify-center rounded-2xl text-xs shadow-sm ring-1 ring-slate-100/50 overflow-hidden',
          isUser
            ? 'bg-slate-100 text-slate-600'
            : 'bg-white',
        )}
        aria-hidden
      >
        {isUser ? (
          <User2 className="h-5 w-5 sm:h-6 sm:w-6" />
        ) : (
          <img 
            src="/wyu/logo.png" 
            alt="AI" 
            className="h-full w-full object-cover scale-[1.35]" 
            draggable={false} 
          />
        )}
      </div>

      <div
        className={cn(
          'flex min-w-0 max-w-[85%] flex-col gap-1.5 sm:gap-2',
          isUser ? 'items-end' : 'items-start',
        )}
      >
        <div
          className={cn(
            'relative rounded-3xl px-3.5 py-2 sm:px-4 sm:py-2.5 text-[14px] sm:text-[15px] leading-relaxed shadow-sm',
            isUser
              ? 'rounded-tr-sm bg-[#004a8c] text-white shadow-blue-900/10'
              : 'rounded-tl-sm bg-white border border-slate-200 text-slate-800 shadow-black/5',
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap break-words">
              {message.content}
            </p>
          ) : (
            <>
              {isStreaming && !message.content ? (
                <TypingCursor />
              ) : message.content ? (
                <>
                  <div className="prose prose-sm max-w-none prose-slate prose-a:text-[#004a8c] prose-a:no-underline hover:prose-a:underline">
                    <Markdown source={message.content} />
                  </div>
                  {isStreaming ? <TypingCursor /> : null}
                </>
              ) : (
                <span className="text-slate-400 text-sm italic">（该消息内容为空）</span>
              )}
            </>
          )}
        </div>

        {!isUser && message.citations && message.citations.length > 0 ? (
          <CitationList citations={message.citations} />
        ) : null}

        {!isUser && !isStreaming && message.id && !message.id.startsWith('local-') && message.content?.trim() ? (
          <FeedbackBar
            messageId={message.id}
            onSubmitted={onFeedbackSubmitted}
          />
        ) : null}
      </div>
    </div>
  );
}

function TypingCursor() {
  return (
    <span
      className="ml-1 inline-flex items-center gap-1 align-middle"
      role="status"
      aria-label="正在生成回答"
    >
      <span className="relative flex h-3 w-3">
        <span className="absolute inset-0 animate-ping rounded-full bg-blue-500/40" />
        <span className="relative inline-flex h-3 w-3 rounded-full bg-[#004a8c]" />
      </span>
      <span className="text-[11px] font-medium text-slate-400">正在思考</span>
    </span>
  );
}

function CitationList({ citations }: { citations: CitationVO[] }) {
  return (
    <details
      className="group w-full max-w-md rounded-md border bg-background/60 text-xs"
      // 默认收起
    >
      <summary
        className={cn(
          'flex cursor-pointer list-none items-center gap-1.5 px-3 py-1.5 text-muted-foreground select-none',
          'hover:text-foreground',
        )}
      >
        <FileText className="h-3.5 w-3.5" />
        <span>查看来源 ({citations.length})</span>
        <ChevronDown className="ml-auto h-3.5 w-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <ol className="space-y-2 border-t px-3 py-2 text-foreground">
        {citations.map((c, idx) => (
          <li key={`${c.docId}-${c.chunkId}-${idx}`} className="space-y-0.5">
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-[10px] text-muted-foreground">
                [{idx + 1}]
              </span>
              <span className="truncate font-medium">
                {c.docId === 'FAQ' || c.docId.includes('FAQ') 
                  ? '2026中外联合培养项目招生常见问题分类汇总' 
                  : c.docId.includes('中外联合培养项目问答汇总-方颖')
                    ? '2026中外联合培养项目招生常见问题分类汇总-1'
                    : c.docId.includes('结构化') 
                      ? '2026五邑大学中外联合培养项目各专业介绍汇总' 
                      : c.docId.includes('Word') || c.docId.includes('整理版') 
                        ? '2026五邑大学中外联合培养项目招生简章（完整版）' 
                        : c.docId}
              </span>
              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                {(c.score * 100).toFixed(0)}%
              </span>
            </div>
            {c.snippet ? (
              <p className="line-clamp-3 text-xs text-muted-foreground">
                {c.snippet}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </details>
  );
}

interface FeedbackBarProps {
  messageId: string;
  onSubmitted?: (messageId: string, rating: 1 | -1 | 0) => void;
}

function FeedbackBar({ messageId, onSubmitted }: FeedbackBarProps) {
  const [rating, setRating] = React.useState<0 | 1 | -1>(0);
  const [comment, setComment] = React.useState('');
  const [showComment, setShowComment] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  // 已投过:rating 非 0 即视为已投过(本地状态)
  const submitted = rating !== 0;

  const submit = async (next: 1 | -1 | 0) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      // 取消旧评价时把 rating 传 0 — 后端不接 0,跳过后端
      if (next !== 0) {
        const payload = next === 1 ? 'POSITIVE' : 'NEGATIVE';
        const safeComment = sanitizeInput(comment);
        await ChatApi.submitFeedback(messageId, payload, safeComment || undefined);
      }
      setRating(next);
      onSubmitted?.(messageId, next);
      if (next !== 0) toast.success('感谢您的反馈');
    } catch {
      // 拦截器已 toast
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-md space-y-1.5">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 gap-1 px-3 text-xs rounded-full transition-colors",
            rating === 1 
              ? "bg-[#004a8c] text-white hover:bg-[#00386b] hover:text-white" 
              : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"
          )}
          disabled={submitting}
          onClick={() => submit(rating === 1 ? 0 : 1)}
          aria-pressed={rating === 1}
        >
          <ThumbsUp className="h-3.5 w-3.5" />
          有帮助
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 gap-1 px-3 text-xs rounded-full transition-colors",
            rating === -1 
              ? "bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700" 
              : "text-slate-500 hover:text-slate-700 hover:bg-slate-100"
          )}
          disabled={submitting}
          onClick={() => {
            if (rating !== -1) setShowComment(true);
            submit(rating === -1 ? 0 : -1);
          }}
          aria-pressed={rating === -1}
        >
          <ThumbsDown className="h-3.5 w-3.5" />
          没帮助
        </Button>
        {submitted ? (
          <span className="ml-1 text-[10px] text-slate-400">
            已反馈
          </span>
        ) : null}
        {submitted ? (
          <button
            type="button"
            className="ml-auto text-[10px] text-slate-400 underline-offset-2 hover:underline hover:text-slate-600 transition-colors"
            onClick={() => setShowComment((v) => !v)}
          >
            {showComment ? '收起备注' : '添加备注'}
          </button>
        ) : null}
      </div>
      {showComment ? (
        <div className="space-y-2 mt-2">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="(可选)简单说说哪里不对,有助于我们改进"
            className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 outline-none placeholder:text-slate-400 focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/10 transition-all shadow-sm"
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 rounded-full px-3 text-xs border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-800"
              onClick={() => setShowComment(false)}
            >
              收起
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 rounded-full px-3 text-xs bg-[#004a8c] text-white hover:bg-[#00386b] shadow-sm"
              disabled={submitting || !comment.trim()}
              onClick={async () => {
                await submit(rating === 0 ? 1 : (rating as 1 | -1));
                setShowComment(false);
              }}
            >
              提交备注
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
