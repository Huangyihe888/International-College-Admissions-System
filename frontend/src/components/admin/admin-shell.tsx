import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  FileText,
  LogOut,
  MessageSquareWarning,
  ScrollText,
  Settings2,
  ShieldCheck,
  UserCog,
  Users,
  MessageSquareHeart,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/lib/store/auth';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/admin/documents', label: '文档管理', icon: FileText },
  { to: '/admin/faq', label: 'FAQ', icon: ScrollText },
  { to: '/admin/forbidden-rules', label: '禁答规则', icon: ShieldCheck },
  { to: '/admin/kb-versions', label: 'KB 版本', icon: Settings2 },
  { to: '/admin/low-confidence', label: '低置信度', icon: MessageSquareWarning },
  { to: '/admin/feedback', label: '问答反馈', icon: MessageSquareHeart },
  { to: '/admin/users', label: '用户管理', icon: Users },
  { to: '/admin/analytics', label: '数据看板', icon: BarChart3 },
];

/**
 * Admin 后台整体布局
 *  - 左侧导航
 *  - 顶部用户信息 + 退出登录
 *  - <Outlet /> 渲染子路由
 *  - 受保护:无 accessToken 时跳 /admin/login
 *  - 响应式:<1024px 提示"建议在桌面端访问"
 */
export function AdminShell() {
  const { accessToken, user, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [narrow, setNarrow] = useState<boolean>(() =>
    typeof window === 'undefined' ? false : window.innerWidth < 1024,
  );

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 1024);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!accessToken && !location.pathname.startsWith('/admin/login')) {
      navigate('/admin/login', { replace: true });
    }
  }, [accessToken, location.pathname, navigate]);

  const handleLogout = () => {
    logout();
    toast.success('已退出登录');
    navigate('/admin/login', { replace: true });
  };

  if (narrow) {
    return <NarrowScreenGuard />;
  }

  return (
    <div className="flex min-h-screen wyu-brand bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100 text-slate-800 relative z-0">
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

      <aside className="hidden w-60 shrink-0 border-r border-slate-200/60 bg-white/60 backdrop-blur-xl shadow-[4px_0_24px_rgb(0,0,0,0.02)] md:flex md:flex-col relative z-10">
        <div className="flex h-14 items-center gap-2 border-b border-slate-200/60 px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#004a8c] text-white">
            <UserCog className="h-4 w-4" />
          </div>
          <span className="text-sm font-semibold tracking-wide">管理后台</span>
        </div>
        <nav className="flex-1 space-y-0.5 p-2">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-all duration-300',
                  isActive
                    ? 'bg-[#004a8c] text-white font-medium shadow-sm'
                    : 'text-slate-500 hover:bg-blue-50/50 hover:text-[#004a8c]',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon
                    className={cn('h-4 w-4', isActive ? 'text-white' : 'text-slate-400')}
                  />
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200/60 p-2">
          <Button
            asChild
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100/80"
          >
            <Link to="/">
              <LogOut className="h-4 w-4" />
              返回前台
            </Link>
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col relative z-10">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-slate-200/60 bg-white/60 px-6 backdrop-blur-xl shadow-sm">
          <div className="md:hidden">
            <span className="text-sm font-semibold tracking-wide">管理后台</span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="text-right text-sm leading-tight">
              <div className="font-medium text-slate-800">
                {user?.displayName || user?.email || '管理员'}
              </div>
              <div className="text-xs text-slate-500">
                {user?.roles?.join(' / ') || 'admin'}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-slate-200/60 bg-white/60 text-slate-600 hover:text-slate-800 hover:bg-slate-100/80"
              onClick={handleLogout}
            >
              <LogOut className="h-4 w-4" />
              退出
            </Button>
          </div>
        </header>

        <main className="flex-1 px-6 py-6 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function NarrowScreenGuard() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <div className="max-w-md rounded-lg border bg-background p-6 text-center shadow-sm">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Settings2 className="h-5 w-5" />
        </div>
        <h2 className="text-lg font-semibold">建议在桌面端访问</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          管理后台面向 PC 端(招生办老师笔记本/台式机)优化,请将浏览器窗口拉宽到
          1024px 以上再访问。
        </p>
        <Button asChild className="mt-4">
          <Link to="/">返回前台</Link>
        </Button>
      </div>
    </div>
  );
}
