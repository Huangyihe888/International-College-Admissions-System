/**
 * 原生 Date 工具 — 不引入 date-fns。
 * 所有函数返回新 Date 实例,不修改入参。
 */
export function subHours(base: Date, hours: number): Date {
  const d = new Date(base.getTime());
  d.setTime(d.getTime() - hours * 60 * 60 * 1000);
  return d;
}

export function subDays(base: Date, days: number): Date {
  const d = new Date(base.getTime());
  d.setTime(d.getTime() - days * 24 * 60 * 60 * 1000);
  return d;
}

export function startOfDay(base: Date): Date {
  const d = new Date(base.getTime());
  d.setHours(0, 0, 0, 0);
  return d;
}

export type AnalyticsRange = "24h" | "7d" | "30d";

/**
 * 根据 range 字符串返回时间下界(now - 偏移),上界固定 now。
 * 未识别的值兜底 7d。
 */
export function resolveRange(range?: string): {
  since: Date;
  until: Date;
  hours: number;
} {
  const until = new Date();
  let hours: number;
  switch (range) {
    case "24h":
      hours = 24;
      break;
    case "30d":
      hours = 24 * 30;
      break;
    case "7d":
    default:
      hours = 24 * 7;
      break;
  }
  return { since: subHours(until, hours), until, hours };
}
