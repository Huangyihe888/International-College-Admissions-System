import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { EmbeddingService } from '../src/llm/embedding.service';

const prisma = new PrismaClient();

type RoleSeed = {
  name: 'admin' | 'operator' | 'viewer';
  description: string;
  permissions: string[];
};

const ROLES: RoleSeed[] = [
  {
    name: 'admin',
    description: '超级管理员,拥有所有权限',
    permissions: ['*'],
  },
  {
    name: 'operator',
    description: '运营人员,可管理文档、FAQ、禁答规则、知识库版本',
    permissions: [
      'document:*',
      'kb-version:*',
      'faq:*',
      'forbidden-rule:*',
      'low-confidence:*',
      'analytics:read',
    ],
  },
  {
    name: 'viewer',
    description: '只读账号,可查看运营数据但不能修改',
    permissions: [
      'document:read',
      'kb-version:read',
      'faq:read',
      'forbidden-rule:read',
      'analytics:read',
    ],
  },
];

/**
 * 5-8 条标准招生 FAQ 种子。question 必须唯一(用 deleteMany + create 兜底幂等)。
 * 真实生产数据请从招生处获取,这里只覆盖高频通用问题,演示流程。
 */
const FAQ_SEED: { question: string; answer: string; category: string }[] = [
  {
    category: '招生政策',
    question: '五邑大学国际教育学院 2026 年招生的报名时间是什么时候?',
    answer:
      '2026 年招生报名时间一般为每年 6 月至 8 月(高考志愿填报前后),具体以教育部及广东省教育考试院当年发布的招生章程为准。请关注五邑大学招生信息网获取最新通知。',
  },
  {
    category: '招生政策',
    question: '国际教育学院有哪些本科招生专业?',
    answer:
      '国际教育学院目前开设多个中外合作办学本科专业,包括会计学、金融学、计算机科学与技术等。详细专业目录与培养方案以当年招生章程为准。',
  },
  {
    category: '录取标准',
    question: '中外合作办学专业的录取分数线是多少?',
    answer:
      '录取分数线根据当年报考人数、计划数及考生成绩而定,通常高于一本线一定分数。学院会按"分数优先、遵循志愿"原则择优录取,具体请参考学校发布的分专业录取分数统计。',
  },
  {
    category: '学费',
    question: '中外合作办学专业的学费大概是多少?',
    answer:
      '中外合作办学专业学费高于普通本科专业,具体金额按当年批复执行,通常按学分或学年收费,详细金额请查阅《五邑大学 2026 年本科招生章程》。',
  },
  {
    category: '学制',
    question: '国际教育学院本科是几年制?',
    answer:
      '中外合作办学本科专业基本学制为 4 年,实行学分制管理,在规定年限内修满培养方案要求的学分即可毕业。',
  },
  {
    category: '语言要求',
    question: '中外合作办学对英语有要求吗?',
    answer:
      '中外合作办学项目一般对英语有一定要求,部分课程采用全英文或双语教学,入学后会有相应的语言强化安排。具体英语单科分数线以当年招生章程为准。',
  },
  {
    category: '毕业去向',
    question: '中外合作办学项目能否不出国？',
    answer:
      '联合培养专业可转其他联合培养专业(需参加国际教育学院考核选拔)。不可以转普通本科。',
  },
  {
    category: '咨询渠道',
    question: '招生咨询电话是多少?',
    answer:
      '请通过五邑大学招生信息网或国际教育学院官网获取最新咨询电话与邮箱;工作日 9:00-17:00 在线咨询。',
  },
];

async function seedRoles() {
  const results = [];
  for (const r of ROLES) {
    const role = await prisma.role.upsert({
      where: { name: r.name },
      create: {
        name: r.name,
        description: r.description,
        permissions: r.permissions,
      },
      update: {
        description: r.description,
        permissions: r.permissions,
      },
    });
    results.push(role);
  }
  return results;
}

async function seedAdminUser(adminRoleId: string) {
  const username = process.env.SEED_ADMIN_USERNAME ?? 'admin';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'admin123';
  const email = process.env.SEED_ADMIN_EMAIL ?? null;

  if (password === 'admin123') {
    console.warn(
      '[seed] ⚠ 使用默认密码 admin123。生产环境请通过 SEED_ADMIN_PASSWORD 设置强密码。',
    );
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const user = await prisma.user.upsert({
    where: { username },
    create: {
      username,
      passwordHash,
      displayName: '系统管理员',
      email: email ?? undefined,
      roleId: adminRoleId,
      status: 'ACTIVE',
    },
    update: {
      passwordHash,
      roleId: adminRoleId,
      status: 'ACTIVE',
    },
  });
  return user;
}

/**
 * 种 FAQ:
 *  - 优先尝试 bootstrap 一个最小 NestJS context 拿到 EmbeddingService,把每条 FAQ 的 embedding 写进去
 *  - 失败(REDIS/Redis 未就绪、或 Embedding 配额不可用)就 warn,继续以"无 embedding"插入
 *    后续可由 admin 在后台 FAQ 管理里"编辑并保存"触发重算,或者跑单独的 backfill 脚本
 *  - 幂等:用 question 文本做 deleteMany 兜底,保证重跑 seed 不会重复
 */
async function seedFaqs() {
  console.log(`[seed] preparing ${FAQ_SEED.length} FAQ entries…`);

  let embed: EmbeddingService | null = null;
  try {
    const app = await NestFactory.createApplicationContext(AppModule, {
      logger: ['error', 'warn'],
    });
    embed = app.get(EmbeddingService);
  } catch (err) {
    console.warn(
      `[seed] ⚠ NestJS context 启动失败,FAQ 将不带 embedding 写入: ${(err as Error).message}`,
    );
  }

  // 先把本次要种的 question 全部删掉,保证幂等
  await prisma.faqItem.deleteMany({
    where: { question: { in: FAQ_SEED.map((f) => f.question) } },
  });

  let createdCount = 0;
  let embeddedCount = 0;
  for (const item of FAQ_SEED) {
    const row = await prisma.faqItem.create({
      data: {
        question: item.question,
        answer: item.answer,
        category: item.category,
        isActive: true,
      },
    });
    createdCount += 1;

    if (embed) {
      try {
        const res = await embed.embed([item.question]);
        const vec = res.items[0]?.embedding;
        if (vec && vec.length > 0) {
          const literal = `[${vec.join(',')}]`;
          await prisma.$executeRaw`
            UPDATE "FaqItem"
            SET embedding = ${literal}::vector
            WHERE id = ${row.id}
          `;
          embeddedCount += 1;
        }
      } catch (err) {
        console.warn(
          `[seed] ⚠ FAQ embedding failed for "${item.question.slice(0, 30)}…": ${(err as Error).message}`,
        );
      }
    }
  }

  console.log(
    `[seed] FAQ: created=${createdCount}, embedded=${embeddedCount}/${createdCount}`,
  );
}

async function main() {
  console.log('[seed] start');

  const roles = await seedRoles();
  console.log(`[seed] roles upserted: ${roles.map((r) => r.name).join(', ')}`);

  const adminRole = roles.find((r) => r.name === 'admin');
  if (!adminRole) throw new Error('admin role missing');

  const admin = await seedAdminUser(adminRole.id);
  console.log(`[seed] admin user ready: ${admin.username} (id=${admin.id})`);

  await seedFaqs();

  console.log('[seed] done');
}

main()
  .catch((err) => {
    console.error('[seed] failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
