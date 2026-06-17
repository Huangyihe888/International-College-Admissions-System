import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface AdminPaginationProps {
  page: number;
  totalPages: number;
  total?: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
  className?: string;
}

/**
 * 极简分页 — 上一页 / 下一页 + "第 N / M 页"
 *  - 后端返回 totalPages,直接用,避免 client 算 total
 *  - 离首/末页禁用对应按钮
 */
export function AdminPagination({
  page,
  totalPages,
  total,
  pageSize,
  onPageChange,
  className,
}: AdminPaginationProps) {
  const safeTotalPages = Math.max(1, totalPages);
  const canPrev = page > 1;
  const canNext = page < safeTotalPages;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-2 border-t bg-background px-4 py-3 text-sm',
        className,
      )}
    >
      <div className="text-muted-foreground">
        {typeof total === 'number' && typeof pageSize === 'number' ? (
          <>
            共 <span className="font-medium text-foreground">{total}</span> 条 · 每页{' '}
            <span className="font-medium text-foreground">{pageSize}</span>
          </>
        ) : (
          ' '
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!canPrev}
          onClick={() => onPageChange(page - 1)}
          className="gap-1"
        >
          <ChevronLeft className="h-4 w-4" />
          上一页
        </Button>
        <div className="min-w-[88px] text-center text-muted-foreground">
          第 <span className="font-medium text-foreground">{page}</span> /{' '}
          <span className="font-medium text-foreground">{safeTotalPages}</span> 页
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!canNext}
          onClick={() => onPageChange(page + 1)}
          className="gap-1"
        >
          下一页
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
