import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Eye,
  FileText,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
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
  DocumentApi,
  KbVersionApi,
  type ID,
  type PaginatedResult,
} from '@/lib/api/endpoints';
import { useAdminAuth } from '@/hooks/use-admin-auth';

interface DocItem {
  id: ID;
  filename: string;
  mime?: string | null;
  size?: number | null;
  status: string;
  kbVersionId?: ID | null;
  kbVersionLabel?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface ChunkPreview {
  id: ID;
  index?: number | null;
  content?: string;
  tokenCount?: number | null;
}

interface UploadJob {
  id: ID;
  status: string;
  progress?: number;
  errorMessage?: string | null;
  createdAt?: string;
  finishedAt?: string | null;
}

interface DocDetail {
  id: ID;
  filename: string;
  mime?: string | null;
  size?: number | null;
  status: string;
  kbVersionId?: ID | null;
  kbVersionLabel?: string | null;
  createdAt?: string;
  updatedAt?: string;
  chunks?: ChunkPreview[];
  jobs?: UploadJob[];
}

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'PENDING', label: 'PENDING · 待处理' },
  { value: 'PARSING', label: 'PARSING · 解析中' },
  { value: 'CHUNKING', label: 'CHUNKING · 切分中' },
  { value: 'EMBEDDING', label: 'EMBEDDING · 向量化中' },
  { value: 'READY', label: 'READY · 已就绪' },
  { value: 'FAILED', label: 'FAILED · 失败' },
  { value: 'ARCHIVED', label: 'ARCHIVED · 已归档' },
];

