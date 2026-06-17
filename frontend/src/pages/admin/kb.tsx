import { AdminEmpty } from '@/components/admin/empty';
import { SectionCard } from '@/components/admin/section';

/**
 * KB 概览 — 占位页
 * 规则/版本相关走 /admin/forbidden-rules 与 /admin/kb-versions,本路由保留供未来 KB 整体盘点
 */
export default function AdminKbPage() {
  return (
    <SectionCard
      title="知识库"
      description="向量库、文档源、覆盖率与索引健康度总览"
    >
      <AdminEmpty
        title="KB 概览待实现"
        description="计划在 SubTask 14.x 与运维大盘一起补全"
      />
    </SectionCard>
  );
}
