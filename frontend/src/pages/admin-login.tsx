import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, unwrap } from '@/lib/api/client';
import { AuthApi } from '@/lib/api/endpoints';
import { ErrorCode } from '@/lib/api/types';
import { useAuthStore, type AuthUser } from '@/lib/store/auth';

/**
 * Admin Login 页
 *  - 邮箱 + 密码登录,调 AuthApi.login
 *  - 成功后 setAuth + navigate(redirect || '/admin/documents')
 *  - 错误码 2001 → 账号或密码错误;2004 → 账号已禁用
 *    注:后端业务错误码不在前端 ErrorCode 枚举里,这里按 code 数字直接判断
 *  - 已登录态自动跳目标页
 */
export default function AdminLoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = params.get('redirect') || '/admin/documents';

  const setAuth = useAuthStore((s) => s.login);
  const hasToken = useAuthStore((s) => Boolean(s.accessToken));

  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // 已登录直接跳走
  React.useEffect(() => {
    if (hasToken) {
      sessionStorage.removeItem('wyu_redirecting_to_login');
      navigate(redirect, { replace: true });
    }
  }, [hasToken, navigate, redirect]);

  // 进入登录页时清掉重定向标记
  React.useEffect(() => {
    sessionStorage.removeItem('wyu_redirecting_to_login');
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    const e1 = email.trim();
    if (!e1 || !password) {
      setError('请输入邮箱和密码');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const resp = await AuthApi.login(e1, password);
      const data = unwrap(resp) as {
        accessToken: string;
        refreshToken: string;
        user: AuthUser;
      };
      setAuth({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        user: data.user,
      });
      toast.success('登录成功');
      navigate(redirect, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        // 2001/2004 是后端业务约定的鉴权错误码
        if (err.code === 2001) setError('账号或密码错误');
        else if (err.code === 2004) setError('账号已禁用,请联系管理员');
        else if (err.code === ErrorCode.RATE_LIMITED)
          setError('尝试次数过多,请稍后再试');
        else setError(err.message || '登录失败');
      } else {
        setError('网络错误,请稍后重试');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="wyu-brand relative z-0 flex min-h-screen-mobile flex-col items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100 py-12 px-4 text-slate-800">
      {/* 学院 logo 全局背景 */}
      <div
        className="pointer-events-none fixed inset-0 z-[-1] flex items-center justify-center overflow-hidden"
        aria-hidden
      >
        <img
          src="/wyu/logo.png"
          alt=""
          className="w-auto object-contain"
          style={{
            height: 'min(80vh, 800px)',
            opacity: 0.04,
          }}
          draggable={false}
        />
      </div>

      <Card className="z-10 w-full max-w-md border-slate-200/60 bg-white/80 shadow-xl shadow-blue-900/5 backdrop-blur-xl">
        <CardHeader>
          <div className="flex flex-col items-center justify-center gap-3">
            <img 
              src="/wyu/logo-iec.png" 
              alt="国际教育学院" 
              className="h-10 w-auto object-contain" 
              draggable={false}
            />
            <CardTitle>管理员登录</CardTitle>
          </div>
          <CardDescription className="text-center">
            访问知识库、分析仪表盘等后台功能
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit} noValidate>
            <div className="space-y-2">
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                type="email"
                placeholder="admin@wyu.edu.cn"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                placeholder="********"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                required
              />
            </div>

            {error ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
              >
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  登录中…
                </>
              ) : (
                '登录'
              )}
            </Button>
          </form>

          <div className="mt-4 text-center">
            <Button asChild variant="link" size="sm">
              <Link to="/">返回家长端首页</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
