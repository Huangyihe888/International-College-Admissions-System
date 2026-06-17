import { SetMetadata } from "@nestjs/common";
import { ProcessorOptions } from "./jobs.types";

export const PROCESSOR_METADATA = "BULLMQ_PROCESSOR";

export interface ProcessorMetadata extends ProcessorOptions {
  name: string;
}

export function Processor(
  name: string,
  options: ProcessorOptions = {},
): MethodDecorator & ClassDecorator {
  return SetMetadata(PROCESSOR_METADATA, { name, ...options });
}
