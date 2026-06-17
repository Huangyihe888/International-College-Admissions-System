import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const VISITOR_KEY = 'wyu_vid';

/**
 * 访客身份 store
 *  - 后端通过 Set-Cookie: wyu_vid=... 优先(同源 SameSite=Lax)
 *  - 前端 axios 拦截器读 localStorage 作为兼容兜底(RequestContextMiddleware 也认 X-Visitor-Id)
 *  - 后端收到 wyu_vid 后,首次访问会回种 cookie
 */
interface VisitorState {
  visitorId: string | null;
  setVisitorId: (id: string) => void;
  clear: () => void;
}

export const useVisitorStore = create<VisitorState>()(
  persist(
    (set) => ({
      visitorId: null,
      setVisitorId: (id) => set({ visitorId: id }),
      clear: () => set({ visitorId: null }),
    }),
    {
      name: VISITOR_KEY,
      // 只存 id,避免 setItem 把整个 state 写进 localStorage
      partialize: (s) => ({ visitorId: s.visitorId }),
    },
  ),
);

/** 给 axios 拦截器用:同步读 localStorage(避开 hook) */
export function getStoredVisitorId(): string | null {
  try {
    const raw = localStorage.getItem(VISITOR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { visitorId?: string } };
    return parsed?.state?.visitorId ?? null;
  } catch {
    return null;
  }
}
