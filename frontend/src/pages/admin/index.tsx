import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';

/**
 * /admin 根:跳到文档管理
 * (已登录态会被 RequireAdmin 包,未登录态已在 useAdminAuth 跳走)
 */
export default function AdminIndexPage() {
  useEffect(() => {
    // 兜底:若 URL 进了这里,主动 replace 一次
  }, []);
  return <Navigate to="/admin/documents" replace />;
}
