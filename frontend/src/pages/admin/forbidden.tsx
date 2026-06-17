import { AdminEmpty } from '@/components/admin/empty';
import { SectionCard } from '@/components/admin/section';

/**
 * 禁答日志 — 占位页
 * 业务侧另设 /admin/forbidden-rules 走规则 CRUD,本路由保留供"违规问答日志"使用
 */
export default function AdminForbiddenPage() {
  return (
    <SectionCard
      title="禁答日志"
      description="触发禁答规则的历史会话与命中详情"
    >
      <AdminEmpty
        title="禁答日志待实现"
        description="计划在 SubTask 14.x 与反馈/审计一起补全"
      />
    </SectionCard>
  );
}
