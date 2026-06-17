/**
 * 中文招生资料文本清洗 — 解决 PDF 软换行 + 页眉页脚 + 噪声
 * P0 修复:中文字符间的 \n(软换行)合并,让 RecursiveCharacterTextSplitter
 * 能识别真实段落边界,避免一个 800-字 chunk 被切碎成 "招\n生\n简\n章"。
 */
export function cleanChineseAcademicText(raw: string): string {
  return raw
    // 1) 全角空格 / 不可见空白归一
    .replace(/[  -​﻿]/g, " ")
    // 2) 页眉页脚: "-1-" / "第 X 页 共 Y 页" / " - 1 / 2 - "
    .replace(/[-—_]?\s*\d{1,3}\s*[-—_]?\s*(?:\/\s*\d{1,3})?/g, " ")
    // 3) 招生简章常见水印
    .replace(/(五邑大学|WYU)\s*国际教育学院.{0,40}/g, " ")
    // 4) URL / 邮箱 / 电话(检索时常作噪声)
    .replace(/https?:\/\/\S+|[\w.-]+@[\w.-]+|\d{3,4}-\d{7,8}/g, " ")
    // 5) ★★★ 最关键:PDF 软换行 "招\n生" → "招生"(中文按字 split 的关键修复)
    .replace(/([一-鿿])\n([一-鿿])/g, "$1$2")
    // 6) 连续空白折叠
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
