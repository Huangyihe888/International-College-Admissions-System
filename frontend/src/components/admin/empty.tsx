import { Inbox } from 'lucide-react';

import { cn } from '@/lib/utils';

interface AdminEmptyProps {
  title?: string;
  description?: string;
  className?: string;
}

export function AdminEmpty({
  title = '暂无数据',
  description = '尝试切换筛选条件或刷新',
  className,
}: AdminEmptyProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-6 py-12 text-center text-muted-foreground',
        className,
      )}
    >
      <Inbox className="h-8 w-8" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="text-xs">{description}</p> : null}
    </div>
  );
}
