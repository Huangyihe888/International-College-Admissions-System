import { useCallback, useState } from 'react';
import { toast } from 'sonner';

interface UseClipboardResult {
  copied: boolean;
  copy: (text: string) => Promise<boolean>;
  reset: () => void;
}

/**
 * 复制到剪贴板 hook
 *  - 成功:copied=true,1.5s 后自动复位
 *  - 失败:toast 提示
 *  - navigator.clipboard 不存在时降级到 textarea hack
 */
export function useClipboard(resetMs = 1500): UseClipboardResult {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(
    async (text: string) => {
      let ok = false;
      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          ok = true;
        } else {
          // Fallback
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          ok = document.execCommand('copy');
          document.body.removeChild(ta);
        }
      } catch {
        ok = false;
      }

      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), resetMs);
      } else {
        toast.error('复制失败,请手动选择文本');
      }
      return ok;
    },
    [resetMs],
  );

  const reset = useCallback(() => setCopied(false), []);

  return { copied, copy, reset };
}
