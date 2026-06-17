import { Global, Module } from "@nestjs/common";
import { RedisService } from "./redis.service";
import { RedisClientModule } from "./redis-client.module";

@Global()
@Module({
  imports: [RedisClientModule],
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
