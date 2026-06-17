import { useEffect, useState, type CSSProperties } from 'react';

/**
 * MiMo 风格字符网格背景 — 浅色版
 *  - 满屏重复字符作为低对比水印
 *  - 中间用径向 mask 渐变(中央透明、边缘可见),让出大字标题区
 *  - 客户端按视口尺寸自适应行列数
 */
export interface CharGridProps {
  /** 重复字符,默认 'WYU' */
  char?: string;
  /** 颜色 class,默认 text-black */
  className?: string;
  /** 字号 px */
  fontSize?: number;
  /** 行间距倍数 */
  lineHeight?: number;
  /** 字符间距 em */
  letterGap?: number;
  /** mix-blend-mode,可选 */
  blendMode?: CSSProperties['mixBlendMode'];
  /** 是否启用中央 mask 渐变(让出大字区),默认 true */
  fadeCenter?: boolean;
}

function pickGridSize(width: number): { rows: number; cols: number } {
  if (width < 640) return { rows: 18, cols: 8 };
  if (width < 1024) return { rows: 16, cols: 12 };
  if (width < 1440) return { rows: 14, cols: 16 };
  return { rows: 12, cols: 20 };
}

export function CharGrid({
  char = 'WYU',
  className = 'text-black',
  fontSize = 18,
  lineHeight = 2.2,
  letterGap = 0.5,
  blendMode,
  fadeCenter = true,
}: CharGridProps) {
  const [size, setSize] = useState<{ rows: number; cols: number } | null>(null);

  useEffect(() => {
    const update = () => setSize(pickGridSize(window.innerWidth));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  if (!size) return null;

  const { rows, cols } = size;
  const cell = char || 'WYU';

  return (
    <div
      aria-hidden
      className={`pointer-events-none select-none font-mono leading-none ${className}`}
      style={{
        opacity: 0.06,
        fontSize: `${fontSize}px`,
        lineHeight,
        letterSpacing: `${letterGap}em`,
        wordSpacing: `${letterGap}em`,
        whiteSpace: 'nowrap',
        mixBlendMode: blendMode,
        // 中央透明,边缘可见 — 让出大字标题区(只在 fadeCenter=true 时启用)
        WebkitMaskImage: fadeCenter
          ? 'radial-gradient(ellipse 55% 45% at 50% 50%, transparent 0%, transparent 30%, #000 75%)'
          : undefined,
        maskImage: fadeCenter
          ? 'radial-gradient(ellipse 55% 45% at 50% 50%, transparent 0%, transparent 30%, #000 75%)'
          : undefined,
      }}
    >
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r}>
          {Array.from({ length: cols }).map((_, c) => (
            <span key={c}>{cell}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

