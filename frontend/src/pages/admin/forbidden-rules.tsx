import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  FlaskConical,
  Loader2,
  Pencil,
  Plus,
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
import {
  ForbiddenRuleApi,
  type ID,
  type PaginatedResult,
} from '@/lib/api/endpoints';
import { useAdminAuth } from '@/hooks/use-admin-auth';

type RuleType = 'KEYWORD' | 'REGEX' | 'CATEGORY';

interface RuleItem {
  id: ID;
  name: string;
  ruleType: RuleType;
  pattern: string;
  reply?: string | null;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface RuleFormState {
  name: string;
  ruleType: RuleType;
  pattern: string;
  reply: string;
  isActive: boolean;
}

const EMPTY_FORM: RuleFormState = {
  name: '',
  ruleType: 'KEYWORD',
  pattern: '',
  reply: '',
  isActive: true,
};

/**
 * 前端用同款规则 evaluate(用于"测试匹配"对话框)
 *  - KEYWORD:忽略大小写子串匹配
 *  - REGEX:new RegExp(pattern, 'i'),失败抛错时视为不命中
 *  - CATEGORY:忽略大小写子串匹配(用于问题分类字段)
 */
function evaluateRuleLocally(rule: { ruleType: RuleType; pattern: string }, text: string): boolean {
  if (!text || !rule.pattern) return false;
  if (rule.ruleType === 'KEYWORD' || rule.ruleType === 'CATEGORY') {
    return text.toLowerCase().includes(rule.pattern.toLowerCase());
  }
  if (rule.ruleType === 'REGEX') {
    try {
      return new RegExp(rule.pattern, 'i').test(text);
    } catch {
      return false;
    }
  }
  return false;
}

export default function AdminForbiddenRulesPage() {
  useAdminAuth();

  const qc = useQueryClient();
  const [page, setPage] = React.useState(1);
  const [pageSize] = React.useState(20);

  const list = useQuery({
    queryKey: ['admin', 'forbidden-rules', page, pageSize],
    queryFn: async () => {
      const resp = await ForbiddenRuleApi.list({ page, pageSize });
      return unwrap(resp) as PaginatedResult<RuleItem>;
    },
  });

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<RuleItem | null>(null);
  const [form, setForm] = React.useState<RuleFormState>(EMPTY_FORM);

  const [deleteTarget, setDeleteTarget] = React.useState<RuleItem | null>(null);

  const [testTarget, setTestTarget] = React.useState<RuleItem | null>(null);
  const [testText, setTestText] = React.useState('');

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (item: RuleItem) => {
    setEditing(item);
    setForm({
      name: item.name ?? '',
      ruleType: item.ruleType,
      pattern: item.pattern ?? '',
      reply: item.reply ?? '',
      isActive: item.isActive !== false,
    });
    setFormOpen(true);
  };

  // 校验正则(REGEX 时)
  const patternError: string | null = React.useMemo(() => {
    if (form.ruleType !== 'REGEX') return null;
    if (!form.pattern) return null;
    try {
      new RegExp(form.pattern);
      return null;
    } catch (e) {
      return `正则不合法:${(e as Error).message}`;
    }
  }, [form.ruleType, form.pattern]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        ruleType: form.ruleType,
        pattern: form.pattern.trim(),
        reply: form.reply.trim() || undefined,
        isActive: form.isActive,
      };
      if (!payload.name) throw new ApiError(40001, '规则名不能为空');
      if (!payload.pattern) throw new ApiError(40001, '匹配模式不能为空');
      if (patternError) throw new ApiError(40001, patternError);
      if (editing) {
        const resp = await ForbiddenRuleApi.update(editing.id, payload);
        return unwrap(resp);
      }
      const resp = await ForbiddenRuleApi.create(payload);
      return unwrap(resp);
    },
    onSuccess: () => {
      toast.success(editing ? '规则已更新' : '规则已创建');
      setFormOpen(false);
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['admin', 'forbidden-rules'] });
    },
    onError: (err) => {
      if (err instanceof ApiError) toast.error(err.message);
      else toast.error('保存失败');
    },
  });

  const removeMut = useMutation({
    mutationFn: async (id: ID) => {
      const resp = await ForbiddenRuleApi.remove(id);
      return unwrap(resp);
    },
    onSuccess: () => {
      toast.success('规则已删除');
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ['admin', 'forbidden-rules'] });
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

  const testResult = testTarget
    ? evaluateRuleLocally(
        { ruleType: testTarget.ruleType, pattern: testTarget.pattern },
        testText,
      )
    : false;

  return (
    <div className="space-y-4">
      <SectionCard
        title="禁答规则"
        description="命中规则的问题会被拦截,返回自定义的禁答文案,而不是直接答"
        actions={
          <Button size="sm" className="gap-1" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            新建
          </Button>
        }
      >
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">规则名</th>
                <th className="px-4 py-2.5 text-left font-medium">类型</th>
                <th className="px-4 py-2.5 text-left font-medium">Pattern</th>
                <th className="px-4 py-2.5 text-left font-medium">启用</th>
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
                      title="暂无规则"
                      description={'点击右上角"新建"添加第一条禁答规则'}
                    />
                  </td>
                </tr>
              ) : (
                items.map((it) => (
                  <tr
                    key={it.id}
                    className="border-t transition-colors hover:bg-muted/30"
                  >
                    <td className="px-4 py-2.5 font-medium">{it.name}</td>
                    <td className="px-4 py-2.5">
                      <AdminBadge status={it.ruleType} label={it.ruleType} />
                    </td>
                    <td className="max-w-[320px] truncate px-4 py-2.5 font-mono text-xs text-muted-foreground">
                      {it.pattern}
                    </td>
                    <td className="px-4 py-2.5">
                      <AdminBadge
                        status={it.isActive ? 'true' : 'false'}
                        label={it.isActive ? '启用' : '停用'}
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 px-2"
                          onClick={() => {
                            setTestTarget(it);
                            setTestText('');
                          }}
                        >
                          <FlaskConical className="h-3.5 w-3.5" />
                          测试
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
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑规则' : '新建规则'}</DialogTitle>
            <DialogDescription>
              规则按启用顺序匹配,KEYWORD 为子串匹配(忽略大小写),REGEX 为 JS 正则(忽略大小写),CATEGORY 走分类字段匹配
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={handleSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="r-name">规则名</Label>
              <Input
                id="r-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="如:屏蔽咨询 QQ"
                required
                maxLength={128}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="r-type">类型</Label>
                <select
                  id="r-type"
                  value={form.ruleType}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, ruleType: e.target.value as RuleType }))
                  }
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="KEYWORD">KEYWORD · 关键词</option>
                  <option value="REGEX">REGEX · 正则</option>
                  <option value="CATEGORY">CATEGORY · 分类</option>
                </select>
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
                  <span>启用</span>
                </label>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="r-pattern">匹配模式</Label>
              <Input
                id="r-pattern"
                value={form.pattern}
                onChange={(e) => setForm((f) => ({ ...f, pattern: e.target.value }))}
                placeholder={
                  form.ruleType === 'REGEX' ? '例如:加\\s*[我qQ]+(\\d+)' : '例如:加微信'
                }
                required
                maxLength={500}
                className="font-mono"
              />
              {patternError ? (
                <p className="flex items-center gap-1 text-xs text-destructive">
                  <AlertCircle className="h-3 w-3" />
                  {patternError}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="r-reply">禁答文案(可选)</Label>
              <textarea
                id="r-reply"
                value={form.reply}
                onChange={(e) => setForm((f) => ({ ...f, reply: e.target.value }))}
                placeholder="命中后返回的固定回复;留空则用系统默认禁答文案"
                rows={3}
                maxLength={1000}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
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
              <Button type="submit" disabled={saveMut.isPending || Boolean(patternError)}>
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

      {/* 测试匹配 Dialog */}
      <Dialog
        open={Boolean(testTarget)}
        onOpenChange={(o) => !o && setTestTarget(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>测试规则:{testTarget?.name}</DialogTitle>
            <DialogDescription>
              前端用同款 evaluator 实时演示命中结果
            </DialogDescription>
          </DialogHeader>
          {testTarget ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="t-pattern">Pattern</Label>
                <div className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs">
                  [{testTarget.ruleType}] {testTarget.pattern}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="t-input">测试输入</Label>
                <textarea
                  id="t-input"
                  value={testText}
                  onChange={(e) => setTestText(e.target.value)}
                  rows={4}
                  placeholder="输入要测试的文本…"
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
              </div>
              <div
                className={
                  testResult
                    ? 'flex items-center gap-2 rounded-md border border-primary bg-primary px-3 py-2 text-sm text-primary-foreground'
                    : 'flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground'
                }
              >
                {testResult ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-primary-foreground" />
                    命中 — 会被拦截
                  </>
                ) : (
                  <>
                    <AlertCircle className="h-4 w-4" />
                    不命中 — 不会拦截
                  </>
                )}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestTarget(null)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除规则</DialogTitle>
            <DialogDescription>
              确定要删除「{deleteTarget?.name}」吗?此操作不可撤销。
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