function formatBytes(n?: number | null): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function AdminDocumentsPage() {
  useAdminAuth();

  const qc = useQueryClient();
  const [page, setPage] = React.useState(1);
  const [pageSize] = React.useState(20);
  const [keyword, setKeyword] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [kbVersionId, setKbVersionId] = React.useState('');

  const list = useQuery({
    queryKey: ['admin', 'documents', page, pageSize, keyword, status, kbVersionId],
    queryFn: async () => {
      const resp = await DocumentApi.list({
        page,
        pageSize,
        keyword: keyword || undefined,
        status: status || undefined,
        kbVersionId: kbVersionId || undefined,
      });
      return unwrap(resp) as PaginatedResult<DocItem>;
    },
  });

  // KB 版本列表(用于筛选 + 上传目标)
  const kbVersions = useQuery({
    queryKey: ['admin', 'kb-versions', 'select'],
    queryFn: async () => {
      const resp = await KbVersionApi.list({ page: 1, pageSize: 100 });
      return unwrap(resp) as PaginatedResult<{
        id: ID;
        version: string;
        isActive?: boolean;
      }>;
    },
  });

  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [uploadFile, setUploadFile] = React.useState<File | null>(null);
  const [uploadKbId, setUploadKbId] = React.useState('');
  const [uploadProgress, setUploadProgress] = React.useState(0);
  const [uploading, setUploading] = React.useState(false);

  const [detail, setDetail] = React.useState<DocDetail | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);

  const [deleteTarget, setDeleteTarget] = React.useState<DocItem | null>(null);

  // 打开上传对话框时,默认选中 ACTIVE KB
  React.useEffect(() => {
    if (uploadOpen && !uploadKbId) {
      const active = kbVersions.data?.items.find((k) => k.isActive);
      if (active) setUploadKbId(active.id);
    }
  }, [uploadOpen, kbVersions.data, uploadKbId]);

  // 上传成功后复位表单
  const resetUploadForm = () => {
    setUploadFile(null);
    setUploadProgress(0);
    setUploading(false);
  };

  const openUpload = () => {
    resetUploadForm();
    setUploadOpen(true);
  };

  const handleUpload = async () => {
    if (!uploadFile) {
      toast.error('请先选择文件');
      return;
    }
    if (!uploadKbId) {
      toast.error('请选择目标 KB 版本');
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    try {
      const resp = await DocumentApi.upload(
        uploadFile,
        { kbVersionId: uploadKbId },
        (e) => {
          const pct = Math.round((e.loaded / e.total) * 100);
          setUploadProgress(pct);
        },
      );
      unwrap(resp);
      toast.success('上传成功,后台开始解析');
      setUploadOpen(false);
      resetUploadForm();
      qc.invalidateQueries({ queryKey: ['admin', 'documents'] });
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message);
      else toast.error('上传失败');
    } finally {
      setUploading(false);
    }
  };

  const openDetail = async (id: ID) => {
    try {
      const resp = await DocumentApi.get(id);
      const data = unwrap(resp) as DocDetail;
      setDetail(data);
      setDetailOpen(true);
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message);
      else toast.error('加载详情失败');
    }
  };

  const reindexMut = useMutation({
    mutationFn: async (id: ID) => {
      const resp = await DocumentApi.reindex(id);
      return unwrap(resp);
    },
    onSuccess: () => {
      toast.success('已提交重新索引任务');
      qc.invalidateQueries({ queryKey: ['admin', 'documents'] });
    },
    onError: (err) => {
      if (err instanceof ApiError) toast.error(err.message);
      else toast.error('提交失败');
    },
  });

  const removeMut = useMutation({
    mutationFn: async (id: ID) => {
      const resp = await DocumentApi.remove(id);
      return unwrap(resp);
    },
    onSuccess: () => {
      toast.success('文档已归档');
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ['admin', 'documents'] });
    },
    onError: (err) => {
      if (err instanceof ApiError) toast.error(err.message);
      else toast.error('操作失败');
    },
  });

  const total = list.data?.total ?? 0;
  const totalPages = list.data?.totalPages ?? 1;
  const items = list.data?.items ?? [];

  return (
    <div className="space-y-4">
      <SectionCard
        title="文档管理"
        description="上传招生文件(.pdf / .docx / .md),系统自动解析、切分、向量化"
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              className="gap-1"
              onClick={() => list.refetch()}
              disabled={list.isFetching}
            >
              <RefreshCw
                className={list.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}
              />
              刷新
            </Button>
            <Button size="sm" className="gap-1" onClick={openUpload}>
              <Upload className="h-4 w-4" />
              上传文档
            </Button>
          </>
        }
      >
        {/* 筛选行 */}
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/20 px-4 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={keyword}
              onChange={(e) => {
                setKeyword(e.target.value);
                setPage(1);
              }}
              placeholder="搜索文件名"
              className="h-9 w-48 pl-7"
            />
          </div>
          <div className="flex items-center gap-1">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <select
            value={kbVersionId}
            onChange={(e) => {
              setKbVersionId(e.target.value);
              setPage(1);
            }}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">全部 KB 版本</option>
            {kbVersions.data?.items.map((k) => (
              <option key={k.id} value={k.id}>
                {k.version}
                {k.isActive ? ' (ACTIVE)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">文件名</th>
                <th className="px-4 py-2.5 text-left font-medium">类型</th>
                <th className="px-4 py-2.5 text-right font-medium">大小</th>
                <th className="px-4 py-2.5 text-left font-medium">状态</th>
                <th className="px-4 py-2.5 text-left font-medium">KB 版本</th>
                <th className="px-4 py-2.5 text-left font-medium">上传时间</th>
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
                      title="暂无文档"
                      description={'点击右上角"上传文档"添加第一份招生文件'}
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
                      <span className="inline-flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{it.filename}</span>
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {it.mime ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">
                      {formatBytes(it.size)}
                    </td>
                    <td className="px-4 py-2.5">
                      <AdminBadge status={it.status} />
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {it.kbVersionLabel ?? '—'}
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
                          onClick={() => openDetail(it.id)}
                        >
                          <Eye className="h-3.5 w-3.5" />
                          详情
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 px-2"
                          onClick={() => reindexMut.mutate(it.id)}
                          disabled={reindexMut.isPending}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          重新索引
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

      {/* 上传 Dialog */}
      <Dialog
        open={uploadOpen}
        onOpenChange={(o) => {
          if (!o && !uploading) {
            setUploadOpen(false);
            resetUploadForm();
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>上传文档</DialogTitle>
            <DialogDescription>
              支持 PDF / Word / Markdown / TXT,单文件不超过 50MB
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="up-kb">目标 KB 版本</Label>
              <select
                id="up-kb"
                value={uploadKbId}
                onChange={(e) => setUploadKbId(e.target.value)}
                disabled={uploading}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <option value="">请选择…</option>
                {kbVersions.data?.items.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.version}
                    {k.isActive ? ' (ACTIVE)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="up-file">文件</Label>
              <div className="flex items-center gap-2">
                <label
                  className={
                    'inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 text-sm hover:bg-accent ' +
                    (uploading ? 'pointer-events-none opacity-50' : '')
                  }
                >
                  <Upload className="h-4 w-4" />
                  选择文件
                  <input
                    id="up-file"
                    type="file"
                    className="sr-only"
                    accept=".pdf,.doc,.docx,.md,.txt"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      setUploadFile(f);
                    }}
                    disabled={uploading}
                  />
                </label>
                {uploadFile ? (
                  <span className="flex items-center gap-2 truncate text-xs text-muted-foreground">
                    <FileText className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{uploadFile.name}</span>
                    <span className="font-mono">{formatBytes(uploadFile.size)}</span>
                    <button
                      type="button"
                      onClick={() => setUploadFile(null)}
                      className="rounded p-0.5 hover:bg-muted"
                      disabled={uploading}
                      aria-label="清除"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">未选择</span>
                )}
              </div>
            </div>
            {uploading || uploadProgress > 0 ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>上传进度</span>
                  <span className="font-mono">{uploadProgress}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            ) : null}
          </div>
          <DialogFooter className="pt-2">
            <Button
              variant="outline"
              onClick={() => {
                if (!uploading) {
                  setUploadOpen(false);
                  resetUploadForm();
                }
              }}
              disabled={uploading}
            >
              取消
            </Button>
            <Button
              onClick={handleUpload}
              disabled={uploading || !uploadFile || !uploadKbId}
            >
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  上传中…
                </>
              ) : (
                '开始上传'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 详情 Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 truncate">
              <FileText className="h-4 w-4" />
              {detail?.filename}
            </DialogTitle>
            <DialogDescription>
              元信息 + 最近 5 个 chunk 预览 + 最近 UploadJob
            </DialogDescription>
          </DialogHeader>
          {detail ? (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">ID</dt>
                  <dd className="font-mono text-xs">{detail.id}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">状态</dt>
                  <dd>
                    <AdminBadge status={detail.status} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">类型</dt>
                  <dd>{detail.mime ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">大小</dt>
                  <dd className="font-mono">{formatBytes(detail.size)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">KB 版本</dt>
                  <dd>{detail.kbVersionLabel ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">上传时间</dt>
                  <dd>
                    {detail.createdAt
                      ? new Date(detail.createdAt).toLocaleString('zh-CN', {
                          hour12: false,
                        })
                      : '—'}
                  </dd>
                </div>
              </dl>

              {detail.jobs && detail.jobs.length > 0 ? (
                <div className="space-y-1.5">
                  <Label>最近任务</Label>
                  <div className="space-y-1 rounded-md border bg-muted/20 p-2 text-xs">
                    {detail.jobs.map((j) => (
                      <div
                        key={j.id}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <AdminBadge status={j.status} />
                        {typeof j.progress === 'number' ? (
                          <div className="h-1.5 w-32 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full bg-primary"
                              style={{ width: `${j.progress}%` }}
                            />
                          </div>
                        ) : null}
                        <span className="font-mono text-muted-foreground">
                          {j.progress != null ? `${j.progress}%` : ''}
                        </span>
                        {j.errorMessage ? (
                          <span className="text-destructive">{j.errorMessage}</span>
                        ) : null}
                        <span className="ml-auto text-muted-foreground">
                          {j.createdAt
                            ? new Date(j.createdAt).toLocaleString('zh-CN', {
                                hour12: false,
                              })
                            : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="space-y-1.5">
                <Label>最近 chunks(预览前 5 条)</Label>
                {detail.chunks && detail.chunks.length > 0 ? (
                  <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border bg-muted/20 p-3">
                    {detail.chunks.map((c, i) => (
                      <div
                        key={c.id ?? i}
                        className="rounded border bg-background p-2 text-xs"
                      >
                        <div className="mb-1 flex items-center justify-between text-muted-foreground">
                          <span>#{c.index ?? i + 1}</span>
                          {c.tokenCount != null ? (
                            <span className="font-mono">
                              {c.tokenCount} tokens
                            </span>
                          ) : null}
                        </div>
                        <div className="whitespace-pre-wrap break-words text-foreground">
                          {c.content ?? '(空)'}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-md border bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
                    暂无 chunk
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载中…
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>
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
            <DialogTitle>归档文档</DialogTitle>
            <DialogDescription>
              将「{deleteTarget?.filename}」标记为 ARCHIVED — 文档不再被检索,但保留历史记录
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
              {removeMut.isPending ? '处理中…' : '确认归档'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
