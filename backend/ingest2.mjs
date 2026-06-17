import XLSX from "xlsx";
import pg from "pg";
import fs from "fs";

const FILE = "/Users/huangyihe/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_7rbnqaavtco722_5bee/msg/file/2026-06/中外联合培养项目问答汇总-方颖.xlsx";
const DB_URL = "postgresql://wyu:changeme@localhost:5432/wyu_rag?schema=public";
const DOC_ID = "doc_xlsx_1780922331346";

// Parse
const wb = XLSX.readFile(FILE);
const lines = [];
for (const name of wb.SheetNames) {
  const sheet = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  if (!rows.length) continue;
  lines.push(`[Sheet: ${name}]`);
  for (const row of rows) {
    const text = row.map(String).filter(Boolean).join(" | ");
    if (text.trim()) lines.push(text);
  }
  lines.push("");
}
const fullText = lines.join("\n");

// Chunk
const chunks = [];
let start = 0;
while (start < fullText.length) {
  const end = Math.min(start + 800, fullText.length);
  chunks.push(fullText.slice(start, end));
  if (end === fullText.length) break;
  start = end - 120;
}

const client = new pg.Client(DB_URL);
await client.connect();

// Delete old chunks if any
await client.query(`DELETE FROM "DocumentChunk" WHERE "documentId" = $1`, [DOC_ID]);

// Insert chunks
for (let i = 0; i < chunks.length; i++) {
  await client.query(
    `INSERT INTO "DocumentChunk" (id, "documentId", "chunkIndex", content, "tokenCount", "createdAt")
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [`chunk_${DOC_ID}_${i}`, DOC_ID, i, chunks[i], Math.max(1, Math.ceil(chunks[i].length / 4))]
  );
}

// Update document
await client.query(
  `UPDATE "Document" SET "chunkCount" = $1, status = 'READY', "errorMessage" = null, "processedAt" = NOW() WHERE id = $2`,
  [chunks.length, DOC_ID]
);

await client.end();
console.log(`Done! ${chunks.length} chunks inserted`);
