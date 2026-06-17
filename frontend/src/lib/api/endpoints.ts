/**
 * 类型化 API 端点集合
 * 覆盖范围:Auth / Chat / FAQ / Document(KB) / Admin / Analytics / Health
 *
 * 注:Admin 侧(SubTask 13.6~13.8)的端点路径与后端 Controller 一致。
 *  - admin/auth/*           AuthController @Controller('admin/auth')
 *  - admin/documents/*      DocumentController @Controller('admin/documents')
 *  - admin/faqs/*           FaqController @Controller('admin/faqs')
 *  - admin/forbidden-rules/* ForbiddenRuleController @Controller('admin/forbidden-rules')
 *  - admin/kb-versions/*    KbVersionController @Controller('admin/kb-versions')
 *  - admin/low-confidence/* LowConfidenceController @Controller('admin/low-confidence')
 *  - admin/users/*          UserAdminController @Controller('admin/users')
 *  - admin/analytics/*      AnalyticsController @Controller('admin/analytics')
 */
import { api } from './client';

// ---------------- 公共类型(粗粒度,后续按需细化) ----------------
export type ID = string;
export type Timestamp = string;

export interface SessionVO {
  id: ID;
  title: string;
  createdAt: Timestamp;
}
export interface MessageVO {
  id: ID;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt?: Timestamp;
  citations?: CitationVO[];
}
export interface CitationVO {
  docId: ID;
  chunkId: ID;
  score: number;
  snippet: string;
}

/** 分页响应(后端 PaginatedResult) */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ---------------- Auth (管理员) ----------------
export const AuthApi = {
  login: (username: string, password: string) =>
    api.post('/admin/auth/login', { username, password }),
  refresh: (refreshToken: string) =>
    api.post('/admin/auth/refresh', { refreshToken }),
  logout: () => api.post('/admin/auth/logout'),
  me: () => api.get('/admin/auth/me'),
};

// ---------------- Chat (公共) ----------------
export const ChatApi = {
  createSession: (title?: string) =>
    api.post('/chat/sessions', { title: title ?? '新会话' }),
  listSessions: (params?: { cursor?: string; limit?: number }) =>
    api.get('/chat/sessions', { params }),
  listMessages: (sessionId: ID) =>
    api.get(`/chat/sessions/${sessionId}/messages`),
  sendMessage: (sessionId: ID, question: string) =>
    api.post('/chat/send', { sessionId, question }),
  /** 流式问答 — 走 SSE 直连,不在 axios 里调 */
  streamUrl: () => `${(import.meta.env.VITE_API_BASE_URL ?? '/api/v1').replace(/\/+$/, '')}/chat/stream`,
  submitFeedback: (messageId: ID, rating: 'POSITIVE' | 'NEGATIVE', comment?: string) =>
    api.post(`/chat/messages/${messageId}/feedback`, { rating, comment }),
};

// ---------------- FAQ (公共检索 — 招生问答页面用) ----------------
export const FaqApi = {
  search: (params: { keyword?: string; limit?: number }) =>
    api.get('/faqs', { params }),
};

// ============== Admin: 文档管理 ==============
export const DocumentApi = {
  /** 列表(后端 GET /admin/documents) */
  list: (params?: { status?: string; page?: number; pageSize?: number; keyword?: string; kbVersionId?: string }) =>
    api.get('/admin/documents', { params }),
  /** 详情(含最近 5 个 chunk 预览 + 最近 UploadJob) */
  get: (id: ID) => api.get(`/admin/documents/${id}`),
  /** 任务的最近进度(jobs) */
  getJobs: (id: ID) => api.get(`/admin/documents/${id}/jobs`),
  /**
   * 上传 — 走 multipart/form-data
   *  - file:File 走 'file' 字段
   *  - kbVersionId 走 'kbVersionId' 字段(必填)
   *  - onProgress 回调:从 axios onUploadProgress 透传
   */
  upload: (
    file: File,
    opts: { kbVersionId: ID },
    onProgress?: (e: { loaded: number; total: number }) => void,
  ) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('kbVersionId', opts.kbVersionId);
    return api.post('/admin/documents/upload', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress({ loaded: e.loaded, total: e.total });
      },
    });
  },
  /** 归档(后端称 archive,前端文雅一点叫"删除") */
  remove: (id: ID) => api.delete(`/admin/documents/${id}`),
  /** 重新索引(后端 POST /:id/reindex,返回 { uploadJobId, status }) */
  reindex: (id: ID) => api.post(`/admin/documents/${id}/reindex`),
};

