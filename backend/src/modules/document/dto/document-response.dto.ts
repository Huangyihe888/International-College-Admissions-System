import {
  Document,
  DocumentStatus,
  JobStatus,
  UploadJob,
  User,
} from "@prisma/client";

export interface DocumentResponse {
  id: string;
  title: string;
  kbVersionId: string;
  fileKey: string;
  fileType: string;
  fileSize: number;
  status: DocumentStatus;
  errorMessage: string | null;
  chunkCount: number;
  uploaderId: string;
  uploader?: {
    id: string;
    username: string;
    displayName: string | null;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentListResponse {
  items: DocumentResponse[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface DocumentChunkPreview {
  id: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
}

export interface DocumentDetailResponse extends DocumentResponse {
  recentChunks: DocumentChunkPreview[];
  recentJobs: UploadJobResponse[];
}

export interface UploadJobResponse {
  id: string;
  status: JobStatus;
  progress: number;
  stage: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UploadDocumentResult {
  id: string;
  status: DocumentStatus;
  uploadJobId: string;
}
