import * as React from 'react';
import { Download, Search, MessageSquare, Bot, Clock, ThumbsUp, ThumbsDown } from 'lucide-react';

import { useAuthStore } from '@/lib/store/auth';
import { FeedbackAdminApi, type PaginatedResult } from '@/lib/api/endpoints';
import { unwrap } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SectionCard } from '@/components/admin/section';
import { AdminEmpty } from '@/components/admin/empty';
import { AdminPagination } from '@/components/admin/pagination';
import { cn } from '@/lib/utils';

interface FeedbackItem {
  id: string;
  messageId: string;
  rating: 'UP' | 'DOWN';
  comment: string | null;
  createdAt: string;
  message?: {
    id: string;
    content: string;
    sessionId: string;
    session?: { visitorId: string | null; title: string | null } | null;
  } | null;
}

const RANGE_OPTIONS = [
  { value: '24h', label: '24 小时' },
  { value: '7d', label: '7 天' },
  { value: '30d', label: '30 天' },
] as const;

export default function AdminFeedbackPage() {
  const { accessToken } = useAuthStore();
  const [range, setRange] = React.useState<'24h' | '7d' | '30d'>('7d');
  const [keyword, setKeyword] = React.useState('');
  const [appliedKeyword, setAppliedKeyword] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [items, setItems] = React.useState<FeedbackItem[]>([]);
  const [total, setTotal] = React.useState(0);
  const [totalPages, setTotalPages] = React.useState(1);
  const [loading, setLoading] = React.useState(false);

  const fetchList = React.useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const resp = await FeedbackAdminApi.list({
        range,
        keyword: appliedKeyword || undefined,
        page,
        pageSize: 20,
      });
      const data = unwrap(resp) as PaginatedResult<FeedbackItem>;
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
      setTotalPages(data.totalPages ?? 1);
    } catch {
      setItems([]);
      setTotal(0);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  }, [accessToken, range, appliedKeyword, page]);

  React.useEffect(() => {
    fetchList();
  }, [fetchList]);

  const handleSearch = () => {
    setPage(1);
    setAppliedKeyword(keyword.trim());
  };

  const handleExport = () => {
    if (!accessToken) return;
    const url = FeedbackAdminApi.exportCsvUrl({
      range,
      keyword: appliedKeyword || undefined,
    });
    // 带 token 触发下载
    fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `feedbacks-${range}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      });
  };

  return (
    <SectionCard
      title="反馈管理"
      description="家长/学生对答的点赞/点踩与文字反馈,支持 CSV 导出"
      contentClassName="p-0 flex flex-col flex-1"
      actions={
        <div className="flex items-center gap-2">
          <div className="flex rounded-full border border-black/20 p-0.5 text-xs bg-black/[0.02]">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setRange(opt.value);
                  setPage(1);
                }}
                className={cn(
                  'rounded-full px-3 py-1.5 font-medium transition-all',
                  range === opt.value
                    ? 'bg-black text-white shadow-sm'
                    : 'text-black/60 hover:text-black',
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={handleExport} className="gap-2">
            <Download className="h-4 w-4" />
            导出 CSV
          </Button>
        </div>
      }
    >
      <div className="flex flex-col flex-1 h-full">
        {/* 搜索栏 */}
        <div className="p-4 border-b bg-white">
          <div className="flex items-center gap-3 max-w-2xl">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/40" />
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="搜索反馈内容/留言..."
                className="pl-9 bg-white border-black/15 focus-visible:ring-black"
              />
            </div>
            <Button onClick={handleSearch} className="bg-black text-white hover:bg-black/90">
              搜索
            </Button>
          </div>
        </div>

        {/* 列表 */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-black/[0.02]">
          {loading ? (
            <div className="py-12 flex justify-center items-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black"></div>
            </div>
          ) : items.length === 0 ? (
            <AdminEmpty
              title="暂无反馈"
              description="当前时间范围内还没有收到用户反馈"
            />
          ) : (
            <div className="grid gap-4">
              {items.map((f) => (
                <div 
                  key={f.id} 
                  className="bg-white rounded-lg border border-black/10 shadow-sm transition-all hover:shadow-md hover:border-black/20 overflow-hidden"
                >
                  <div className="flex flex-wrap items-center justify-between gap-4 p-4 border-b border-black/5 bg-black/[0.01]">
                    <div className="flex items-center gap-3">
                      {f.rating === 'UP' ? (
                        <div className="flex items-center gap-1.5 text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full text-xs font-medium border border-emerald-200">
                          <ThumbsUp className="w-3.5 h-3.5" />
                          <span>有帮助</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-rose-700 bg-rose-50 px-2.5 py-1 rounded-full text-xs font-medium border border-rose-200">
                          <ThumbsDown className="w-3.5 h-3.5" />
                          <span>没帮助</span>
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 text-xs text-black/50">
                        <Clock className="w-3.5 h-3.5" />
                        {new Date(f.createdAt).toLocaleString('zh-CN')}
                      </div>
                    </div>
                    {f.message?.session && (
                      <div className="text-xs text-black/60 font-medium px-2.5 py-1 rounded-md bg-black/[0.03] border border-black/10">
                        会话: {f.message.session.title ?? f.message.sessionId.slice(0, 8)}
                      </div>
                    )}
                  </div>
                  
                  <div className="p-4 space-y-4">
                    {f.message?.content && (
                      <div className="flex gap-3 text-sm">
                        <Bot className="w-5 h-5 text-black/60 shrink-0 mt-0.5" />
                        <div className="flex-1 bg-black/[0.02] p-3 rounded-md border-l-2 border-black/20 text-black/80 leading-relaxed">
                          {f.message.content}
                        </div>
                      </div>
                    )}
                    
                    {f.comment && (
                      <div className="flex gap-3 text-sm">
                        <MessageSquare className="w-5 h-5 text-black shrink-0 mt-0.5" />
                        <div className="flex-1 bg-black/[0.04] p-3 rounded-md border border-black/10 text-black font-medium leading-relaxed">
                          {f.comment}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-black/10 bg-white">
          <AdminPagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={20}
            onPageChange={setPage}
          />
        </div>
      </div>
    </SectionCard>
  );
}
