import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, Power, Plus, Trash2 } from 'lucide-react';
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
import {
  KbVersionApi,
  type ID,
  type PaginatedResult,
} from '@/lib/api/endpoints';
import { useAdminAuth } from '@/hooks/use-admin-auth';

interface KbItem {
  id: ID;
  version: string;
  description?: string | null;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface KbFormState {
  version: string;
  description: string;
  activateNow: boolean;
}

const EMPTY_FORM: KbFormState = {
  version: '',
  description: '',
  activateNow: false,
};

export default function AdminKbVersionsPage() {
  useAdminAuth();

  const qc = useQueryClient();
  const [page, setPage] = React.useState(1);
  const [pageSize] = React.useState(20);

  const list = useQuery({
    queryKey: ['admin', 'kb-versions', page, pageSize],
    queryFn: async () => {
      const resp = await KbVersionApi.list({ page, pageSize });
      return unwrap(resp) as PaginatedResult<KbItem>;
    },
  });

  const [formOpen, setFormOpen] = React.useState(false);
  const [form, setForm] = React.useState<KbFormState>(EMPTY_FORM);

  const [deleteTarget, setDeleteTarget] = React.useState<KbItem | null>(null);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        version: form.version.trim(),
        description: form.description.trim() || undefined,
        isActive: form.activateNow,
      };
      if (!payload.version) throw new ApiError(40001, '版本号不能为空');
      const resp = await KbVersionApi.create(payload);
      return unwrap(resp);
    },
    onSuccess: () => {
      toast.success('版本已创建');
      setFormOpen(false);
      qc.invalidateQueries({ queryKey: ['admin', 'kb-versions'] });
    },
    onError: (err) => {
      if (err instanceof ApiError) toast.error(err.message);
      else toast.error('创建失败');
    },
  });

  const activateMut = useMutation({
    mutationFn: async (id: ID) => {
      const resp = await KbVersionApi.activate(id);
      return unwrap(resp);
    },
    onSuccess: () => {
      toast.success('已切换为当前激活版本');
      qc.invalidateQueries({ queryKey: ['admin', 'kb-versions'] });
    },
    onError: (err) => {
      if (err instanceof ApiError) toast.error(err.message);
      else toast.error('激活失败');
    },
  });

  const removeMut = useMutation({
    mutationFn: async (id: ID) => {
      const resp = await KbVersionApi.remove(id);
      return unwrap(resp);
    },
    onSuccess: () => {
      toast.success('版本已删除');
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ['admin', 'kb-versions'] });
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

  const total = list.data?.total ?? 0;
  const totalPages = list.data?.totalPages ?? 1;
  const items = list.data?.items ?? [];

  return (
    <div className="space-y-4">
      <SectionCard
        title="KB 版本"
        description="同一时间仅一个版本为 ACTIVE — 上传文档、查询均走激活版"
        actions={
          <Button size="sm" className="gap-1" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            新建版本
          </Button>
        }
      >
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">版本号</th>
                <th className="px-4 py-2.5 text-left font-medium">描述</th>
                <th className="px-4 py-2.5 text-left font-medium">状态</th>
                <th className="px-4 py-2.5 text-left font-medium">创建时间</th>
                <th className="px-4 py-2.5 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {list.isLoading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                    <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
                    加载中…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <AdminEmpty
                      title="暂无 KB 版本"
                      description={'点击右上角"新建版本"创建第一个版本'}
                    />
                  </td>
                </tr>
              ) : (
                items.map((it) => (
                  <tr
                    key={it.id}
                    className="border-t transition-colors hover:bg-muted/30"
                  >
                    <td className="px-4 py-2.5 font-mono font-medium">
                      {it.version}
                    </td>
                    <td className="max-w-[420px] truncate px-4 py-2.5 text-muted-foreground">
                      {it.description ?? '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      {it.isActive ? (
                        <span className="inline-flex items-center gap-1 rounded-md border border-primary bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                          <CheckCircle2 className="h-3 w-3" />
                          ACTIVE
                        </span>
                      ) : (
                        <AdminBadge status="ARCHIVED" label="INACTIVE" />
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {it.createdAt
                        ? new Date(it.createdAt).toLocaleString('zh-CN', {
                            hour12: false,
                          })
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        {it.isActive ? null : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 gap-1 px-2 text-primary hover:text-primary"
                            onClick={() => activateMut.mutate(it.id)}
                            disabled={activateMut.isPending}
                          >
                            <Power className="h-3.5 w-3.5" />
                            激活
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 px-2 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(it)}
                          disabled={it.isActive}
                          title={it.isActive ? '激活版本不可删除' : '删除版本'}
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

      {/* 新建版本 Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>新建 KB 版本</DialogTitle>
            <DialogDescription>
              建议使用语义化版本号,如 2026-q1 / 2026.01
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={handleSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="kb-v">版本号</Label>
              <Input
                id="kb-v"
                value={form.version}
                onChange={(e) => setForm((f) => ({ ...f, version: e.target.value }))}
                placeholder="如:2026-q1"
                required
                maxLength={64}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kb-d">描述(可选)</Label>
              <textarea
                id="kb-d"
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                rows={3}
                maxLength={500}
                placeholder="本次版本包含的更新/变更说明"
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.activateNow}
                onChange={(e) =>
                  setForm((f) => ({ ...f, activateNow: e.target.checked }))
                }
                className="h-4 w-4 rounded border-input"
              />
              <span>创建后立即激活为当前版本</span>
            </label>
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
                    创建中…
                  </>
                ) : (
                  '创建'
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
            <DialogTitle>删除版本</DialogTitle>
            <DialogDescription>
              确定要删除版本「{deleteTarget?.version}」吗?
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
