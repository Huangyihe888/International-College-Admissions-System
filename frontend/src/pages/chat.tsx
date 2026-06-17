import * as React from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Loader2, LogOut, MessageSquareText, RefreshCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ChatInput } from '@/components/chat-input';
import { MessageBubble } from '@/components/message-bubble';
import { ApiError, unwrap } from '@/lib/api/client';
import {
  ChatApi,
  type CitationVO,
  type MessageVO,
  type SessionVO,
} from '@/lib/api/endpoints';
import { streamPost, type SSEEvent } from '@/lib/api/sse';
import { useVisitorStore } from '@/lib/store/visitor';
import { uid } from '@/lib/utils';

const FAQ_SUGGESTIONS: string[] = [
  '联合培养项目有哪些专业?',
  '学费和培养费是多少?',
  '报考需要什么条件?',
  '2026年各专业招生计划是多少?',
  '毕业可以获得哪些学位证书?',
  '中外联合培养项目能否不出国?',
];

/** 新会话的占位 id;在第一次发问时由后端 create 返回真实 id */
const NEW_SESSION_FLAG = 'new';

function normalizeSessionParam(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim();
  if (!v || v === 'undefined' || v === 'null') return undefined;
  return v;
}

interface StreamTarget {
  /** 流式接收中的 assistant 占位消息 id(本地生成,仅用于 React key) */
  tempId: string;
  content: string;
  citations: CitationVO[];
  /** 后端 meta 事件下发后才有,用于反馈接口 */
  messageId?: string;
}

