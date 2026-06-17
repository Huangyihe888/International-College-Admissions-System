import { Injectable, Logger } from "@nestjs/common";
import {
  Document,
  DocumentStatus,
  JobStatus,
  Prisma,
  UploadJob,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { JwtUser } from "../../common/decorators/current-user.decorator";
import { PaginatedResult, paginate } from "../../common/dto/pagination.dto";
import { BusinessException } from "../../common/errors/business.exception";
import { ErrorCode } from "../../common/errors/error-code";
import { PrismaService } from "../../database/prisma.service";
import { StorageService } from "../../storage/storage.service";
import { QueueService } from "../../jobs/queue.service";
import { DOCUMENT_INGEST_JOB } from "../../jobs/processors/document-ingest.processor";
import { DocumentListQueryDto } from "./dto/query-document.dto";
import {
  DocumentChunkPreview,
  DocumentDetailResponse,
  DocumentResponse,
  UploadDocumentResult,
  UploadJobResponse,
} from "./dto/document-response.dto";

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const RECENT_CHUNKS_LIMIT = 5;
const RECENT_JOBS_LIMIT = 5;
const CHUNK_PREVIEW_CHARS = 200;

const ALLOWED_MIME_TYPES = new Set<string>([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/html",
  "text/markdown",
  "text/plain",
]);

const UPLOAD_JOB_SELECT = {
  id: true,
  status: true,
  progress: true,
  stage: true,
  errorMessage: true,
  startedAt: true,
  finishedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly queue: QueueService,
  ) {}

  // ---------- upload ----------

  async upload(
    file: Express.Multer.File,
    kbVersionId: string,
    user: JwtUser | undefined,
  ): Promise<UploadDocumentResult> {
    if (!file) {
      throw new BusinessException(
        ErrorCode.VALIDATION_FAILED,
        "file is required",
      );
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BusinessException(
        ErrorCode.UNSUPPORTED_FILE_TYPE,
        `Unsupported mime type: ${file.mimetype}`,
      );
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new BusinessException(
        ErrorCode.DOCUMENT_TOO_LARGE,
        `File exceeds 50MB limit: ${file.size} bytes`,
      );
    }

    const kbVersion = await this.prisma.knowledgeBaseVersion.findUnique({
      where: { id: kbVersionId },
      select: { id: true, isActive: true, version: true },
    });
    if (!kbVersion) {
      throw new BusinessException(
        ErrorCode.KB_VERSION_NOT_FOUND,
        `Knowledge base version not found: ${kbVersionId}`,
      );
    }
    if (!kbVersion.isActive) {
      throw new BusinessException(
        ErrorCode.VALIDATION_FAILED,
        `Knowledge base version is not active: ${kbVersion.version}`,
      );
    }

    const fileKey = `documents/${nanoid()}`;
    await this.storage.putObject(fileKey, file.buffer, file.mimetype);

    let document: Document;
    try {
      document = await this.prisma.document.create({
        data: {
          kbVersionId: kbVersion.id,
          title: file.originalname || "untitled",
          fileKey,
          fileType: file.mimetype,
          fileSize: file.size,
          status: DocumentStatus.PENDING,
          chunkCount: 0,
          metadata: {
            originalName: file.originalname,
            uploadedBy: user?.username ?? null,
          } as Prisma.InputJsonValue,
          uploaderId: user!.sub,
        },
      });
    } catch (err) {
      // best-effort cleanup of orphan object in MinIO
      await this.storage.removeObject(fileKey).catch((rmErr) => {
        this.logger.warn(
          `failed to cleanup orphan object key=${fileKey}: ${(rmErr as Error).message}`,
        );
      });
      throw err;
    }

    const uploadJob = await this.prisma.uploadJob.create({
      data: {
        documentId: document.id,
        uploaderId: user!.sub,
        status: JobStatus.QUEUED,
        progress: 0,
        stage: "PENDING",
      },
    });

    await this.queue.addIngest(DOCUMENT_INGEST_JOB, {
      documentId: document.id,
    });

    return {
      id: document.id,
      status: document.status,
      uploadJobId: uploadJob.id,
    };
  }

  // ---------- list ----------

  async list(
    query: DocumentListQueryDto,
  ): Promise<PaginatedResult<DocumentResponse>> {
    const where: Prisma.DocumentWhereInput = {};
    if (query.kbVersionId) where.kbVersionId = query.kbVersionId;
    if (query.status) where.status = query.status;
    if (query.keyword && query.keyword.trim()) {
      where.title = { contains: query.keyword.trim(), mode: "insensitive" };
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.document.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          uploader: { select: { id: true, username: true, displayName: true } },
        },
      }),
      this.prisma.document.count({ where }),
    ]);

    return paginate(
      items.map((d) => this.toResponse(d)),
      total,
      query.page,
      query.pageSize,
    );
  }

  // ---------- detail ----------

  async getDetail(id: string): Promise<DocumentDetailResponse> {
    const doc = await this.prisma.document.findUnique({
      where: { id },
      include: {
        uploader: { select: { id: true, username: true, displayName: true } },
        chunks: {
          orderBy: { chunkIndex: "asc" },
          take: RECENT_CHUNKS_LIMIT,
          select: {
            id: true,
            chunkIndex: true,
            content: true,
            tokenCount: true,
          },
        },
        uploadJobs: {
          orderBy: { createdAt: "desc" },
          take: RECENT_JOBS_LIMIT,
          select: UPLOAD_JOB_SELECT,
        },
      },
    });
    if (!doc) {
      throw new BusinessException(
        ErrorCode.DOCUMENT_NOT_FOUND,
        `Document not found: ${id}`,
      );
    }

    return {
      ...this.toResponse(doc),
      recentChunks: doc.chunks.map<DocumentChunkPreview>((c) => ({
        id: c.id,
        chunkIndex: c.chunkIndex,
        content:
          c.content.length > CHUNK_PREVIEW_CHARS
            ? `${c.content.slice(0, CHUNK_PREVIEW_CHARS)}…`
            : c.content,
        tokenCount: c.tokenCount,
      })),
      recentJobs: doc.uploadJobs.map((j) => this.toJobResponse(j)),
    };
  }

  // ---------- archive (soft delete) ----------

  async archive(
    id: string,
    user: JwtUser | undefined,
  ): Promise<{ id: string; status: DocumentStatus }> {
    const doc = await this.prisma.document.findUnique({ where: { id } });
    if (!doc) {
      throw new BusinessException(
        ErrorCode.DOCUMENT_NOT_FOUND,
        `Document not found: ${id}`,
      );
    }

    const updated = await this.prisma.document.update({
      where: { id },
      data: {
        status: DocumentStatus.ARCHIVED,
        errorMessage: null,
      },
    });

    // best-effort: 清掉 MinIO 上的原始文件;若失败仅 warn,不影响归档语义
    await this.storage.removeObject(doc.fileKey).catch((err) => {
      this.logger.warn(
        `archive cleanup failed key=${doc.fileKey}: ${(err as Error).message}`,
      );
    });

    this.logger.log(
      `document archived id=${id} by=${user?.username ?? "system"} prevStatus=${doc.status}`,
    );

    return { id: updated.id, status: updated.status };
  }

  // ---------- reindex ----------

  async reindex(
    id: string,
    user: JwtUser | undefined,
  ): Promise<{ uploadJobId: string }> {
    const doc = await this.prisma.document.findUnique({ where: { id } });
    if (!doc) {
      throw new BusinessException(
        ErrorCode.DOCUMENT_NOT_FOUND,
        `Document not found: ${id}`,
      );
    }
    if (doc.status === DocumentStatus.ARCHIVED) {
      throw new BusinessException(
        ErrorCode.VALIDATION_FAILED,
        `Cannot reindex archived document: ${id}`,
      );
    }

    await this.prisma.document.update({
      where: { id },
      data: {
        status: DocumentStatus.PENDING,
        errorMessage: null,
        chunkCount: 0,
      },
    });

    const uploadJob = await this.prisma.uploadJob.create({
      data: {
        documentId: id,
        uploaderId: user?.sub ?? doc.uploaderId,
        status: JobStatus.QUEUED,
        progress: 0,
        stage: "PENDING",
      },
    });

    await this.queue.addIngest(DOCUMENT_INGEST_JOB, { documentId: id });

    this.logger.log(
      `document reindex requested id=${id} uploadJobId=${uploadJob.id} by=${user?.username ?? "system"}`,
    );

    return { uploadJobId: uploadJob.id };
  }

  // ---------- jobs ----------

  async getJobs(id: string): Promise<UploadJobResponse[]> {
    const doc = await this.prisma.document.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!doc) {
      throw new BusinessException(
        ErrorCode.DOCUMENT_NOT_FOUND,
        `Document not found: ${id}`,
      );
    }

    const jobs = await this.prisma.uploadJob.findMany({
      where: { documentId: id },
      orderBy: { createdAt: "desc" },
      take: RECENT_JOBS_LIMIT,
      select: UPLOAD_JOB_SELECT,
    });

    return jobs.map((j) => this.toJobResponse(j));
  }

  // ---------- helpers ----------

  private toResponse(
    doc: Document & {
      uploader?: {
        id: string;
        username: string;
        displayName: string | null;
      } | null;
    },
  ): DocumentResponse {
    return {
      id: doc.id,
      title: doc.title,
      kbVersionId: doc.kbVersionId,
      fileKey: doc.fileKey,
      fileType: doc.fileType,
      fileSize: doc.fileSize,
      status: doc.status,
      errorMessage: doc.errorMessage,
      chunkCount: doc.chunkCount,
      uploaderId: doc.uploaderId,
      uploader: doc.uploader ?? null,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  private toJobResponse(
    job: Pick<
      UploadJob,
      | "id"
      | "status"
      | "progress"
      | "stage"
      | "errorMessage"
      | "startedAt"
      | "finishedAt"
      | "createdAt"
      | "updatedAt"
    >,
  ): UploadJobResponse {
    return {
      id: job.id,
      status: job.status,
      progress: job.progress,
      stage: job.stage,
      errorMessage: job.errorMessage,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }
}
