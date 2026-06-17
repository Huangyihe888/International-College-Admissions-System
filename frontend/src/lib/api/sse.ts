import { uid } from '@/lib/utils';

/**
 * Server-Sent Events 解析与 POST 流式请求工具
 * - 兼容 SSE 协议字段:event / data / id / retry
 * - 用空行作为事件分界
 * - 提供 streamPost():fetch + ReadableStream,逐 chunk 解码
 */

export interface SSEEvent<T = unknown> {
  event: string;
  data: T;
  id?: string;
  retry?: number;
}

/**
 * 解析一段 SSE 文本,产出 0~N 个事件
 *  - 支持单条 data 跨多行(以 \n 连接,中间空行视作分界)
 *  - data 字段若是合法 JSON,自动 JSON.parse;否则返回原始字符串
 */
export function* parseSSE<T = unknown>(raw: string): Generator<SSEEvent<T>> {
  const blocks = raw.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split(/\r?\n/);
    const fields: Record<string, string> = {};
    for (const line of lines) {
      if (!line || line.startsWith(':')) continue; // 注释行
      const idx = line.indexOf(':');
      let key: string;
      let value: string;
      if (idx === -1) {
        key = line;
        value = '';
      } else {
        key = line.slice(0, idx);
        value = line.slice(idx + 1);
        if (value.startsWith(' ')) value = value.slice(1);
      }
      // 同名字段累加(Multi-line)
      fields[key] = fields[key] !== undefined ? `${fields[key]}\n${value}` : value;
    }

    if (fields['data'] === undefined) continue;
    const eventName = fields['event'] ?? 'message';
    const rawData = fields['data'];
    let parsed: unknown = rawData;
    if (rawData && rawData !== '') {
      try {
        parsed = JSON.parse(rawData);
      } catch {
        // 非 JSON 保持字符串
        parsed = rawData;
      }
    }
    const out: SSEEvent<T> = { event: eventName, data: parsed as T };
    if (fields['id']) out.id = fields['id'];
    if (fields['retry']) {
      const n = Number(fields['retry']);
      if (!Number.isNaN(n)) out.retry = n;
    }
    yield out;
  }
}

/**
 * POST + 接收 SSE 流
 *  - url 必须是绝对或相对路径(会自动走 Vite proxy)
 *  - body 序列化为 JSON
 *  - signal 可用于中断(AbortController)
 *  - 透传 wyu_vid / X-Request-Id,与 axios 拦截器一致
 */
export async function* streamPost<T = unknown>(
  url: string,
  body: unknown,
  signal?: AbortSignal,
): AsyncGenerator<SSEEvent<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    'X-Request-Id': uid(),
  };
  try {
    const raw = localStorage.getItem('wyu_vid');
    if (raw) {
      const parsed = JSON.parse(raw) as { state?: { visitorId?: string } } | null;
      const vid = parsed?.state?.visitorId;
      if (vid) headers['X-Visitor-Id'] = vid;
    }
  } catch {
    // ignore
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
    credentials: 'include',
    signal,
  });

  if (!response.ok) {
    // 尝试把 envelope 错误抛出去
    let errBody: unknown = null;
    try {
      errBody = await response.json();
    } catch {
      // not JSON
    }
    const err = new Error(
      `SSE request failed: ${response.status} ${response.statusText}`,
    );
    (err as Error & { status?: number; body?: unknown }).status = response.status;
    (err as Error & { status?: number; body?: unknown }).body = errBody;
    throw err;
  }
  if (!response.body) {
    throw new Error('SSE response has no body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // 按双换行分块;最后一段留在 buffer
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        for (const ev of parseSSE<T>(chunk)) yield ev;
      }
    }
    // 收尾:flush 残余
    if (buffer.trim()) {
      for (const ev of parseSSE<T>(buffer)) yield ev;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}
