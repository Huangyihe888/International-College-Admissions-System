import type { ReactNode } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface SectionCardProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
}

/** 列表页通用 Section 容器:标题 + 描述 + 右侧 actions + 滚动表格 */
export function SectionCard({
  title,
  description,
  actions,
  className,
  contentClassName,
  children,
}: SectionCardProps) {
  return (
    <Card className={cn('flex flex-col border-slate-200/60 bg-white/80 shadow-xl shadow-blue-900/5 backdrop-blur-xl', className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          {description ? (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </CardHeader>
      <CardContent className={cn('p-0', contentClassName)}>{children}</CardContent>
    </Card>
  );
}
