import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  CheckCircle2,
  Download,
  HelpCircle,
  Loader2,
  MessageSquare,
  TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';

import { SectionCard } from '@/components/admin/section';
import {
  TrendChart,
  type Series,
} from '@/components/admin/trend-chart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { unwrap } from '@/lib/api/client';
import { AnalyticsApi } from '@/lib/api/endpoints';
import { useAuthStore } from '@/lib/store/auth';
import { useAdminAuth } from '@/hooks/use-admin-auth';

interface RagLogRow {
  id: string;
  query: string;
  isAnswered: boolean;
  faqHit: boolean;
  confidence: number | null;
  latencyMs: number;
  rejectReason: string | null;
  createdAt: string;
}

type RangeKey = '24h' | '7d' | '30d';

interface OverviewVO {
  totalQuestions?: number;
  uniqueVisitors?: number;
  hitRate?: number;
  positiveRate?: number;
  avgLatencyMs?: number;
  todayQuestions?: number;
  [k: string]: unknown;
}

interface TrendPoint {
  date: string;
  total: number;
  answered: number;
  faqHit: number;
  lowConfidence: number;
}

interface TopQuestion {
  query: string;
  count: number;
  answeredCount?: number;
}

const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: '24h', label: '24 小时' },
  { value: '7d', label: '7 天' },
  { value: '30d', label: '30 天' },
];

type TopFilter = 'all' | 'answered' | 'faq';

const TOP_FILTER_OPTIONS: { value: TopFilter; label: string; isAnswered?: boolean; faqHit?: boolean }[] = [
  { value: 'all', label: '全部' },
  { value: 'answered', label: '已回答', isAnswered: true },
  { value: 'faq', label: 'FAQ 命中', faqHit: true },
];

