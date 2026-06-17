import XLSX from "xlsx";
import pg from "pg";

const FILE = "/Users/huangyihe/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_7rbnqaavtco722_5bee/msg/file/2026-06/中外联合培养项目问答汇总-方颖.xlsx";
const DB_URL = "postgresql://wyu:changeme@localhost:5432/wyu_rag?schema=public";

// Parse xlsx
const wb = XLSX.readFile(FILE);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

// Find Q&A pairs (skip header row)
// Expected columns: 序号, 问题, 回答
const qaPairs = [];
for (let i = 0; i < rows.length; i++) {
  const row = rows[i];
  if (row.length < 3) continue;
  const num = String(row[0]).trim();
  const question = String(row[1]).trim();
  const answer = String(row[2]).trim();
  
  // Skip header or empty rows
  if (!num || !question || !answer) continue;
  if (num === "序号" || question === "问题") continue;
  if (isNaN(Number(num))) continue;
  
  qaPairs.push({ question, answer });
}

console.log(`Found ${qaPairs.length} Q&A pairs`);

// Insert into FaqItem table
const client = new pg.Client(DB_URL);
await client.connect();

let inserted = 0;
for (const qa of qaPairs) {
  // Check if already exists
  const existing = await client.query(
    `SELECT id FROM "FaqItem" WHERE question = $1`,
    [qa.question]
  );
  if (existing.rows.length > 0) {
    console.log(`Skip (exists): ${qa.question.slice(0, 40)}...`);
    continue;
  }
  
  const id = `faq_xlsx_${Date.now()}_${inserted}`;
  await client.query(
    `INSERT INTO "FaqItem" (id, question, answer, category, "isActive", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, '中外合作办学', true, NOW(), NOW())`,
    [id, qa.question, qa.answer]
  );
  inserted++;
}

await client.end();
console.log(`Inserted ${inserted} new FAQ items (skipped ${qaPairs.length - inserted} duplicates)`);