export default function ChatPage() {
  const params = useParams<{ sessionId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // sessionId 解析优先级:URL param > ?session= > 'new'
  const routeSession = normalizeSessionParam(params.sessionId);
  const querySession = normalizeSessionParam(searchParams.get('session'));

  const [sessionId, setSessionId] = React.useState<string>(
    routeSession || querySession || NEW_SESSION_FLAG,
  );
  const [, setSessionTitle] = React.useState<string>('');
  const [messages, setMessages] = React.useState<MessageVO[]>([]);
  const [loadingHistory, setLoadingHistory] = React.useState(false);
  const [streaming, setStreaming] = React.useState(false);
  const [streamTarget, setStreamTarget] = React.useState<StreamTarget | null>(null);
  /** 触发重新拉历史的递增 key */
  const [reloadKey, setReloadKey] = React.useState(0);

  // 用 ref 持有 AbortController 与最新 stream target,避免闭包过期
  const abortRef = React.useRef<AbortController | null>(null);
  const streamRef = React.useRef<StreamTarget | null>(null);
  const messagesEndRef = React.useRef<HTMLDivElement | null>(null);
  const newlyCreatedSessionIdRef = React.useRef<string | null>(null);

  const setVisitorId = useVisitorStore((s) => s.setVisitorId);
  const storedVisitorId = useVisitorStore((s) => s.visitorId);

  /** 1) 首次进入:兜底同步 cookie 中的 wyu_vid 到 localStorage / zustand */
  React.useEffect(() => {
    try {
      if (storedVisitorId) return;
      const m = document.cookie.match(/(?:^|;\s*)wyu_vid=([^;]+)/);
      if (m && m[1]) {
        const id = decodeURIComponent(m[1]);
        setVisitorId(id);
        try {
          // zustand persist 的存储格式是 { state, version }
          localStorage.setItem(
            'wyu_vid',
            JSON.stringify({ state: { visitorId: id }, version: 0 }),
          );
        } catch {
          // 配额满 / privacy 模式,忽略
        }
      }
    } catch {
      // ignore
    }
  }, [storedVisitorId, setVisitorId]);

  /** 2) URL -> state 同步(导航时 state 保持一致) */
  React.useEffect(() => {
    const next = routeSession || querySession || NEW_SESSION_FLAG;
    setSessionId((cur) => (cur === next ? cur : next));
  }, [routeSession, querySession]);

  /** 3) 拉历史消息(已知 session 时) */
  const resetToNew = React.useCallback(() => {
    setSessionId(NEW_SESSION_FLAG);
  }, []);

  React.useEffect(() => {
    const raw = params.sessionId;
    if (raw === 'undefined' || raw === 'null') resetToNew();
  }, [params.sessionId, resetToNew]);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (sessionId === NEW_SESSION_FLAG) {
        setMessages([]);
        setSessionTitle('');
        return;
      }
      if (newlyCreatedSessionIdRef.current === sessionId) {
        newlyCreatedSessionIdRef.current = null;
        return;
      }
      setLoadingHistory(true);
      try {
        const resp = await ChatApi.listMessages(sessionId);
        if (cancelled) return;
        const data = unwrap(resp) as
          | { session?: SessionVO; items?: MessageVO[] }
          | MessageVO[];
        if (Array.isArray(data)) {
          setMessages(data);
          setSessionTitle('');
        } else {
          setMessages(data.items ?? []);
          setSessionTitle(data.session?.title ?? '');
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.code === 40400) {
          // session 不存在,重置到新会话
          setMessages([]);
          setSessionTitle('');
          resetToNew();
        }
        // 其它错误由 axios 拦截器统一 toast
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [sessionId, reloadKey, resetToNew]);

  /** 4) 自动滚到底:消息 / 流式追加变化时 */
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, streamTarget?.content]);

  const ensureSession = React.useCallback(async (): Promise<string> => {
    if (sessionId !== NEW_SESSION_FLAG) return sessionId;
    const resp = await ChatApi.createSession();
    const data = unwrap(resp) as { sessionId: string };
    const id = data.sessionId;
    newlyCreatedSessionIdRef.current = id;
    setSessionId(id);
    setSessionTitle('');
    const u = new URL(window.location.href);
    u.pathname = `/chat/${id}`;
    u.search = '';
    window.history.replaceState({}, '', u.toString());
    return id;
  }, [sessionId]);

  const handleStreamEvent = React.useCallback(
    (ev: SSEEvent<{ [k: string]: unknown }>) => {
      const data = (ev.data ?? {}) as { [k: string]: unknown };
      switch (ev.event) {
        case 'meta': {
          // 后端约定:首次 meta 带真实 messageId(供反馈/引用关联)
          const target = streamRef.current;
          if (!target) return;
          const messageId = typeof data.messageId === 'string' ? data.messageId : undefined;
          if (messageId) target.messageId = messageId;
          setStreamTarget({ ...target });
          break;
        }
        case 'sources': {
          // 兼容旧/扩展协议
          const target = streamRef.current;
          if (!target) return;
          const items = Array.isArray(ev.data)
            ? (ev.data as CitationVO[])
            : Array.isArray(data.items)
              ? (data.items as CitationVO[])
              : [];
          target.citations = items;
          setStreamTarget({ ...target });
          break;
        }
        case 'token': {
          const target = streamRef.current;
          if (!target) return;
          const delta =
            typeof data.delta === 'string'
              ? data.delta
              : typeof data.content === 'string'
                ? data.content
                : '';
          if (delta) {
            target.content += delta;
            setStreamTarget({ ...target });
          }
          break;
        }
        case 'done': {
          // 不需要额外操作,finally 会固化占位
          break;
        }
        case 'error': {
          const msg = typeof data.message === 'string' ? data.message : '生成失败';
          toast.error(msg);
          break;
        }
        default:
          break;
      }
    },
    [],
  );

  const handleSend = React.useCallback(
    async (question: string) => {
      if (streaming) return;
      const userMsg: MessageVO = {
        id: `local-u-${uid()}`,
        role: 'user',
        content: question,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);

      // 准备流式接收占位
      const target: StreamTarget = {
        tempId: `local-a-${uid()}`,
        content: '',
        citations: [],
      };
      streamRef.current = target;
      setStreamTarget({ ...target });
      setStreaming(true);

      let realSessionId = sessionId;
      try {
        realSessionId = await ensureSession();
      } catch {
        setStreaming(false);
        setStreamTarget(null);
        streamRef.current = null;
        return;
      }

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        const gen = streamPost<unknown>(
          ChatApi.streamUrl(),
          {
            sessionId: realSessionId,
            question,
          },
          ctrl.signal,
        );
        for await (const ev of gen) {
          handleStreamEvent(ev as SSEEvent<{ [k: string]: unknown }>);
          if (ctrl.signal.aborted) break;
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          // 用户主动停止,吞掉
        } else {
          const status = (err as { status?: number })?.status;
          if (status && status >= 400) {
            toast.error('网络异常,请稍后重试');
          } else {
            toast.error('生成中断,请稍后重试');
          }
        }
      } finally {
        // 把流式占位固化成正式 message(若有 messageId)
        const finalTarget = streamRef.current;
        if (finalTarget) {
          const finalized: MessageVO = {
            id: finalTarget.messageId ?? finalTarget.tempId,
            role: 'assistant',
            content: finalTarget.content,
            createdAt: new Date().toISOString(),
            citations:
              finalTarget.citations.length > 0 ? finalTarget.citations : undefined,
          };
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === finalized.id);
            if (idx >= 0) {
              const next = prev.slice();
              next[idx] = finalized;
              return next;
            }
            return [...prev, finalized];
          });
        }
        setStreamTarget(null);
        streamRef.current = null;
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [streaming, sessionId, ensureSession, handleStreamEvent],
  );

  /** 0) 从 home 跳转过来时,自动发送 ?q= 中的首条问题 */
  const handleSendRef = React.useRef(handleSend);
  handleSendRef.current = handleSend;
  const prefillQ = searchParams.get('q');
  React.useEffect(() => {
    if (!prefillQ) return;
    handleSendRef.current(prefillQ);
    // 清掉 URL 上的 q,避免刷新重复发送
    const next = new URLSearchParams(searchParams);
    next.delete('q');
    const qs = next.toString();
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}${qs ? `?${qs}` : ''}`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStop = React.useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleReload = React.useCallback(() => {
    if (sessionId === NEW_SESSION_FLAG) return;
    if (streaming) {
      toast.warning('请先停止当前生成');
      return;
    }
    setMessages([]);
    setReloadKey((n) => n + 1);
  }, [sessionId, streaming]);

  const handleExit = React.useCallback(() => {
    if (streaming) {
      if (!window.confirm('当前正在生成回答,确定要退出吗?')) return;
      abortRef.current?.abort();
    }
    // 清掉本地 visitorId 等会话状态,直接回首页
    try {
      localStorage.removeItem('wyu_vid');
    } catch {
      // ignore
    }
    navigate('/', { replace: true });
  }, [streaming, navigate]);

  const handleFeedbackSubmitted = React.useCallback(
    (_messageId: string, _rating: 1 | -1 | 0) => {
      // 反馈已成功,UI 上 MessageBubble 自己维持 disabled
    },
    [],
  );

  const isNew = sessionId === NEW_SESSION_FLAG;
  const hasMessages = messages.length > 0 || Boolean(streamTarget);

  return (
    <div className="flex h-screen-mobile flex-col wyu-brand text-slate-800 bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100 relative z-0">
      {/* 学院 logo 全局背景 */}
      <div
        className="pointer-events-none fixed inset-0 z-[-1] flex items-center justify-center overflow-hidden"
        aria-hidden
      >
        <img
          src="/wyu/logo.png"
          alt=""
          className="w-auto object-contain"
          style={{
            height: 'min(80vh, 800px)',
            opacity: 0.04,
          }}
          draggable={false}
        />
      </div>

      {/* 顶部标题栏 */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200/60 bg-white/80 px-3 py-2.5 sm:px-6 md:px-8 sm:py-4 backdrop-blur-xl z-10 sticky top-0 shadow-sm">
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
          <div className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-lg bg-blue-50 text-[#004a8c]">
            <MessageSquareText className="h-4 w-4 sm:h-5 sm:w-5 shrink-0" />
          </div>
          <h1 className="truncate text-base sm:text-lg font-semibold text-slate-800 tracking-wide">
            中外联合培养项目招生问答
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleReload}
            title="刷新历史消息"
            disabled={isNew || loadingHistory}
            aria-label="刷新"
            className="text-slate-500 hover:text-slate-700 hover:bg-slate-100/80 rounded-full h-9 w-9"
          >
            <RefreshCw
              className={loadingHistory ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}
            />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-slate-600 hover:text-slate-800 hover:bg-slate-100/80 rounded-full px-3 h-9"
            onClick={handleExit}
            title="退出到首页"
          >
            <LogOut className="h-4 w-4" />
            退出
          </Button>
        </div>
      </div>

      {/* 消息列表 / 空状态欢迎区 */}
      {loadingHistory && !hasMessages ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          正在加载历史消息…
        </div>
      ) : !hasMessages ? (
        /* 空状态:居中展示欢迎语 + 提问输入框 */
        <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-8">
          <div className="w-full max-w-2xl animate-in fade-in slide-in-from-bottom-6 duration-700">
            {/* 居中的提问输入框 */}
            <ChatInput
              onSend={handleSend}
              onStop={handleStop}
              streaming={streaming}
              disabled={loadingHistory}
              placeholder="请输入您要咨询的招生问题…"
            />

            {/* 快捷问题 */}
            <div className="mt-6">
              <div className="mb-3 flex items-center justify-center gap-1.5 text-xs font-medium text-slate-400">
                <Sparkles className="h-3.5 w-3.5" />
                您可以试着问我
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {FAQ_SUGGESTIONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    disabled={streaming || loadingHistory}
                    onClick={() => handleSend(q)}
                    className="rounded-full border border-slate-200 bg-white/60 backdrop-blur-sm px-4 py-1.5 text-xs text-slate-600 transition-all duration-300 hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50/50 hover:text-[#004a8c] hover:shadow-sm disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* 有消息:列表 + 吸底输入框 */
        <>
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-2.5 sm:gap-4 px-3 sm:px-6 md:px-8 py-4 sm:py-6">
              {messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  onFeedbackSubmitted={handleFeedbackSubmitted}
                />
              ))}
              {streamTarget ? (
                <MessageBubble
                  key={streamTarget.tempId}
                  message={{
                    id: streamTarget.messageId ?? streamTarget.tempId,
                    role: 'assistant',
                    content: streamTarget.content,
                    createdAt: new Date().toISOString(),
                    citations:
                      streamTarget.citations.length > 0
                        ? streamTarget.citations
                        : undefined,
                    streaming: true,
                  }}
                />
              ) : null}
              <div ref={messagesEndRef} />
            </div>
          </div>

          <div 
            className="shrink-0 px-2 sm:px-6 md:px-8 pt-3 sm:pt-6 z-10 relative"
            style={{ paddingBottom: 'max(0.25rem, env(safe-area-inset-bottom))' }}
          >
            <div className="mx-auto w-full max-w-3xl flex flex-col items-center">
              <ChatInput
                onSend={handleSend}
                onStop={handleStop}
                streaming={streaming}
                disabled={loadingHistory}
                placeholder="请输入您的问题"
                className="w-full shadow-lg rounded-full"
              />
              <div className="mt-2 sm:mt-3 text-center flex flex-col items-center gap-0.5 sm:gap-1">
                <p className="text-[8px] sm:text-[9px] text-slate-400/70 px-2 leading-relaxed max-w-[95%]">
                  回答内容由 AI 基于学校招生知识库生成，仅供参考，以学校官方公告为准。
                </p>
                <p className="text-[10px] sm:text-[11px] font-medium text-slate-600 px-2 sm:px-4 leading-relaxed scale-90 sm:scale-100">
                  <span className="block sm:inline whitespace-nowrap">本中外联合培养项目AI助手</span>
                  <span className="block sm:inline whitespace-nowrap">由五邑大学国际教育学院 2024 级计算机科学与技术专业黄奕河同学独立全栈开发完成。</span>
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
