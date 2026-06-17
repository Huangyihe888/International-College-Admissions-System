/**
 * ForbidChecker 单元测试
 * 覆盖:三路匹配(KEYWORD / REGEX / CATEGORY)、缓存命中、DB 挂 fail-open、60s 刷新。
 * PrismaService 全部 mock。
 */
import { ForbidChecker } from "./forbid-checker.service";
import { PrismaService } from "../../../database/prisma.service";

jest.mock("../../../database/prisma.service", () => ({
  PrismaService: class PrismaService {},
}));

function makePrisma(findMany: jest.Mock): PrismaService {
  return { forbiddenRule: { findMany } } as any;
}

function rule(
  over: Partial<{
    id: string;
    name: string;
    pattern: string;
    ruleType: "KEYWORD" | "REGEX" | "CATEGORY";
    reply: string | null;
    isActive: boolean;
  }> = {},
) {
  return {
    id: "r1",
    name: "politics",
    pattern: "政府",
    ruleType: "KEYWORD" as const,
    reply: "请换个问题",
    isActive: true,
    ...over,
  };
}

describe("ForbidChecker", () => {
  it("关键词命中:含子串(忽略大小写)即 hit", async () => {
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([rule({ pattern: "赌博" })]);
    const checker = new ForbidChecker(makePrisma(findMany));

    const res = await checker.check("你能教我参与赌博吗");
    expect(res.hit).toBe(true);
    expect(res.ruleId).toBe("r1");
    expect(res.reply).toBe("请换个问题");
    expect(findMany).toHaveBeenCalledWith({ where: { isActive: true } });

    // 大小写无关
    findMany.mockResolvedValueOnce([rule({ pattern: "BLOCK" })]);
    const checker2 = new ForbidChecker(makePrisma(findMany));
    expect((await checker2.check("please block me")).hit).toBe(true);
  });

  it("正则命中:不区分大小写 + 复杂 pattern", async () => {
    const findMany = jest.fn().mockResolvedValueOnce([
      rule({
        id: "r2",
        name: "hack",
        pattern: "\\b(hack|crack)\\b",
        ruleType: "REGEX",
      }),
    ]);
    const checker = new ForbidChecker(makePrisma(findMany));

    expect((await checker.check("How to HACK a system")).hit).toBe(true);
    expect((await checker.check("safe topic")).hit).toBe(false);
  });

  it("分类命中:同 keyword 路径(忽略大小写)", async () => {
    const findMany = jest.fn().mockResolvedValueOnce([
      rule({
        id: "r3",
        name: "medical",
        pattern: "诊断",
        ruleType: "CATEGORY",
      }),
    ]);
    const checker = new ForbidChecker(makePrisma(findMany));

    expect((await checker.check("帮我做一次疾病诊断")).hit).toBe(true);
    expect((await checker.check("推荐学校")).hit).toBe(false);
  });

  it("三路都不命中:hit=false", async () => {
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([
        rule({ pattern: "赌博" }),
        rule({ id: "r2", name: "r2", pattern: "hack", ruleType: "REGEX" }),
      ]);
    const checker = new ForbidChecker(makePrisma(findMany));

    const res = await checker.check("请问 WYU 学费?");
    expect(res.hit).toBe(false);
  });

  it("规则为空 或 question 为空:直接 hit=false,不查库", async () => {
    const findMany = jest.fn();
    const checker = new ForbidChecker(makePrisma(findMany));

    // 规则为空
    findMany.mockResolvedValueOnce([]);
    expect((await checker.check("hello")).hit).toBe(false);

    // question 为空
    findMany.mockResolvedValueOnce([rule()]);
    expect((await checker.check("")).hit).toBe(false);
  });

  it("DB 抛错:fail-open,返回 hit=false,不阻断", async () => {
    const findMany = jest.fn().mockRejectedValueOnce(new Error("db down"));
    const checker = new ForbidChecker(makePrisma(findMany));

    const res = await checker.check("any question");
    expect(res.hit).toBe(false);
    // 错误后应再尝试一次加载(fail-open 不缓存)
    findMany.mockResolvedValueOnce([rule()]);
    const res2 = await checker.check("政府");
    expect(res2.hit).toBe(true);
  });

  it("缓存命中:60s 内不再查 DB", async () => {
    const findMany = jest.fn().mockResolvedValue([rule()]);
    const checker = new ForbidChecker(makePrisma(findMany));

    await checker.check("q1");
    await checker.check("q2");
    await checker.check("q3");
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("60s 后缓存失效:重新查 DB", async () => {
    const findMany = jest.fn().mockResolvedValue([rule()]);
    const checker = new ForbidChecker(makePrisma(findMany));

    // 第一次加载
    await checker.check("q1");
    expect(findMany).toHaveBeenCalledTimes(1);

    // 60s 未到
    const nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockReturnValue(Date.now() + 30_000);
    await checker.check("q2");
    expect(findMany).toHaveBeenCalledTimes(1);

    // 60s 之后
    nowSpy.mockReturnValue(Date.now() + 60_001);
    await checker.check("q3");
    expect(findMany).toHaveBeenCalledTimes(2);
    nowSpy.mockRestore();
  });

  it("正则 pattern 非法:catch 后视为不命中,不抛", async () => {
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([
        rule({ id: "rx", name: "rx", pattern: "[invalid(", ruleType: "REGEX" }),
      ]);
    const checker = new ForbidChecker(makePrisma(findMany));
    const res = await checker.check("anything");
    expect(res.hit).toBe(false);
  });

  it("invalidate():强制下一次重新查 DB", async () => {
    const findMany = jest.fn().mockResolvedValue([rule()]);
    const checker = new ForbidChecker(makePrisma(findMany));

    await checker.check("q1");
    expect(findMany).toHaveBeenCalledTimes(1);

    checker.invalidate();
    await checker.check("q2");
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it("未匹配规则:不返回 reply,仅返回 hit=false", async () => {
    const findMany = jest.fn().mockResolvedValueOnce([]);
    const checker = new ForbidChecker(makePrisma(findMany));
    const res = await checker.check("safe");
    expect(res).toEqual({ hit: false });
  });
});
