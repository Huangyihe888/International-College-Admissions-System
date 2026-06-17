import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Filter,
  Loader2,
  MessageSquareWarning,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';

import { AdminEmpty } from '@/components/admin/empty';
import { AdminPagination } from '@/components/admin/pagination';
import { SectionCard } from '@/components/admin/section';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, unwrap } from '@/lib/api/client';
import {
  LowConfidenceApi,
  type ID,
  type PaginatedResult,
} from '@/lib/api/endpoints';
import { useAdminAuth } from '@/hooks/use-admin-auth';

interface LcItem {
  id: ID;
  query: string;
  answer?: string | null;
  confidence: number;
  kbHitId?: string | null;
  category?: string | null;
  isAnswered?: boolean;
  answeredAnswer?: string | null;
  answeredCategory?: string | null;
  createdAt?: string;
}

interface AnswerFormState {
  answer: string;
  category: string;
}

const EMPTY_ANSWER: AnswerFormState = {
  answer: '',
  category: '',
};

type AnsweredFilter = 'all' | 'pending' | 'answered';

export default function AdminLowConfidencePage() {
  useAdminAuth();

  const qc = useQueryClient();
  const [page, setPage] = React.useState(1);
  const [pageSize] = React.useState(20);
  const [answered, setAnswered] = React.useState<AnsweredFilter>('pending');
  const [keyword, setKeyword] = React.useState('');

  const list = useQuery({
    queryKey: ['admin', 'low-confidence', page, pageSize, answered, keyword],
    queryFn: async () => {
      const resp = await LowConfidenceApi.list({
        page,
        pageSize,
        keyword: keyword || undefined,
        isAnswered:
          answered === 'all' ? undefined : answered === 'answered',
      });
      return unwrap(resp) as PaginatedResult<LcItem>;
    },
  });

  const [answerTarget, setAnswerTarget] = React.useState<LcItem | null>(null);
  const [form, setForm] = React.useState<AnswerFormState>(EMPTY_ANSWER);

  const openAnswer = (it: LcItem) => {
    setAnswerTarget(it);
    setForm({
      answer: it.answeredAnswer ?? '',
      category: it.answeredCategory ?? it.category ?? '',
    });
  };

  const answerMut = useMutation({
    mutationFn: async () => {
      if (!answerTarget) return null;
      const answer = form.answer.trim();
      if (!answer) throw new ApiError(40001, '答案不能为空');
      const resp = await LowConfidenceApi.answer(answerTarget.id, {
        answer,
        category: form.category.trim() || undefined,
      });
      return unwrap(resp);
    },
    onSuccess: () => {
      toast.success('已保存人工补答');
      setAnswerTarget(null);
      qc.invalidateQueries({ queryKey: ['admin', 'low-confidence'] });
    },
    onError: (err) => {
      if (err instanceof ApiError) toast.error(err.message);
      else toast.error('保存失败');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (answerMut.isPending) return;
    answerMut.mutate();
  };

  const total = list.data?.total ?? 0;
  const totalPages = list.data?.totalPages ?? 1;
  const items = list.data?.items ?? [];

  return (
    <div className="space-y-4">
      <SectionCard
        title="低置信度问题"
        description="AI 回答置信度低于阈值时落入此清单 — 老师补答后可沉淀为 FAQ"
        actions={
          <>
            <div className="flex items-center gap-1 rounded-md border bg-background p-0.5">
              {(['pending', 'answered', 'all'] as AnsweredFilter[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setAnswered(k);
                    setPage(1);
                  }}
                  className={
                    'rounded px-2.5 py-1 text-xs transition-colors ' +
                    (answered === k
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground')
                  }
                >
                  {k === 'pending' ? '待补答' : k === 'answered' ? '已补答' : '全部'}
                </button>
              ))}
            </div>
            <div className="relative">
              <Filter className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={keyword}
                onChange={(e) => {
                  setKeyword(e.target.value);
                  setPage(1);
                }}
                placeholder="搜索问题"
                className="h-9 w-56 pl-7"
              />
            </div>
          </>
        }
      >
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">问题</th>
                <th className="px-4 py-2.5 text-left font-medium">AI 答案</th>
                <th className="px-4 py-2.5 text-right font-medium">置信度</th>
                <th className="px-4 py-2.5 text-left font-medium">分类</th>
                <th className="px-4 py-2.5 text-left font-medium">时间</th>
                <th className="px-4 py-2.5 text-left font-medium">状态</th>
                <th className="px-4 py-2.5 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {list.isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
                    加载中…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <AdminEmpty
                      title={
                        answered === 'pending'
                          ? '没有待补答的问题'
                          : answered === 'answered'
                            ? '还没有补答过任何问题'
                            : '暂无低置信度问题'
                      }
                      description="AI 置信度低于阈值时会自动落入此清单"
                    />
                  </td>
                </tr>
              ) : (
                items.map((it) => (
                  <tr
                    key={it.id}
                    className="border-t transition-colors hover:bg-muted/30"
                  >
                    <td className="max-w-[280px] truncate px-4 py-2.5 font-medium">
                      {it.query}
                    </td>
                    <td className="max-w-[300px] truncate px-4 py-2.5 text-muted-foreground">
                      {it.answer ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span
                        className={
                          it.confidence < 0.5
                            ? 'font-mono text-xs font-medium text-destructive'
                            : it.confidence < 0.7
                              ? 'font-mono text-xs font-medium text-muted-foreground'
                              : 'font-mono text-xs text-muted-foreground'
                        }
                      >
                        {(it.confidence * 100).toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {it.category ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {it.createdAt
                        ? new Date(it.createdAt).toLocaleString('zh-CN', {
                            hour12: false,
                          })
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                        {it.isAnswered ? (
                          <span className="inline-flex items-center gap-1 rounded-md border border-primary bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                            <CheckCircle2 className="h-3 w-3" />
                            已补答
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary px-2 py-0.5 text-xs font-medium text-foreground">
                            <MessageSquareWarning className="h-3 w-3" />
                            待补答
                          </span>
                        )}
                      </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 px-2"
                          onClick={() => openAnswer(it)}
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          {it.isAnswered ? '查看/编辑' : '补答'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <AdminPagination
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={pageSize}
          onPageChange={setPage}
        />
      </SectionCard>

      {/* 补答 Dialog */}
      <Dialog
        open={Boolean(answerTarget)}
        onOpenChange={(o) => !o && setAnswerTarget(null)}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>人工补答</DialogTitle>
            <DialogDescription>
              补答内容可被检索使用,并可后续沉淀为 FAQ
            </DialogDescription>
          </DialogHeader>
          {answerTarget ? (
            <form className="space-y-3" onSubmit={handleSubmit}>
              <div className="space-y-1.5">
                <Label>原始问题</Label>
                <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                  {answerTarget.query}
                </div>
              </div>
              {answerTarget.answer ? (
                <div className="space-y-1.5">
                  <Label>AI 原答案</Label>
                  <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                    {answerTarget.answer}
                  </div>
                </div>
              ) : null}
              <div className="space-y-1.5">
                <Label htmlFor="lc-a">人工答案</Label>
                <textarea
                  id="lc-a"
                  value={form.answer}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, answer: e.target.value }))
                  }
                  rows={5}
                  maxLength={4000}
                  placeholder="请输入准确、可被检索引用的答案"
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lc-c">分类(可选)</Label>
                <Input
                  id="lc-c"
                  value={form.category}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, category: e.target.value }))
                  }
                  placeholder="如:学费/宿舍/报考"
                  maxLength={64}
                />
              </div>
              <DialogFooter className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAnswerTarget(null)}
                  disabled={answerMut.isPending}
                >
                  取消
                </Button>
                <Button type="submit" disabled={answerMut.isPending}>
                  {answerMut.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      保存中…
                    </>
                  ) : (
                    '保存'
                  )}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
