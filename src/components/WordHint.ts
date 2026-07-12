import type { WordHint } from "../lib/types";
import { escapeHtml } from "../lib/view";

export function renderWordHint(hint?: WordHint): string {
  if (!hint) {
    return `
      <aside class="hint-card">
        <h3>提示</h3>
        <p class="muted">点击一个空格，再点“提示”。</p>
      </aside>
    `;
  }

  const parent = hint.parentComponentText
    ? `<p><span>所在成分</span><strong>${escapeHtml(hint.parentComponentText)} = ${escapeHtml(hint.parentComponentRole || "未标注")}</strong><em>${escapeHtml(hint.parentComponentZh || "")}</em></p>`
    : "";

  return `
    <aside class="hint-card">
      <h3>${escapeHtml(hint.text)}</h3>
      <p><span>音标</span><strong>${escapeHtml(hint.phonetic || "暂缺")}</strong></p>
      <p><span>中文</span><strong>${escapeHtml(hint.zh || "暂缺")}</strong></p>
      <p><span>词性</span><strong>${escapeHtml(hint.pos || "暂缺")}</strong></p>
      <p><span>句子成分</span><strong>${escapeHtml(hint.componentRole || "暂缺")}</strong><em>${escapeHtml(hint.componentZh || "")}</em></p>
      ${parent}
    </aside>
  `;
}
