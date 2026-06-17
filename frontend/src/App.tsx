import * as React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom';
import { Toaster } from 'sonner';

import { queryClient } from '@/lib/api/query-client';
import { AdminShell } from '@/components/admin/admin-shell';
import { useAdminAuth } from '@/hooks/use-admin-auth';

import HomePage from '@/pages/home';
import ChatPage from '@/pages/chat';
import AdminLoginPage from '@/pages/admin-login';
import NotFoundPage from '@/pages/not-found';

import AdminDocumentsPage from '@/pages/admin/documents';
import AdminFaqPage from '@/pages/admin/faq';
import AdminForbiddenRulesPage from '@/pages/admin/forbidden-rules';
import AdminForbiddenPage from '@/pages/admin/forbidden';
import AdminKbVersionsPage from '@/pages/admin/kb-versions';
import AdminKbPage from '@/pages/admin/kb';
import AdminLowConfidencePage from '@/pages/admin/low-confidence';
import AdminUsersPage from '@/pages/admin/users';
import AdminAnalyticsPage from '@/pages/admin/analytics';
import AdminFeedbackPage from '@/pages/admin/feedback';

/**
 * 顶层路由壳子
 *  - 极简结构:主页(问答入口) + /chat(完整匿名对话) + /admin(后台)
 *  - 没用 PublicLayout 等复杂公共版式,主页自带极简居中布局
 */
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          {/* 家长端:主页 + 聊天 */}
          <Route path="/" element={<HomePage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/chat/:sessionId" element={<ChatPage />} />

          {/* 管理端登录 */}
          <Route path="/admin/login" element={<AdminLoginPage />} />

          {/* 管理端:AdminShell 布局 + RequireAdmin 鉴权 */}
          <Route path="/admin" element={<AdminShell />}>
            <Route
              index
              element={
                <RequireAdmin>
                  <Navigate to="documents" replace />
                </RequireAdmin>
              }
            />
            <Route
              path="documents"
              element={
                <RequireAdmin>
                  <AdminDocumentsPage />
                </RequireAdmin>
              }
            />
            <Route
              path="faq"
              element={
                <RequireAdmin>
                  <AdminFaqPage />
                </RequireAdmin>
              }
            />
            <Route
              path="forbidden-rules"
              element={
                <RequireAdmin>
                  <AdminForbiddenRulesPage />
                </RequireAdmin>
              }
            />
            <Route
              path="forbidden"
              element={
                <RequireAdmin>
                  <AdminForbiddenPage />
                </RequireAdmin>
              }
            />
            <Route
              path="kb-versions"
              element={
                <RequireAdmin>
                  <AdminKbVersionsPage />
                </RequireAdmin>
              }
            />
            <Route
              path="kb"
              element={
                <RequireAdmin>
                  <AdminKbPage />
                </RequireAdmin>
              }
            />
            <Route
              path="low-confidence"
              element={
                <RequireAdmin>
                  <AdminLowConfidencePage />
                </RequireAdmin>
              }
            />
            <Route
              path="users"
              element={
                <RequireAdmin>
                  <AdminUsersPage />
                </RequireAdmin>
              }
            />
            <Route
              path="analytics"
              element={
                <RequireAdmin>
                  <AdminAnalyticsPage />
                </RequireAdmin>
              }
            />
            <Route
              path="feedback"
              element={
                <RequireAdmin>
                  <AdminFeedbackPage />
                </RequireAdmin>
              }
            />
            <Route
              path="*"
              element={
                <RequireAdmin>
                  <Navigate to="documents" replace />
                </RequireAdmin>
              }
            />
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        <Toaster position="top-right" richColors closeButton />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

/**
 * 管理端路由保护包装
 *  - 未登录态:渲染占位"正在跳转登录页…"
 */
function RequireAdmin({ children }: { children: React.ReactNode }): React.ReactElement {
  const authed = useAdminAuth();
  if (!authed) {
    return (
      <div className="container py-12 text-sm text-muted-foreground">
        正在跳转登录页…
      </div>
    );
  }
  return <>{children}</>;
}
