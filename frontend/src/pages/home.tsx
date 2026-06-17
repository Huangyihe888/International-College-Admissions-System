import { useNavigate } from 'react-router-dom';
import { Search, Send } from 'lucide-react';
import * as React from 'react';

import { SiteNav } from '@/components/brand/site-nav';
import { SiteFooter } from '@/components/brand/site-footer';

const SUGGESTED = [
  '中外联合培养项目能否不出国?',
  '联合培养项目的招生计划是怎样的?',
  '学生毕业后能获得什么学位证书?',
  '该项目可以在读期间转入其他专业吗?',
];

/** 滚动入场 — 简化版 IntersectionObserver */
function useReveal() {
  const ref = React.useRef<HTMLDivElement>(null);
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setShown(true);
            obs.disconnect();
          }
        });
      },
      { threshold: 0.15 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, shown };
}

function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const { ref, shown } = useReveal();
  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${
        shown ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
      } ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

/* ---------- 主页 ---------- */

export default function HomePage() {
  const navigate = useNavigate();
  const [input, setInput] = React.useState('');
  // 调试用:URL 加 ?hover=1 时,大字标题区强制显示 hover 状态(英文 + 黑底)
  // ?focus=1 时,搜索框默认 focus(黑底)
  // 方便截图、设计师审稿,不影响默认体验
  const [demoHover, setDemoHover] = React.useState(false);
  const [demoFocus, setDemoFocus] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setDemoHover(params.get('hover') === '1');
    setDemoFocus(params.get('focus') === '1');
  }, []);
  React.useEffect(() => {
    if (demoFocus) {
      // 真正 focus,触发 CSS :focus-within 状态
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [demoFocus]);

  const submit = (q: string) => {
    const text = q.trim();
    if (!text) return;
    navigate(`/chat?q=${encodeURIComponent(text)}`);
  };

  return (
    <div className="wyu-brand min-h-screen-mobile text-slate-800 bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100">
      <SiteNav />

      {/* ========== HERO ========== */}
      <section
        className={`group/hero relative isolate flex min-h-screen-mobile flex-col overflow-hidden ${
          demoHover ? 'is-demo-hover' : ''
        }`}
      >
        {/* 背景风光图层（镶嵌到背景） */}
        <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden select-none">
          {/* 左上湖景图（第二张原图） */}
          <div className="absolute top-0 left-0 w-[150%] md:w-[75%] h-[60vh] md:h-[85vh] opacity-40 md:opacity-60 mix-blend-multiply">
            <img
              src="/wyu/bg-lake.jpg"
              alt=""
              className="w-full h-full object-cover"
              style={{ maskImage: 'radial-gradient(ellipse at top left, black 10%, transparent 70%)', WebkitMaskImage: 'radial-gradient(ellipse at top left, black 10%, transparent 70%)' }}
            />
          </div>
          {/* 右下日落图（第一张原图） */}
          <div className="absolute bottom-0 right-0 w-[150%] md:w-[75%] h-[60vh] md:h-[85vh] opacity-40 md:opacity-60 mix-blend-multiply">
            <img
              src="/wyu/bg-sunset.jpg"
              alt=""
              className="w-full h-full object-cover"
              style={{ maskImage: 'radial-gradient(ellipse at bottom right, black 10%, transparent 70%)', WebkitMaskImage: 'radial-gradient(ellipse at bottom right, black 10%, transparent 70%)' }}
            />
          </div>
          {/* 统一融合遮罩：保证中间文字绝对清晰，边缘透出风光 */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(255,255,255,0.95)_20%,_rgba(255,255,255,0.4)_80%)] md:bg-[radial-gradient(ellipse_at_center,_rgba(255,255,255,0.9)_30%,_rgba(255,255,255,0.2)_80%)] backdrop-blur-[1px]"></div>
        </div>

        <main className="relative z-10 mx-auto flex w-full flex-1 flex-col items-center justify-center px-4 sm:px-6 pb-16 sm:pb-24 pt-20 sm:pt-32 md:pt-40">
          {/* 大字 hero — 极简:中文 + 校名 eyebrow,无双语切换 */}
          <Reveal className="w-full flex justify-center">
            <div className="w-full max-w-[1200px] text-center">
              {/* eyebrow 极简 */}
              <p 
                className="mb-4 sm:mb-8 md:mb-10 text-xs sm:text-sm md:text-base font-bold uppercase tracking-[0.2em] sm:tracking-[0.4em] text-[#004a8c]/70 px-2 leading-relaxed"
                style={{ fontFamily: "'Times New Roman', Times, serif" }}
              >
                SCHOOL OF INTERNATIONAL EDUCATION
                <br className="md:hidden" />
                <span className="hidden md:inline"> · </span>
                WUYI UNIVERSITY
              </p>

              {/* 大字标题 — 增加渐变色与阴影，更具现代感 */}
              <h1 className="text-balance text-4xl sm:text-5xl md:text-6xl lg:text-7xl xl:text-[80px] leading-[1.3] sm:leading-[1.4] tracking-normal flex flex-wrap justify-center items-baseline gap-x-3 sm:gap-x-5 md:gap-x-6 gap-y-3 sm:gap-y-4 md:gap-y-5">
                <span className="text-slate-500 text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-medium tracking-[0.05em] opacity-90">您好，欢迎来到</span>
                <span className="bg-gradient-to-r from-[#001f3f] via-[#004a8c] to-[#0070c9] bg-clip-text text-transparent pb-2 sm:pb-3 filter drop-shadow-[0_8px_16px_rgba(0,74,140,0.15)] px-1 font-black tracking-[-0.02em] whitespace-nowrap">五邑大学国际教育学院</span>
              </h1>

              <p className="mx-auto mt-6 sm:mt-10 max-w-2xl px-2 sm:px-4 text-balance text-[13px] sm:text-base md:text-lg leading-relaxed text-slate-500">
                一座连接学院、家长和未来学子的桥梁。<br className="hidden sm:block" />
                基于学院官方资料与大语言模型, <br className="hidden sm:block" />
                为您24小时解答关于招生信息、专业设置、报考要求与疑难解答的一切疑问。
              </p>
            </div>
          </Reveal>

          {/* 搜索框 — 优化阴影、边框与交互反馈 */}
          <Reveal delay={120} className="w-full max-w-3xl">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit(input);
              }}
              className="mx-auto mt-8 sm:mt-14 md:mt-16 w-full px-2 sm:px-4"
            >
              <div className="group relative rounded-3xl sm:rounded-full shadow-[0_12px_40px_-10px_rgba(0,74,140,0.25),0_4px_10px_-4px_rgba(0,74,140,0.15)] transition-all duration-500 bg-slate-100 border-2 border-slate-900/40 backdrop-blur-xl">
                <div className="pointer-events-none absolute left-4 sm:left-6 top-1/2 -translate-y-1/2">
                  <Search
                    className={`h-4 w-4 sm:h-5 sm:w-5 transition-colors ${
                      demoFocus
                        ? 'text-blue-600'
                        : 'text-blue-500/70 group-focus-within:text-blue-600'
                    }`}
                  />
                </div>
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="向招生智能助手提问..."
                  className={`w-full rounded-3xl sm:rounded-full border-0 bg-transparent py-3.5 sm:py-4.5 pl-10 sm:pl-14 pr-14 sm:pr-16 text-sm sm:text-base text-slate-800 outline-none transition-all duration-300 placeholder:text-slate-400 ${
                    demoFocus ? 'bg-blue-50/30' : 'focus:bg-blue-50/30'
                  }`}
                  maxLength={200}
                />
                <button
                  type="submit"
                  disabled={!input.trim()}
                  aria-label="发送"
                  className="absolute right-1.5 sm:right-2.5 top-1/2 flex h-9 w-9 sm:h-11 sm:w-11 -translate-y-1/2 items-center justify-center rounded-full bg-[#004a8c] text-white transition-all hover:scale-105 hover:bg-[#00386b] hover:shadow-md active:scale-95 group-focus-within:bg-[#004a8c] group-focus-within:text-white disabled:pointer-events-none disabled:opacity-30 disabled:bg-slate-300"
                >
                  <Send className="h-3.5 w-3.5 sm:h-4 sm:w-4 ml-0.5 sm:ml-0" />
                </button>
              </div>
            </form>
          </Reveal>

          {/* 推荐问题 — 采用更柔和的毛玻璃质感标签排版 */}
          <Reveal delay={240}>
            <div className="mx-auto mt-8 sm:mt-10 md:mt-12 flex flex-wrap justify-center w-full max-w-4xl gap-2 sm:gap-3 px-2 sm:px-4">
              {SUGGESTED.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => submit(q)}
                  className="rounded-full border border-slate-200 bg-white/60 backdrop-blur-sm px-4 sm:px-5 py-2 sm:py-2.5 text-xs sm:text-sm text-slate-600 transition-all duration-300 hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50/50 hover:text-[#004a8c] hover:shadow-sm"
                >
                  {q}
                </button>
              ))}
            </div>
          </Reveal>
        </main>
      </section>

      <SiteFooter />
    </div>
  );
}
