import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** 兼容 HTTP/HTTPS 的 UUID v4 生成 */
export function uid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // fallback for non-secure contexts (HTTP)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * shadcn 风格 className 合并:clsx 条件拼接 + twMerge 覆盖优先级
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 简单的防 SQL 注入/XSS 过滤处理 (前端基础防护)
 */
export function sanitizeInput(input: string): string {
  if (!input) return '';
  // 过滤单引号、双引号、分号、反斜杠、注释符等常见注入字符
  return input
    .replace(/['";\\]/g, '')
    .replace(/--/g, '')
    .replace(/\/\*/g, '')
    .replace(/\*\//g, '');
}
