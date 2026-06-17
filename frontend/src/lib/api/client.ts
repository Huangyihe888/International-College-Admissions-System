import axios, {
  AxiosError,
  CanceledError,
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { toast } from 'sonner';
import { ApiEnvelope, ErrorCode, isAdminAuthError } from './types';
import { useAuthStore } from '../store/auth';
import { uid } from '@/lib/utils';

const VISITOR_STORAGE_KEY = 'wyu_vid';
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * 业务异常 — 携带 code/message/data,UI 层可按 code 分支处理
 */
export class ApiError extends Error {
  readonly code: number;
  readonly data: unknown;
  readonly requestId?: string;
  readonly httpStatus?: number;

  constructor(
    code: number,
    message: string,
    data: unknown = null,
    requestId?: string,
    httpStatus?: number,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.data = data;
    this.requestId = requestId;
    this.httpStatus = httpStatus;
  }
}

/** 读取访客 id(后端通过 Set-Cookie 种 wyu_vid 时此处也兼容) */
function getStoredVisitorId(): string | null {
  try {
    const raw = localStorage.getItem(VISITOR_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { visitorId?: string } } | null;
    return parsed?.state?.visitorId ?? null;
  } catch {
    return null;
  }
}

function getAdminPath(): string {
  if (typeof window === 'undefined') return '';
  return window.location.pathname;
}

function createApiInstance(): AxiosInstance {
  const instance = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api/v1',
    withCredentials: true, // 关键:同源 Set-Cookie wyu_vid 由浏览器自动带上
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // ---- 请求拦截:requestId + 访客 id ----
  instance.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    config.headers.set('X-Request-Id', uid());

    const vid = getStoredVisitorId();
    if (vid) {
      config.headers.set('X-Visitor-Id', vid);
    }

    const url = config.url ?? '';
    // 登录/刷新接口免鉴权
    const isPublicAuth = url.startsWith('/admin/auth/login') || url.startsWith('/admin/auth/refresh');
    if (url.startsWith('/admin/') && !isPublicAuth) {
      const accessToken = useAuthStore.getState().accessToken;
      if (accessToken && !config.headers.has('Authorization')) {
        config.headers.set('Authorization', `Bearer ${accessToken}`);
      }
      // 没 token 时直接短路取消请求,避免 401 噪声
      if (!accessToken && !sessionStorage.getItem('wyu_redirecting_to_login')) {
        sessionStorage.setItem('wyu_redirecting_to_login', '1');
        const path = window.location.pathname;
        if (path.startsWith('/admin') && path !== '/admin/login') {
          window.location.href = '/admin/login';
        }
        const err = new CanceledError('No admin token, request skipped');
        throw err;
      }
    }
    return config;
  });

  // ---- 响应拦截:统一拆 envelope + 错误归一化 ----
  instance.interceptors.response.use(
    (response: AxiosResponse<ApiEnvelope>) => {
      const body = response.data;

      // 后端约定:code !== 0 视为业务错误,但 HTTP 仍是 2xx
      if (body && typeof body === 'object' && 'code' in body && body.code !== ErrorCode.SUCCESS) {
        throw new ApiError(
          body.code,
          body.message ?? '业务错误',
          body.data ?? null,
          body.requestId,
          response.status,
        );
      }
      return response;
    },
    (error: AxiosError<ApiEnvelope>) => {
      const body = error.response?.data;

      // 1) 后端 envelope 错误(4xx/5xx 仍带 envelope)
      if (body && typeof body === 'object' && 'code' in body) {
        const apiError = new ApiError(
          body.code,
          body.message ?? '请求失败',
          body.data ?? null,
          body.requestId,
          error.response?.status,
        );

        // 管理员鉴权失败 → 跳登录(但仅在 admin 路由下,且当前不在登录页)
        if (isAdminAuthError(apiError.code)) {
          const path = getAdminPath();
          if (path.startsWith('/admin') && path !== '/admin/login') {
            // 用 sessionStorage 标记,避免并发请求触发多次 toast
            if (!sessionStorage.getItem('wyu_redirecting_to_login')) {
              sessionStorage.setItem('wyu_redirecting_to_login', '1');
              window.location.href = '/admin/login';
            }
          }
          // 聊天/访客路由:401 静默,业务自行处理
          return Promise.reject(apiError);
        }

        // 限流:toast 提示
        if (apiError.code === ErrorCode.RATE_LIMITED) {
          toast.error('请求过于频繁,请稍后再试');
        }
        return Promise.reject(apiError);
      }

      // 2) 网络/超时/解析错误
      const isTimeout = error.code === 'ECONNABORTED';
      const status = error.response?.status;
      let msg = '网络错误,请稍后重试';
      if (isTimeout) msg = '请求超时,请检查网络';
      else if (status && status >= 500) msg = `服务器错误 (${status})`;
      else if (status === 404) msg = '接口不存在';
      toast.error(msg);
      return Promise.reject(error);
    },
  );

  return instance;
}

export const api = createApiInstance();

/** 把 envelope 拆出 data 字段(在 hooks 里用得着) */
export function unwrap<T>(response: AxiosResponse<ApiEnvelope<T>>): T {
  return (response.data.data ?? (null as unknown)) as T;
}
