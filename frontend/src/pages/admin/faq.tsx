import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { AdminBadge } from '@/components/admin/badge';
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
import { FaqAdminApi, type ID, type PaginatedResult } from '@/lib/api/endpoints';
import { useAuthStore } from '@/lib/store/auth';
import { useAdminAuth } from '@/hooks/use-admin-auth';

interface FaqItem {
  id: ID;
  question: string;
  answer: string;
  category?: string | null;
  hitCount?: number;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface FaqFormState {
  question: string;
  answer: string;
  category: string;
  isActive: boolean;
}

const EMPTY_FORM: FaqFormState = {
  question: '',
  answer: '',
  category: '',
  isActive: true,
};

export default function AdminFaqPage() {
  useAdminAuth();

  const qc = useQueryClient();
  const [page, setPage] = React.useState(1);
  const [pageSize] = React.useState(20);
  const [keyword, setKeyword] = React.useState('');

  const list = useQuery({
    queryKey: ['admin', 'faqs', page, pageSize, keyword],
    queryFn: async () => {
      const resp = await FaqAdminApi.list({
        page,
        pageSize,
        keyword: keyword || undefined,
      });
      return unwrap(resp) as PaginatedResult<FaqItem>;
    },
  });

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<FaqItem | null>(null);
  const [form, setForm] = React.useState<FaqFormState>(EMPTY_FORM);

  const [deleteTarget, setDeleteTarget] = React.useState<FaqItem | null>(null);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (item: FaqItem) => {
    setEditing(item);
    setForm({
      question: item.question ?? '',
      answer: item.answer ?? '',
      category: item.category ?? '',
      isActive: item.isActive !== false,
    });
    setFormOpen(true);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        question: form.question.trim(),
        answer: form.answer.trim(),
        category: form.category.trim() || undefined,
        isActive: form.isActive,
      };
      if (!payload.question) throw new ApiError(40001, '问题不能为空');
      if (!payload.answer) throw new ApiError(40001, '答案不能为空');
      if (editing) {
        const resp = await FaqAdminApi.update(editing.id, payload);
        return unwrap(resp);
      }
      const resp = await FaqAdminApi.create(payload);
      return unwrap(resp);
    },
    onSuccess: () => {
      toast.success(editing ? 'FAQ 已更新' : 'FAQ 已创建');
      setFormOpen(false);
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['admin', 'faqs'] });
    },
    onError: (err) => {
      if (err instanceof ApiError) toast.error(err.message);
      else toast.error('保存失败');
    },
  });

  const removeMut = useMutation({
    mutationFn: async (id: ID) => {
      const resp = await FaqAdminApi.remove(id);
      return unwrap(resp);
    },
    onSuccess: () => {
      toast.success('FAQ 已删除');
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ['admin', 'faqs'] });
    },
    onError: (err) => {
      if (err instanceof ApiError) toast.error(err.message);
      else toast.error('删除失败');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (saveMut.isPending) return;
    saveMut.mutate();
  };

  const [exporting, setExporting] = React.useState(false);
  const handleExport = async () => {
    setExporting(true);
    try {
      const url = FaqAdminApi.exportCsvUrl(keyword || undefined);
      const accessToken = useAuthStore.getState().accessToken;
      const resp = await fetch(url, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        credentials: 'include',
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `faqs-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      toast.success('FAQ CSV 已开始下载');
    } catch (e) {
      toast.error(`导出失败: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  const total = list.data?.total ?? 0;
  const totalPages = list.data?.totalPages ?? 1;
  const items = list.data?.items ?? [];

  return (
    <div className="space-y-4">
      <SectionCard
        title="FAQ 管理"
        description="维护招生常见问答 — 命中 FAQ 时直接返回,绕开 LLM"
        actions={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={keyword}
                onChange={(e) => {
                  setKeyword(e.target.value);
                  setPage(1);
                }}
                placeholder="搜索问题/答案"
                className="h-9 w-56 pl-7"
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1"
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              导出
            </Button>
            <Button size="sm" className="gap-1" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              新建
            </Button>
          </>
        }
      >
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">问题</th>
                <th className="px-4 py-2.5 text-left font-medium">答案</th>
                <th className="px-4 py-2.5 text-left font-medium">分类</th>
                <th className="px-4 py-2.5 text-right font-medium">命中</th>
                <th className="px-4 py-2.5 text-left font-medium">状态</th>
                <th className="px-4 py-2.5 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {list.isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
                    加载中…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <AdminEmpty
                      title="暂无 FAQ"
                      description={keyword ? '尝试更换关键词' : '点击右上角"新建"创建第一条 FAQ'}
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
                      {it.question}
                    </td>
                    <td className="max-w-[360px] truncate px-4 py-2.5 text-muted-foreground">
                      {it.answer}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {it.category ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {it.hitCount ?? 0}
                    </td>
                    <td className="px-4 py-2.5">
                      <AdminBadge
                        status={it.isActive === false ? 'false' : 'true'}
                        label={it.isActive === false ? '已停用' : '启用中'}
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 px-2"
                          onClick={() => openEdit(it)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          编辑
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 px-2 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(it)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          删除
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

      {/* 新建/编辑 Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑 FAQ' : '新建 FAQ'}</DialogTitle>
            <DialogDescription>
              命中 FAQ 关键词的问题将直接返回该答案,不再走 RAG
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={handleSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="faq-q">问题</Label>
              <Input
                id="faq-q"
                value={form.question}
                onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))}
                placeholder="例如:五邑大学国际本科的学费是多少?"
                required
                maxLength={500}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="faq-a">答案</Label>
              <textarea
                id="faq-a"
                value={form.answer}
                onChange={(e) => setForm((f) => ({ ...f, answer: e.target.value }))}
                placeholder="标准答案(支持纯文本,换行保留)"
                required
                rows={6}
                maxLength={4000}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="faq-c">分类(可选)</Label>
                <Input
                  id="faq-c"
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  placeholder="如:学费/住宿/报考"
                  maxLength={64}
                />
              </div>
              <div className="flex items-end pb-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, isActive: e.target.checked }))
                    }
                    className="h-4 w-4 rounded border-input"
                  />
                  <span>启用(取消后不再被检索)</span>
                </label>
              </div>
            </div>
            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setFormOpen(false)}
                disabled={saveMut.isPending}
              >
                取消
              </Button>
              <Button type="submit" disabled={saveMut.isPending}>
                {saveMut.isPending ? (
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
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除 FAQ</DialogTitle>
            <DialogDescription>
              确定要删除「{deleteTarget?.question}」吗?此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={removeMut.isPending}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && removeMut.mutate(deleteTarget.id)}
              disabled={removeMut.isPending}
            >
              {removeMut.isPending ? '删除中…' : '删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
