import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from "@nestjs/common";
import { ZodSchema } from "zod";

@Injectable()
export class ZodValidationPipe<T = unknown> implements PipeTransform {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        code: 1001,
        message: "Validation failed",
        data: { errors: result.error.issues },
      });
    }
    return result.data as T;
  }
}
