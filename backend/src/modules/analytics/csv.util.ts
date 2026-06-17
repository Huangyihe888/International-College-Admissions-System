/**
 * 极简 CSV 工具 — 无第三方依赖。
 * 规则:
 *  - 字段含 `,` / `"` / `\n` / `\r` 时整段用 `"` 包裹,内部 `"` 双写转义
 *  - 行分隔符 `\r\n` (Excel 友好)
 *  - 文件起始加 UTF-8 BOM (﻿) 让 Excel 直接打开中文不乱码
 */

const NEED_QUOTE = /[",\r\n]/;
const BOM = "﻿";

export type CsvCell = string | number | boolean | null | undefined | Date;

export function csvEscape(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  let s: string;
  if (value instanceof Date) s = value.toISOString();
  else if (typeof value === "boolean") s = value ? "true" : "false";
  else s = String(value);
  if (NEED_QUOTE.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildCsv(header: string[], rows: CsvCell[][]): string {
  const lines: string[] = [];
  lines.push(header.map(csvEscape).join(","));
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(","));
  }
  return BOM + lines.join("\r\n") + "\r\n";
}
