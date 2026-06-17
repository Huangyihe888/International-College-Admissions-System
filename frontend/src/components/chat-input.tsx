import * as React from 'react';
import { Send, Square } from 'lucide-react';
import { toast } from 'sonner';

import { cn, sanitizeInput } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/**
 * 聊天输入区
 *  - Textarea 自动 grow(0~6 行)
 *  - Enter 发送,Shift+Enter 换行
 *  - 流式中显示 Stop 按钮,点击触发 onStop
 *  - 父组件负责真正的 fetch,本组件只暴露 onSend / onStop
 */
export interface ChatInputProps {
  onSend: (question: string) => void;
  onStop?: () => void;
  streaming?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

const MAX_ROWS = 6;
const LINE_HEIGHT_PX = 24; // 约等 14px * 1.6 line-height

export function ChatInput({
  onSend,
  onStop,
  streaming = false,
  disabled = false,
  placeholder = '请输入您的问题,Enter 发送,Shift+Enter 换行',
  className,
}: ChatInputProps) {
  const [value, setValue] = React.useState('');

  const taRef = React.useRef<HTMLTextAreaElement | null>(null);

  // 自动 grow:根据 scrollHeight 调 rows(上限 MAX_ROWS)
  React.useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const maxH = LINE_HEIGHT_PX * MAX_ROWS;
    const h = Math.min(ta.scrollHeight, maxH);
    ta.style.height = `${h}px`;
  }, [value]);

  const canSend = value.trim().length > 0 && !disabled && !streaming;

  const handleSend = () => {
    let q = value.trim();
    if (!q) return;
    q = sanitizeInput(q);
    if (!q) {
      toast.error('输入包含非法字符');
      return;
    }
    onSend(q);
    setValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canSend) handleSend();
    }
  };

  return (
    <div
      className={cn(
        'group relative flex items-end overflow-hidden rounded-3xl sm:rounded-[32px] bg-white p-2 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-shadow duration-300 border border-slate-200 focus-within:border-blue-500/50 focus-within:ring-4 focus-within:ring-blue-500/10',
        className,
      )}
    >
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        className={cn(
          'min-h-[40px] flex-1 resize-none border-0 bg-transparent px-3 py-2 text-[15px] leading-relaxed outline-none placeholder:text-slate-400/80 text-slate-800',
          'focus:ring-0 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        )}
      />
      {streaming ? (
        <Button
          type="button"
          variant="destructive"
          size="icon"
          onClick={onStop}
          aria-label="停止生成"
          title="停止生成"
          className="mb-1 mr-1 h-9 w-9 sm:h-10 sm:w-10 shrink-0 rounded-full shadow-sm transition-transform active:scale-95 flex items-center justify-center"
        >
          <Square className="h-4 w-4" />
        </Button>
      ) : (
        <Button
          type="button"
          size="icon"
          onClick={handleSend}
          disabled={!canSend}
          aria-label="发送"
          title="发送"
          className={cn(
            "mb-1 mr-1 h-9 w-9 sm:h-10 sm:w-10 shrink-0 rounded-full shadow-sm transition-all hover:scale-105 active:scale-95 flex items-center justify-center",
            canSend
              ? "bg-[#004a8c] text-white hover:bg-[#00386b] hover:shadow-md"
              : "bg-slate-100 text-slate-400"
          )}
        >
          <Send className="h-4 w-4 ml-0.5 sm:ml-0" />
        </Button>
      )}
    </div>
  );
}
