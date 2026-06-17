import { Injectable, OnModuleInit } from "@nestjs/common";
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";

@Injectable()
export class PromService implements OnModuleInit {
  readonly registry = new Registry();

  readonly httpRequestsTotal = new Counter({
    name: "http_requests_total",
    help: "Total HTTP requests",
    labelNames: ["method", "route", "status"] as const,
    registers: [this.registry],
  });

  readonly httpRequestDuration = new Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    labelNames: ["method", "route", "status"] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  readonly ragRequestsTotal = new Counter({
    name: "rag_requests_total",
    help: "Total RAG requests",
    labelNames: ["isAnswered", "faqHit"] as const,
    registers: [this.registry],
  });

  readonly ragLatency = new Histogram({
    name: "rag_request_duration_seconds",
    help: "RAG request duration in seconds",
    labelNames: ["stage"] as const,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
    registers: [this.registry],
  });

  readonly llmTokensTotal = new Counter({
    name: "llm_tokens_total",
    help: "Total LLM tokens used",
    labelNames: ["provider", "model", "kind"] as const,
    registers: [this.registry],
  });

  readonly llmRequestDuration = new Histogram({
    name: "llm_request_duration_seconds",
    help: "LLM upstream request duration",
    labelNames: ["provider", "model", "kind"] as const,
    buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60],
    registers: [this.registry],
  });

  readonly llmErrorsTotal = new Counter({
    name: "llm_errors_total",
    help: "LLM upstream errors",
    labelNames: ["provider", "model", "code"] as const,
    registers: [this.registry],
  });

  readonly vectorRecallDuration = new Histogram({
    name: "vector_recall_duration_seconds",
    help: "pgvector recall duration",
    labelNames: ["kind"] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2],
    registers: [this.registry],
  });

  readonly queueJobsTotal = new Counter({
    name: "queue_jobs_total",
    help: "BullMQ jobs total",
    labelNames: ["queue", "status"] as const,
    registers: [this.registry],
  });

  readonly activeSessions = new Gauge({
    name: "active_chat_sessions",
    help: "Active chat sessions in last 24h",
    registers: [this.registry],
  });

  onModuleInit() {
    collectDefaultMetrics({ register: this.registry });
  }

  async metrics(): Promise<{ contentType: string; body: string }> {
    return {
      contentType: this.registry.contentType,
      body: await this.registry.metrics(),
    };
  }
}
