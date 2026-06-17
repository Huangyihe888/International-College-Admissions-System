import { useState } from 'react';
import { Link } from 'react-router-dom';

/**
 * MiMo 风格顶部导航 — 浅色版
 *  - 透明背景 + 浅色文字(深色页面里需要文字是黑)
 *  - 桌面水平排列,移动汉堡菜单
 *  - hover 时反转(黑底白字) — MiMo 标志性交互
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const NAV_ITEMS: { href: string; label: string }[] = [];

export function SiteNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-slate-200/50 bg-white/80 backdrop-blur-md shadow-sm">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-6 sm:h-20 sm:px-10">
        {/* Logo */}
        <Link to="/" className="group flex items-center gap-2 sm:gap-4">
          <img src="/wyu/logo-wuyi.png" alt="Wuyi University" className="h-7 sm:h-12 w-auto object-contain transition-transform group-hover:scale-105" draggable={false} />
          <div className="h-4 sm:h-8 w-px bg-slate-300"></div>
          <img src="/wyu/logo-iec.png" alt="School of International Education" className="h-7 sm:h-12 w-auto object-contain transition-transform group-hover:scale-105" draggable={false} />
        </Link>

        {/* 桌面导航 */}
        <nav className="hidden items-center md:flex">
          <Link
            to="/admin/login"
            className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 transition-colors duration-200 hover:border-slate-900 hover:bg-slate-900 hover:text-white"
          >
            管理入口
          </Link>
        </nav>

        {/* 移动端汉堡 */}
        <button
          type="button"
          aria-label="打开导航"
          onClick={() => setOpen((v) => !v)}
          className="flex h-10 w-10 items-center justify-center rounded-full text-slate-800 transition-colors hover:bg-slate-900/5 md:hidden"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            {open ? (
              <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
            ) : (
              <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
            )}
          </svg>
        </button>
      </div>

      {/* 移动端展开菜单 */}
      {open && (
        <div className="border-t border-slate-200/60 bg-white/95 backdrop-blur-md shadow-sm md:hidden">
          <nav className="mx-auto flex max-w-[1400px] flex-col px-6 py-4">
            <Link
              to="/admin/login"
              onClick={() => setOpen(false)}
              className="inline-flex w-fit rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800"
            >
              管理入口
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
