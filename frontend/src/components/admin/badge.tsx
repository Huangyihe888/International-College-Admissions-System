import { cn } from '@/lib/utils';

/** 状态色板:对应后端 DocumentStatus / JobStatus 等枚举 */
const STATUS_STYLES: Record<string, string> = {
  // 文档状态
  PENDING: 'bg-secondary text-foreground border-border',
  PARSING: 'bg-secondary text-foreground border-border',
  CHUNKING: 'bg-secondary text-foreground border-border',
  EMBEDDING: 'bg-secondary text-foreground border-border',
  READY: 'bg-primary text-primary-foreground border-primary',
  FAILED: 'bg-destructive text-destructive-foreground border-destructive',
  ARCHIVED: 'bg-muted text-muted-foreground border-border',
  // 上传/任务状态
  QUEUED: 'bg-secondary text-foreground border-border',
  RUNNING: 'bg-secondary text-foreground border-border',
  SUCCESS: 'bg-primary text-primary-foreground border-primary',
  // 用户状态
  ACTIVE: 'bg-primary text-primary-foreground border-primary',
  DISABLED: 'bg-muted text-muted-foreground border-border',
  // 通用
  true: 'bg-primary text-primary-foreground border-primary',
  false: 'bg-muted text-muted-foreground border-border',
};

interface AdminBadgeProps {
  status: string;
  label?: string;
  className?: string;
}

export function AdminBadge({ status, label, className }: AdminBadgeProps) {
  const tone = STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-700 border-gray-200';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium',
        tone,
        className,
      )}
    >
      {label ?? status}
    </span>
  );
}
