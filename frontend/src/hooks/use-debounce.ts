import { useEffect, useState } from 'react';

/**
 * 通用 debounce hook — 用于搜索框/输入提示
 *  - delay 默认为 300ms
 *  - 卸载时自动清 timer
 */
export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
