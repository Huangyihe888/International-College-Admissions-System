import * as React from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuthStore } from '@/lib/store/auth';

/**
 * 管理端路由保护 hook
 *  - 检查 useAuthStore 是否持有 accessToken
 *  - 未登录:跳 /admin/login?redirect=<原路径>
 *  - 已登录:返回 true
 *  - 内部以 useEffect 触发,避免渲染期 setState
 */
export function useAdminAuth(redirectTo?: string): boolean {
  const accessToken = useAuthStore((s) => s.accessToken);
  const navigate = useNavigate();
  const [checked, setChecked] = React.useState(false);

  React.useEffect(() => {
    if (accessToken) {
      setChecked(true);
      return;
    }
    const here =
      redirectTo ??
      (typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/admin');
    const qs = new URLSearchParams({ redirect: here }).toString();
    navigate(`/admin/login?${qs}`, { replace: true });
  }, [accessToken, navigate, redirectTo]);

  return Boolean(accessToken) && checked;
}