// ============== Admin: FAQ 管理 ==============
export const FaqAdminApi = {
  list: (params?: { page?: number; pageSize?: number; keyword?: string; category?: string; isActive?: boolean }) =>
    api.get('/admin/faqs', { params }),
  get: (id: ID) => api.get(`/admin/faqs/${id}`),
  create: (payload: { question: string; answer: string; category?: string; isActive?: boolean }) =>
    api.post('/admin/faqs', payload),
  update: (id: ID, payload: Partial<{ question: string; answer: string; category: string; isActive: boolean }>) =>
    api.patch(`/admin/faqs/${id}`, payload),
  remove: (id: ID) => api.delete(`/admin/faqs/${id}`),
  exportCsvUrl: (keyword?: string) => {
    const base = (import.meta.env.VITE_API_BASE_URL ?? '/api/v1').replace(/\/+$/, '');
    const q = keyword ? `?keyword=${encodeURIComponent(keyword)}` : '';
    return `${base}/admin/faqs/export.csv${q}`;
  },
};

// ============== Admin: 禁答规则 ==============
export const ForbiddenRuleApi = {
  list: (params?: { page?: number; pageSize?: number; ruleType?: string; isActive?: boolean }) =>
    api.get('/admin/forbidden-rules', { params }),
  get: (id: ID) => api.get(`/admin/forbidden-rules/${id}`),
  create: (payload: { name: string; pattern: string; ruleType: 'KEYWORD' | 'REGEX' | 'CATEGORY'; reply?: string; isActive?: boolean }) =>
    api.post('/admin/forbidden-rules', payload),
  update: (id: ID, payload: Partial<{ name: string; pattern: string; ruleType: 'KEYWORD' | 'REGEX' | 'CATEGORY'; reply: string; isActive: boolean }>) =>
    api.patch(`/admin/forbidden-rules/${id}`, payload),
  remove: (id: ID) => api.delete(`/admin/forbidden-rules/${id}`),
};

// ============== Admin: KB 版本 ==============
export const KbVersionApi = {
  list: (params?: { page?: number; pageSize?: number; keyword?: string; isActive?: boolean }) =>
    api.get('/admin/kb-versions', { params }),
  create: (payload: { version: string; description?: string; isActive?: boolean }) =>
    api.post('/admin/kb-versions', payload),
  activate: (id: ID) => api.post(`/admin/kb-versions/${id}/activate`),
  remove: (id: ID) => api.delete(`/admin/kb-versions/${id}`),
};

// ============== Admin: 低置信度 ==============
export const LowConfidenceApi = {
  list: (params?: { page?: number; pageSize?: number; keyword?: string; isAnswered?: boolean; threshold?: number }) =>
    api.get('/admin/low-confidence', { params }),
  /** 人工补答(走 POST /:id/answer,AnswerLowConfidenceDto) */
  answer: (id: ID, payload: { answer: string; category?: string }) =>
    api.post(`/admin/low-confidence/${id}/answer`, payload),
};

