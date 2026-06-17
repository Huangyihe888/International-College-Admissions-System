const { PrismaClient } = require('./backend/node_modules/@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const feedbacks = await prisma.feedback.findMany();
  console.log(feedbacks);
}
main().finally(() => prisma.$disconnect());
