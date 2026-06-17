import { QueryClient } from '@tanstack/react-query';

/**
 * 全局 React Query 客户端
 * - 默认 30s staleTime:导航回列表/详情不重新打
 * - 网络错误 retry 1 次;4xx 不重试
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: (failureCount, error) => {
        const status = (error as { httpStatus?: number } | null)?.httpStatus;
        if (status && status >= 400 && status < 500) return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
});
