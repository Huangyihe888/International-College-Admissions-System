import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Client as MinioClient } from "minio";
import { TypedConfigService } from "../config/typed-config.service";
import { BusinessException } from "../common/errors/business.exception";
import { ErrorCode } from "../common/errors/error-code";

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: MinioClient;
  private readonly bucket: string;
  private bucketReady = false;

  constructor(private readonly cfg: TypedConfigService) {
    const m = this.cfg.minio;
    this.client = new MinioClient({
      endPoint: m.endPoint,
      port: m.port,
      useSSL: m.useSSL,
      accessKey: m.accessKey,
      secretKey: m.secretKey,
    });
    this.bucket = m.bucket;
  }

  async onModuleInit() {
    await this.ensureBucket();
  }

  async ensureBucket() {
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket, "us-east-1");
        this.logger.log(`Bucket ${this.bucket} created`);
      }
      this.bucketReady = true;
    } catch (e) {
      this.logger.error(`Failed to ensure bucket: ${(e as Error).message}`);
    }
  }

  async putObject(
    key: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    if (!this.bucketReady) await this.ensureBucket();
    try {
      await this.client.putObject(this.bucket, key, buffer, buffer.length, {
        "Content-Type": contentType,
      });
      return key;
    } catch (e) {
      throw new BusinessException({
        code: ErrorCode.STORAGE_FAILED,
        message: `Failed to put object: ${(e as Error).message}`,
      });
    }
  }

  async getObject(key: string): Promise<Buffer> {
    try {
      const stream = await this.client.getObject(this.bucket, key);
      const chunks: Buffer[] = [];
      return new Promise((resolve, reject) => {
        stream.on("data", (chunk) => chunks.push(chunk as Buffer));
        stream.on("end", () => resolve(Buffer.concat(chunks)));
        stream.on("error", reject);
      });
    } catch (e) {
      throw new BusinessException({
        code: ErrorCode.STORAGE_FAILED,
        message: `Failed to get object: ${(e as Error).message}`,
      });
    }
  }

  async removeObject(key: string): Promise<void> {
    try {
      await this.client.removeObject(this.bucket, key);
    } catch (e) {
      throw new BusinessException({
        code: ErrorCode.STORAGE_FAILED,
        message: `Failed to remove object: ${(e as Error).message}`,
      });
    }
  }

  async statObject(
    key: string,
  ): Promise<{ size: number; lastModified: Date } | null> {
    try {
      const s = await this.client.statObject(this.bucket, key);
      return { size: s.size, lastModified: s.lastModified };
    } catch {
      return null;
    }
  }

  async getSignedUrl(key: string, expirySec = 3600): Promise<string> {
    return this.client.presignedGetObject(this.bucket, key, expirySec);
  }
}
