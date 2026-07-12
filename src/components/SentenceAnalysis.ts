import type { SentenceComponent } from "../lib/types";
import { escapeAttr, escapeHtml } from "../lib/view";

export function renderSentenceAnalysisTree(components: SentenceComponent[], activeComponentId = ""): string {
  if (!components.length) return `<p class="muted">这个句子还没有句子成分分析。</p>`;
  return `<div class="component-tree">${components.map((component) => renderComponent(component, activeComponentId)).join("")}</div>`;
}

function renderComponent(component: SentenceComponent, activeComponentId: string): string {
  const active = component.id === activeComponentId ? " is-active" : "";
  const children = component.children?.length
    ? `<div class="component-children">${component.children.map((child) => renderComponent(child, activeComponentId)).join("")}</div>`
    : "";
  return `
    <article class="component-card${active}">
      <button class="component-main" type="button" data-component-id="${escapeAttr(component.id)}">
        <strong>${escapeHtml(component.text)}</strong>
      <span>成分：${escapeHtml(component.role || "未标注")}</span>
      <span>中文：${escapeHtml(component.zh || "未标注")}</span>
      </button>
      ${children}
    </article>
  `;
}
