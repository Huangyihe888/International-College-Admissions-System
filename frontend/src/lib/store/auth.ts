import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthUser {
  id: string;
  email: string;
  roles: string[];
  displayName?: string;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  login: (payload: { accessToken: string; refreshToken: string; user: AuthUser }) => void;
  setUser: (user: AuthUser) => void;
  setTokens: (tokens: { accessToken: string; refreshToken?: string }) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
}

const AUTH_KEY = 'wyu_admin_auth';

/**
 * 管理员鉴权 store
 *  - accessToken 走内存 + localStorage 双备份(刷新页面不丢)
 *  - refreshToken 仅在 store;HttpOnly cookie 由后端 LoginResponse Set-Cookie 同步种
 *  - 后续 SubTask 13.5 在请求拦截器里自动注入 Authorization: Bearer
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      login: ({ accessToken, refreshToken, user }) =>
        set({ accessToken, refreshToken, user }),
      setUser: (user) => set({ user }),
      setTokens: ({ accessToken, refreshToken }) =>
        set((s) => ({
          accessToken,
          refreshToken: refreshToken ?? s.refreshToken,
        })),
      logout: () => set({ accessToken: null, refreshToken: null, user: null }),
      isAuthenticated: () => Boolean(get().accessToken),
    }),
    {
      name: AUTH_KEY,
      partialize: (s) => ({
        accessToken: s.accessToken,
        refreshToken: s.refreshToken,
        user: s.user,
      }),
    },
  ),
);
