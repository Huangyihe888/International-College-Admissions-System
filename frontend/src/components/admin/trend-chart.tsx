import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

import { cn } from '@/lib/utils';

export interface Series {
  key: string;
  label: string;
  color: string;
}

export interface TrendChartProps<T> {
  data: T[];
  /** 取出 x 轴标签(如 (d)=>d.date) */
  xKey: (item: T) => string;
  /** 取出 y 值,如 (d)=>d.total */
  yKeys: Series[];
  /** 高度(px) */
  height?: number;
  className?: string;
}

/**
 * 轻量 SVG 折线图 — 零依赖,纯手写
 *  - viewBox 自适应宽度(父容器 width 通过 useResizeObserver 获取)
 *  - 多 series 叠放,颜色由调用方传
 *  - Y 轴自动 roundToNice(向上取整到 1/2/5×10^n)
 *  - X 轴每 ~6 个 tick 画一条
 *  - hover 时浮一个简易 div tooltip
 */
export function TrendChart<T>({
  data,
  xKey,
  yKeys,
  height = 240,
  className,
}: TrendChartProps<T>) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number>(800);
  const [hover, setHover] = useState<{
    index: number;
    px: number;
    py: number;
  } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 800;
      setWidth(Math.max(320, Math.floor(w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const padding = { top: 16, right: 16, bottom: 28, left: 40 };
  const innerW = Math.max(0, width - padding.left - padding.right);
  const innerH = Math.max(0, height - padding.top - padding.bottom);

  const { yMax, xLabels, ticksX } = useMemo(() => {
    const max = data.reduce((acc, d) => {
      const m = yKeys.reduce((a, k) => Math.max(a, Number((d as Record<string, unknown>)[k.key] ?? 0)), 0);
      return Math.max(acc, m);
    }, 0);
    const nice = niceCeil(max);
    const xCount = data.length;
    const step = xCount <= 1 ? 0 : innerW / (xCount - 1);
    // 每 ~6 个 tick 画一条(总宽度容不下)
    const targetTicks = Math.min(xCount, Math.max(2, Math.floor(innerW / 80)));
    const tickEvery = xCount <= targetTicks ? 1 : Math.max(1, Math.floor(xCount / targetTicks));
    const ticks: number[] = [];
    for (let i = 0; i < xCount; i += tickEvery) ticks.push(i);
    if (ticks[ticks.length - 1] !== xCount - 1 && xCount > 0) ticks.push(xCount - 1);
    return {
      yMax: nice,
      xLabels: data.map(xKey),
      ticksX: { step, indices: ticks },
    };
  }, [data, yKeys, innerW, xKey]);

  const yScale = (v: number) => padding.top + innerH - (innerH * v) / (yMax || 1);
  const xScale = (i: number) => padding.left + i * (data.length <= 1 ? 0 : innerW / (data.length - 1));

  // Y 轴 ticks:4 等分
  const yTickCount = 4;
  const yTicks: number[] = [];
  for (let i = 0; i <= yTickCount; i++) yTicks.push((yMax * i) / yTickCount);

  // hover 处理:在 chart 内移动时找最近点
  const onMouseMove = (e: ReactMouseEvent<SVGSVGElement>) => {
    if (data.length === 0) return;
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const step = data.length <= 1 ? 0 : innerW / (data.length - 1);
    const idx = Math.max(0, Math.min(data.length - 1, Math.round((x - padding.left) / (step || 1))));
    setHover({
      index: idx,
      px: xScale(idx) - padding.left,
      py: 0,
    });
  };

  return (
    <div ref={wrapRef} className={cn('relative w-full', className)}>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHover(null)}
        className="select-none"
        role="img"
        aria-label="趋势图"
      >
        {/* Y 轴网格线 + 标签 */}
        {yTicks.map((t, i) => {
          const y = yScale(t);
          return (
            <g key={`y-${i}`}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
                stroke="hsl(var(--border))"
                strokeDasharray="3 3"
              />
              <text
                x={padding.left - 6}
                y={y + 3}
                textAnchor="end"
                fontSize={10}
                fill="hsl(var(--muted-foreground))"
              >
                {formatNum(t)}
              </text>
            </g>
          );
        })}

        {/* X 轴 labels */}
        {ticksX.indices.map((i) => {
          const x = xScale(i);
          return (
            <text
              key={`x-${i}`}
              x={x}
              y={height - 8}
              textAnchor="middle"
              fontSize={10}
              fill="hsl(var(--muted-foreground))"
            >
              {truncateLabel(xLabels[i] ?? '', 10)}
            </text>
          );
        })}

        {/* 每条 series 一条 polyline */}
        {yKeys.map((s) => {
          const points = data
            .map((d, i) => {
              const v = Number((d as Record<string, unknown>)[s.key] ?? 0);
              return `${xScale(i)},${yScale(v)}`;
            })
            .join(' ');
          return (
            <polyline
              key={s.key}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              points={points}
            />
          );
        })}

        {/* 每条 series 的圆点 */}
        {yKeys.map((s) => (
          <g key={`dots-${s.key}`}>
            {data.map((d, i) => {
              const v = Number((d as Record<string, unknown>)[s.key] ?? 0);
              return (
                <circle
                  key={`${s.key}-${i}`}
                  cx={xScale(i)}
                  cy={yScale(v)}
                  r={2.5}
                  fill={s.color}
                />
              );
            })}
          </g>
        ))}

        {/* hover 竖线 */}
        {hover && data.length > 0 ? (
          <line
            x1={xScale(hover.index)}
            x2={xScale(hover.index)}
            y1={padding.top}
            y2={height - padding.bottom}
            stroke="hsl(var(--muted-foreground))"
            strokeDasharray="2 2"
            opacity={0.5}
          />
        ) : null}
      </svg>

      {/* Legend */}
      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        {yKeys.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-3 rounded-sm"
              style={{ background: s.color }}
            />
            <span>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Tooltip 浮层 */}
      {hover && data[hover.index] ? (
        <div
          className="pointer-events-none absolute z-10 min-w-[160px] rounded-md border bg-background p-2 text-xs shadow-md"
          style={{
            left: Math.min(width - 180, Math.max(0, hover.px + 12)),
            top: 8,
          }}
        >
          <div className="mb-1 font-medium text-foreground">
            {xLabels[hover.index]}
          </div>
          <div className="space-y-0.5">
            {yKeys.map((s) => {
              const v = Number(
                (data[hover.index] as Record<string, unknown>)[s.key] ?? 0,
              );
              return (
                <div key={s.key} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2 w-2 rounded-sm"
                      style={{ background: s.color }}
                    />
                    <span className="text-muted-foreground">{s.label}</span>
                  </div>
                  <span className="font-medium text-foreground">
                    {formatNum(v)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function niceCeil(n: number): number {
  if (n <= 0) return 1;
  const exp = Math.floor(Math.log10(n));
  const base = Math.pow(10, exp);
  const m = n / base;
  let nice = 1;
  if (m <= 1) nice = 1;
  else if (m <= 2) nice = 2;
  else if (m <= 5) nice = 5;
  else nice = 10;
  return nice * base;
}

function formatNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

function truncateLabel(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
