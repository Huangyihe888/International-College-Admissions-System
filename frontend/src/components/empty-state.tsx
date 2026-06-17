import * as React from 'react';
import { Inbox } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

/**
 * 通用空状态占位
 *  - 聊天空 / 数据列表空 / 404 共用
 *  - icon 默认为 Inbox,允许业务方自定义
 */
export function EmptyState({
  title = '暂无数据',
  description,
  icon,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-12 text-center animate-in fade-in duration-500',
        className,
      )}
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-100 text-black">
        {icon ?? <Inbox className="h-8 w-8" />}
      </div>
      <div className="space-y-1.5">
        <p className="text-base font-medium text-slate-800">{title}</p>
        {description ? (
          <p className="text-sm text-slate-500 max-w-[280px] leading-relaxed mx-auto">{description}</p>
        ) : null}
      </div>
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}
