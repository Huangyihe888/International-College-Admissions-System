/**
 * passport-jwt 的最小 stub。
 *
 * 原因:package.json 没把 passport-jwt 列为直接依赖,而 jest+ts-jest 在加载 AppModule
 * 时会沿 import 链去 require('passport-jwt')。在不动 package.json / 不 pnpm add 的
 * 前提下,通过 jest moduleNameMapper 把该模块重定向到本 stub 即可让 e2e 跑起来。
 *
 * 真实 AuthModule 的 JwtAuthGuard 会被 JwtAuthGuard.canActivate 拦截(@Public() 短路
 * 或 super.canActivate 调 passport),e2e 不验证 jwt.verify 内部,只需要 import 不报错。
 */
export const ExtractJwt = {
  fromAuthHeaderAsBearerToken: () => "stub-from-auth-header",
  fromExtractors: () => "stub-from-extractors",
  fromBodyField: () => "stub-from-body-field",
};

export class Strategy {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(_opts: any) {
    // noop
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticate(_req: any, _options?: any): void {
    // noop
  }
}

export default { ExtractJwt, Strategy };
