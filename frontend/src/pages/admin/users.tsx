import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Copy,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
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
import { UserApi, type ID, type PaginatedResult } from '@/lib/api/endpoints';
import { useAdminAuth } from '@/hooks/use-admin-auth';

type UserStatus = 'ACTIVE' | 'DISABLED';

interface UserItem {
  id: ID;
  username: string;
  email?: string | null;
  displayName?: string | null;
  roleName: string;
  status: UserStatus;
  createdAt?: string;
  updatedAt?: string;
}

interface UserFormState {
  username: string;
  email: string;
  displayName: string;
  password: string;
  roleName: string;
  status: UserStatus;
}

const EMPTY_CREATE: UserFormState = {
  username: '',
  email: '',
  displayName: '',
  password: '',
  roleName: 'operator',
  status: 'ACTIVE',
};

const EMPTY_EDIT: Omit<UserFormState, 'password'> = {
  username: '',
  email: '',
  displayName: '',
  roleName: 'operator',
  status: 'ACTIVE',
};

const ROLE_OPTIONS = [
  { value: 'admin', label: 'admin · 超级管理员' },
  { value: 'operator', label: 'operator · 运营' },
  { value: 'viewer', label: 'viewer · 只读' },
];

export default function AdminUsersPage() {
  useAdminAuth();

  const qc = useQueryClient();
  const [page, setPage] = React.useState(1);
  const [pageSize] = React.useState(20);
  const [keyword, setKeyword] = React.useState('');

  const list = useQuery({
    queryKey: ['admin', 'users', page, pageSize, keyword],
    queryFn: async () => {
      const resp = await UserApi.list({
        page,
        pageSize,
        keyword: keyword || undefined,
      });
      return unwrap(resp) as PaginatedResult<UserItem>;
    },
  });

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<UserItem | null>(null);
  const [form, setForm] = React.useState<UserFormState>(EMPTY_CREATE);

  const [deleteTarget, setDeleteTarget] = React.useState<UserItem | null>(null);

  const [resetTarget, setResetTarget] = React.useState<UserItem | null>(null);
  const [resetPasswordInput, setResetPasswordInput] = React.useState('');
  const [resetResultPwd, setResetResultPwd] = React.useState<string | null>(null);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_CREATE);
    setFormOpen(true);
  };

  const openEdit = (item: UserItem) => {
    setEditing(item);
    setForm({
      ...EMPTY_EDIT,
      username: item.username,
      email: item.email ?? '',
      displayName: item.displayName ?? '',
      roleName: item.roleName,
      status: item.status,
      password: '',
    });
    setFormOpen(true);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      if (editing) {
        const payload = {
          displayName: form.displayName.trim() || undefined,
          email: form.email.trim() || undefined,
          roleName: form.roleName,
          status: form.status,
        };
        const resp = await UserApi.update(editing.id, payload);
        return unwrap(resp);
      }
      const payload = {
        username: form.username.trim(),
        password: form.password,
        email: form.email.trim() || undefined,
        displayName: form.displayName.trim() || undefined,
        roleName: form.roleName,
      };
      if (!payload.username) throw new ApiError(40001, '用户名不能为空');
      if (!payload.password || payload.password.length < 6)
        throw new ApiError(40001, '密码至少 6 位');
      const resp = await UserApi.create(payload);
      return unwrap(resp);
    },
    onSuccess: () => {
      toast.success(editing ? '用户已更新' : '用户已创建');
      setFormOpen(false);
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (err) => {
      if (err instanceof ApiError) toast.error(err.message);
      else toast.error('保存失败');
    },
  });

  const removeMut = useMutation({
    mutationFn: async (id: ID) => {
      const resp = await UserApi.remove(id);
      return unwrap(resp);
    },
    onSuccess: () => {
      toast.success('用户已删除');
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (err) => {
      if (err instanceof ApiError) toast.error(err.message);
      else toast.error('删除失败');
    },
  });

  /**
   * 重置密码 — 后端约定:POST /:id/reset-password,body { password }
   * 后端在 ResetPasswordResponseDto 中返回新密码(明文),前端一次性展示
   * 协议(若调整):后端可以只返回 { sentToEmail: true },前端只提示"已发送至邮箱"
   */
  const resetMut = useMutation({
    mutationFn: async () => {
      if (!resetTarget) return null;
      const pwd = resetPasswordInput.trim();
      if (pwd.length < 6) throw new ApiError(40001, '新密码至少 6 位');
      const resp = await UserApi.resetPassword(resetTarget.id, pwd);
      return unwrap(resp) as { password?: string; sentToEmail?: boolean };
    },
    onSuccess: (data) => {
      if (data?.password) {
        setResetResultPwd(data.password);
      } else if (data?.sentToEmail) {
        toast.success('新密码已发送至用户邮箱');
        setResetTarget(null);
        setResetPasswordInput('');
      } else {
        toast.success('密码已重置');
        setResetTarget(null);
        setResetPasswordInput('');
      }
    },
    onError: (err) => {
      if (err instanceof ApiError) toast.error(err.message);
      else toast.error('重置失败');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (saveMut.isPending) return;
    saveMut.mutate();
  };

  const handleReset = (e: React.FormEvent) => {
    e.preventDefault();
    if (resetMut.isPending) return;
    resetMut.mutate();
  };

  const closeResetDialog = (open: boolean) => {
    if (!open) {
      setResetTarget(null);
      setResetPasswordInput('');
      setResetResultPwd(null);
    }
  };

  const total = list.data?.total ?? 0;
  const totalPages = list.data?.totalPages ?? 1;
  const items = list.data?.items ?? [];

  return (
    <div className="space-y-4">
      <SectionCard
        title="用户管理"
        description="管理后台账号、角色与启停状态"
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
                placeholder="搜索用户名/邮箱"
                className="h-9 w-56 pl-7"
              />
            </div>
            <Button size="sm" className="gap-1" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              新建用户
            </Button>
          </>
        }
      >
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">用户名</th>
                <th className="px-4 py-2.5 text-left font-medium">邮箱</th>
                <th className="px-4 py-2.5 text-left font-medium">角色</th>
                <th className="px-4 py-2.5 text-left font-medium">状态</th>
                <th className="px-4 py-2.5 text-left font-medium">创建时间</th>
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
                      title="暂无用户"
                      description={keyword ? '尝试更换关键词' : '点击右上角"新建用户"创建第一个账号'}
                    />
                  </td>
                </tr>
              ) : (
                items.map((it) => (
                  <tr
                    key={it.id}
                    className="border-t transition-colors hover:bg-muted/30"
                  >
                    <td className="px-4 py-2.5 font-medium">{it.username}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {it.email ?? '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <AdminBadge status="true" label={it.roleName} />
                    </td>
                    <td className="px-4 py-2.5">
                      <AdminBadge
                        status={it.status}
                        label={it.status === 'ACTIVE' ? '启用' : '停用'}
                      />
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
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 px-2"
                          onClick={() => {
                            setResetTarget(it);
                            setResetPasswordInput('');
                            setResetResultPwd(null);
                          }}
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                          重置密码
                        </Button>
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑用户' : '新建用户'}</DialogTitle>
            <DialogDescription>
              {editing
                ? '编辑邮箱、显示名、角色与状态 — 用户名不可修改'
                : '创建后台账号,初始密码请告知本人妥善保管'}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={handleSubmit}>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="u-name">用户名</Label>
                <Input
                  id="u-name"
                  value={form.username}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, username: e.target.value }))
                  }
                  disabled={Boolean(editing)}
                  placeholder="登录用户名"
                  required
                  maxLength={64}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="u-email">邮箱</Label>
                <Input
                  id="u-email"
                  type="email"
                  value={form.email}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, email: e.target.value }))
                  }
                  placeholder="可选"
                  maxLength={128}
                />
              </div>
            </div>
            {editing ? null : (
              <div className="space-y-1.5">
                <Label htmlFor="u-pwd">初始密码</Label>
                <Input
                  id="u-pwd"
                  type="text"
                  value={form.password}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, password: e.target.value }))
                  }
                  placeholder="至少 6 位"
                  minLength={6}
                  required
                  maxLength={128}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="u-dn">显示名</Label>
              <Input
                id="u-dn"
                value={form.displayName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, displayName: e.target.value }))
                }
                placeholder="可选,如:李老师"
                maxLength={64}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="u-role">角色</Label>
                <select
                  id="u-role"
                  value={form.roleName}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, roleName: e.target.value }))
                  }
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end pb-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.status === 'ACTIVE'}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        status: e.target.checked ? 'ACTIVE' : 'DISABLED',
                      }))
                    }
                    className="h-4 w-4 rounded border-input"
                  />
                  <span>启用(可登录)</span>
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

      {/* 重置密码 Dialog */}
      <Dialog open={Boolean(resetTarget)} onOpenChange={closeResetDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>重置密码</DialogTitle>
            <DialogDescription>
              为「{resetTarget?.username}」设置新密码 — 至少 6 位
            </DialogDescription>
          </DialogHeader>
          {resetResultPwd ? (
            <div className="space-y-3">
              <div className="rounded-md border border-border bg-secondary px-3 py-2 text-xs text-foreground">
                后端已返回明文新密码 — 请复制并通过安全渠道告知本人,关闭后无法再次查看
              </div>
              <div className="flex items-center gap-2">
                <Input value={resetResultPwd} readOnly className="font-mono" />
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard
                      .writeText(resetResultPwd)
                      .then(() => toast.success('已复制'))
                      .catch(() => toast.error('复制失败'));
                  }}
                  aria-label="复制密码"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={() => closeResetDialog(false)}>我已记录</Button>
              </DialogFooter>
            </div>
          ) : (
            <form className="space-y-3" onSubmit={handleReset}>
              <div className="space-y-1.5">
                <Label htmlFor="rp-pwd">新密码</Label>
                <Input
                  id="rp-pwd"
                  type="text"
                  value={resetPasswordInput}
                  onChange={(e) => setResetPasswordInput(e.target.value)}
                  placeholder="至少 6 位"
                  minLength={6}
                  maxLength={128}
                  required
                />
              </div>
              <DialogFooter className="pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => closeResetDialog(false)}
                  disabled={resetMut.isPending}
                >
                  取消
                </Button>
                <Button type="submit" disabled={resetMut.isPending}>
                  {resetMut.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      重置中…
                    </>
                  ) : (
                    '重置'
                  )}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除用户</DialogTitle>
            <DialogDescription>
              确定要删除用户「{deleteTarget?.username}」吗?此操作不可撤销。
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