export default function AdminAnalyticsPage() {
  useAdminAuth();
  const [range, setRange] = React.useState<RangeKey>('7d');
  const [topFilter, setTopFilter] = React.useState<TopFilter>('all');
  const [exporting, setExporting] = React.useState(false);

  const overview = useQuery({
    queryKey: ['admin', 'analytics', 'overview', range],
    queryFn: async () => {
      const resp = await AnalyticsApi.overview(range);
      return unwrap(resp) as OverviewVO;
    },
  });

  const trends = useQuery({
    queryKey: ['admin', 'analytics', 'trends', range],
    queryFn: async () => {
      const resp = await AnalyticsApi.trends({
        range,
        granularity: range === '24h' ? 'hour' : 'day',
      });
      const data = unwrap(resp) as { items?: TrendPoint[] };
      return data.items ?? [];
    },
  });

  const topQuestions = useQuery({
    queryKey: ['admin', 'analytics', 'top-questions', range, topFilter],
    queryFn: async () => {
      const opt = TOP_FILTER_OPTIONS.find((o) => o.value === topFilter);
      const resp = await AnalyticsApi.topQuestions({
        range,
        limit: 10,
        isAnswered: opt?.isAnswered,
        faqHit: opt?.faqHit,
      });
      const data = unwrap(resp) as { items?: TopQuestion[] };
      return data.items ?? [];
    },
  });

  const [helpOpen, setHelpOpen] = React.useState(false);
  const [drilldown, setDrilldown] = React.useState<TopQuestion | null>(null);

  const drilldownLogs = useQuery({
    queryKey: ['admin', 'analytics', 'drilldown', drilldown?.query, range],
    enabled: Boolean(drilldown),
    queryFn: async () => {
      if (!drilldown) return [];
      const resp = await AnalyticsApi.logs({
        keyword: drilldown.query,
        page: 1,
        pageSize: 20,
      });
      const data = unwrap(resp) as { items?: RagLogRow[] };
      return data.items ?? [];
    },
  });

  const handleExport = async () => {
    setExporting(true);
    try {
      const url = AnalyticsApi.exportCsvUrl(range);
      const accessToken = useAuthStore.getState().accessToken;
      const resp = await fetch(url, {
        method: 'GET',
        headers: accessToken
          ? { Authorization: `Bearer ${accessToken}` }
          : undefined,
        credentials: 'include',
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `wyu-analytics-${range}-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      toast.success('CSV 已开始下载');
    } catch (e) {
      toast.error(`导出失败:${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  // 顶部 6 个概览卡片(顺序固定)
  const ov = overview.data ?? {};
  const cards: { label: string; value: string; hint?: string; icon: React.ReactNode }[] = [
    {
      label: '总提问数',
      value: fmtNumber(ov.totalQuestions),
      hint: `${RANGE_OPTIONS.find((r) => r.value === range)?.label ?? ''} 区间`,
      icon: <MessageSquare className="h-4 w-4 text-primary" />,
    },
    {
      label: '今日提问',
      value: fmtNumber(ov.todayQuestions),
      hint: '今日 0 点至今',
      icon: <TrendingUp className="h-4 w-4 text-primary" />,
    },
    {
      label: '独立访客(UV)',
      value: fmtNumber(ov.uniqueVisitors),
      hint: `${RANGE_OPTIONS.find((r) => r.value === range)?.label ?? ''} 区间`,
      icon: <Activity className="h-4 w-4 text-primary" />,
    },
    {
      label: 'FAQ 命中率',
      value: typeof ov.hitRate === 'number' ? `${(ov.hitRate * 100).toFixed(1)}%` : '—',
      hint: 'faqHit/totalQuestions',
      icon: <TrendingUp className="h-4 w-4 text-primary" />,
    },
    {
      label: '好评率',
      value:
        typeof ov.positiveRate === 'number'
          ? `${(ov.positiveRate * 100).toFixed(1)}%`
          : '—',
      hint: 'UP/(UP+DOWN)',
      icon: <CheckCircle2 className="h-4 w-4 text-primary" />,
    },
    {
      label: '平均耗时',
      value:
        typeof ov.avgLatencyMs === 'number' ? `${Math.round(ov.avgLatencyMs)}ms` : '—',
      hint: 'RAG latencyMs 均值',
      icon: <HelpCircle className="h-4 w-4 text-primary" />,
    },
  ];

  const series: Series[] = [
    { key: 'total', label: '总会话', color: 'hsl(220, 70%, 50%)' },
    { key: 'answered', label: '已回答', color: 'hsl(150, 60%, 40%)' },
    { key: 'faqHit', label: 'FAQ 命中', color: 'hsl(30, 80%, 55%)' },
  ];

  const top = topQuestions.data ?? [];
  const maxCount = top.reduce((m, q) => Math.max(m, q.count), 0) || 1;

  return (
    <div className="space-y-4">
      {/* 顶部:标题 + range + 导出 + 帮助 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">数据看板</h1>
          <p className="text-xs text-muted-foreground">
            招生问答的访问量、命中率与置信度趋势
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border bg-background p-0.5">
            {RANGE_OPTIONS.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setRange(r.value)}
                className={
                  'rounded px-2.5 py-1 text-xs transition-colors ' +
                  (range === r.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground')
                }
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="rounded-md border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
            aria-label="说明"
          >
            ?
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-3 text-xs font-medium hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
          >
            {exporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            导出 CSV
          </button>
        </div>
      </div>

      {/* 概览 6 卡片 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((c) => (
          <Card key={c.label} className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1.5">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                {c.label}
              </CardTitle>
              {c.icon}
            </CardHeader>
            <CardContent>
              {overview.isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <>
                  <div className="text-2xl font-semibold tabular-nums">
                    {c.value}
                  </div>
                  {c.hint ? (
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {c.hint}
                    </p>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 趋势 + Top 双列 */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 趋势图 */}
        <SectionCard
          title="趋势"
          description="总会话 / 已回答 / FAQ 命中,按时间桶聚合"
        >
          {trends.isLoading ? (
            <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载中…
            </div>
          ) : !trends.data || trends.data.length === 0 ? (
            <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
              暂无趋势数据
            </div>
          ) : (
            <div className="p-4">
              <TrendChart<TrendPoint>
                data={trends.data}
                xKey={(d) => d.date}
                yKeys={series}
                height={240}
              />
            </div>
          )}
        </SectionCard>

        {/* Top 热门问题 */}
        <SectionCard
          title="Top 10 热门问题"
          description="按命中次数排序,可作为 FAQ 沉淀的候选清单。点击行查看最近 20 条记录"
        >
          {/* 筛选 chip:全部 / 已回答 / FAQ 命中 */}
          <div className="flex items-center justify-between border-b px-4 py-2">
            <div className="flex items-center gap-1 rounded-md border bg-background p-0.5">
              {TOP_FILTER_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setTopFilter(o.value)}
                  className={
                    'rounded px-2.5 py-1 text-xs transition-colors ' +
                    (topFilter === o.value
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground')
                  }
                >
                  {o.label}
                </button>
              ))}
            </div>
            <span className="text-[10px] text-muted-foreground">
              {topQuestions.data
                ? `${RANGE_OPTIONS.find((r) => r.value === range)?.label ?? ''} 内`
                : ' '}
            </span>
          </div>
          {topQuestions.isLoading ? (
            <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载中…
            </div>
          ) : top.length === 0 ? (
            <div className="flex h-60 flex-col items-center justify-center gap-1 px-6 text-center text-sm text-muted-foreground">
              <span>该筛选条件下暂无热门问题</span>
              {topFilter !== 'all' ? (
                <button
                  type="button"
                  onClick={() => setTopFilter('all')}
                  className="text-xs text-primary hover:underline"
                >
                  切到「全部」看看
                </button>
              ) : (
                <span className="text-[11px]">
                  提示:试试扩大时间范围(24h → 7d → 30d)
                </span>
              )}
            </div>
          ) : (
            <ul className="divide-y">
              {top.map((q, i) => {
                const w = Math.max(2, Math.round((q.count / maxCount) * 100));
                const answeredRatio =
                  typeof q.answeredCount === 'number' && q.count > 0
                    ? q.answeredCount / q.count
                    : null;
                return (
                  <li key={`${q.query}-${i}`}>
                    <button
                      type="button"
                      onClick={() => setDrilldown(q)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/50"
                      title="查看最近的问答记录"
                    >
                      <span className="w-6 shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm" title={q.query}>
                          {q.query}
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full bg-primary"
                            style={{ width: `${w}%` }}
                          />
                        </div>
                      </div>
                      <div className="ml-2 flex shrink-0 flex-col items-end gap-0.5">
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                          ×{q.count}
                        </span>
                        {answeredRatio !== null ? (
                          <span
                            className={
                              'font-mono text-[10px] tabular-nums ' +
                              (answeredRatio >= 0.8
                                ? 'text-primary'
                                : answeredRatio >= 0.4
                                  ? 'text-muted-foreground'
                                  : 'text-destructive')
                            }
                            title={`${q.answeredCount} 次被回答 / ${q.count} 次提问`}
                          >
                            回答率 {(answeredRatio * 100).toFixed(0)}%
                          </span>
                        ) : null}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      </div>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>看板说明</DialogTitle>
            <DialogDescription>
              所有数据来自问答流水,按所选时间区间聚合
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            <li>
              · <strong>总提问数</strong>:所选时间区间内的提问次数(RagLog 计数)
            </li>
            <li>
              · <strong>独立访客(UV)</strong>:通过会话 visitorId 去重后的访客数
            </li>
            <li>
              · <strong>FAQ 命中率</strong>:faqHit/totalQuestions
            </li>
            <li>
              · <strong>好评率</strong>:用户反馈 UP 在所有反馈中的占比
            </li>
            <li>
              · <strong>平均耗时</strong>:RAG 调用耗时 latencyMs 的平均值
            </li>
            <li>
              · <strong>导出 CSV</strong>:导出原始问答日志,带 UTF-8 BOM(Excel 友好)
            </li>
          </ul>
        </DialogContent>
      </Dialog>

      {/* Top 问题下钻:查看该问题最近的 20 条问答流水 */}
      <Dialog
        open={Boolean(drilldown)}
        onOpenChange={(open) => !open && setDrilldown(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="truncate" title={drilldown?.query}>
              「{drilldown?.query ?? ''}」的最近记录
            </DialogTitle>
            <DialogDescription>
              {drilldown
                ? `共 ${drilldown.count} 次提问,${drilldown.answeredCount ?? 0} 次被回答`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {drilldownLogs.isLoading ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载中…
            </div>
          ) : (drilldownLogs.data?.length ?? 0) === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              没有匹配的问答记录
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="px-3 py-2 text-left font-medium">时间</th>
                    <th className="px-3 py-2 text-left font-medium">结果</th>
                    <th className="px-3 py-2 text-right font-medium">置信度</th>
                    <th className="px-3 py-2 text-right font-medium">耗时</th>
                  </tr>
                </thead>
                <tbody>
                  {drilldownLogs.data?.map((r) => (
                    <tr key={r.id} className="border-b last:border-b-0">
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {new Date(r.createdAt).toLocaleString('zh-CN')}
                      </td>
                      <td className="px-3 py-2">
                        {r.faqHit ? (
                          <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-foreground">
                            FAQ 命中
                          </span>
                        ) : r.isAnswered ? (
                          <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">
                            已回答
                          </span>
                        ) : (
                          <span
                            className="rounded bg-destructive px-1.5 py-0.5 text-[10px] text-destructive-foreground"
                            title={r.rejectReason ?? ''}
                          >
                            拒答
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                        {typeof r.confidence === 'number'
                          ? `${(r.confidence * 100).toFixed(0)}%`
                          : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {r.latencyMs}ms
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function fmtNumber(v: unknown): string {
  if (typeof v !== 'number' || Number.isNaN(v)) return '—';
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(Math.round(v));
}