// ============== Admin: 用户 ==============
export const UserApi = {
  list: (params?: { page?: number; pageSize?: number; keyword?: string; status?: string; roleName?: string }) =>
    api.get('/admin/users', { params }),
  get: (id: ID) => api.get(`/admin/users/${id}`),
  create: (payload: { username: string; password: string; email?: string; displayName?: string; roleName: string }) =>
    api.post('/admin/users', payload),
  update: (id: ID, payload: Partial<{ displayName: string; email: string; roleName: string; status: 'ACTIVE' | 'DISABLED' }>) =>
    api.patch(`/admin/users/${id}`, payload),
  remove: (id: ID) => api.delete(`/admin/users/${id}`),
  /** 重置密码 — 后端 POST /:id/reset-password,body { password } */
  resetPassword: (id: ID, password: string) =>
    api.post(`/admin/users/${id}/reset-password`, { password }),
};

export const RoleApi = {
  list: () => api.get('/admin/roles'),
  create: (payload: { name: string; permissions: string[] }) =>
    api.post('/admin/roles', payload),
  update: (id: ID, payload: Partial<{ name: string; permissions: string[] }>) =>
    api.patch(`/admin/roles/${id}`, payload),
  remove: (id: ID) => api.delete(`/admin/roles/${id}`),
};

// ============== Admin: Prompt / 模型 ==============
export const PromptApi = {
  list: (params?: { scene?: string; status?: string }) =>
    api.get('/admin/prompts', { params }),
  create: (payload: { scene: string; version: number; content: string; isActive?: boolean }) =>
    api.post('/admin/prompts', payload),
  activate: (id: ID) => api.post(`/admin/prompts/${id}/activate`),
};

export const ModelApi = {
  list: () => api.get('/admin/models'),
  update: (id: ID, payload: Partial<{ provider: string; model: string; temperature: number; topP: number }>) =>
    api.patch(`/admin/models/${id}`, payload),
};

// ============== Admin: 反馈管理 ==============
export const FeedbackAdminApi = {
  list: (params?: { range?: '24h' | '7d' | '30d'; keyword?: string; page?: number; pageSize?: number }) =>
    api.get('/admin/analytics/feedbacks', { params }),
  exportCsvUrl: (params?: { range?: '24h' | '7d' | '30d'; keyword?: string }) => {
    const qs = new URLSearchParams();
    if (params?.range) qs.set('range', params.range);
    if (params?.keyword) qs.set('keyword', params.keyword);
    const q = qs.toString();
    return `${(import.meta.env.VITE_API_BASE_URL ?? '/api/v1').replace(/\/+$/, '')}/admin/analytics/feedbacks/export.csv${q ? `?${q}` : ''}`;
  },
};

// ============== Analytics ==============
export const AnalyticsApi = {
  /** 概览 6 项指标(对应后端 /admin/analytics/overview) */
  overview: (range: '24h' | '7d' | '30d' = '7d') =>
    api.get('/admin/analytics/overview', { params: { range } }),
  /** Top 热门问题(后端 /admin/analytics/top-questions) */
  topQuestions: (
    params: {
      range?: '24h' | '7d' | '30d';
      limit?: number;
      isAnswered?: boolean;
      faqHit?: boolean;
    } = {},
  ) => api.get('/admin/analytics/top-questions', { params }),
  /** 趋势时序(后端 /admin/analytics/trends) */
  trends: (params: { range?: '24h' | '7d' | '30d'; granularity?: 'day' | 'hour' } = {}) =>
    api.get('/admin/analytics/trends', { params }),
  /** 问答日志(后端 /admin/analytics/logs) */
  logs: (params?: { page?: number; pageSize?: number; isAnswered?: boolean; faqHit?: boolean; keyword?: string }) =>
    api.get('/admin/analytics/logs', { params }),
  /** CSV 导出链接(后端 /admin/analytics/export.csv) */
  exportCsvUrl: (range: '24h' | '7d' | '30d' = '7d') =>
    `${(import.meta.env.VITE_API_BASE_URL ?? '/api/v1').replace(/\/+$/, '')}/admin/analytics/export.csv?range=${range}`,
};

// ---------------- Health ----------------
export const HealthApi = {
  live: () => api.get('/health/live'),
  ready: () => api.get('/health/ready'),
};
