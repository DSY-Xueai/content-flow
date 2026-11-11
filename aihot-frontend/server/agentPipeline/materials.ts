import type { AgentMaterial } from './types';

interface AihotInput {
  id: string;
  title?: string | null;
  summary?: string | null;
}

interface XInput {
  handle: string;
  displayName?: string | null;
  text?: string | null;
  translatedText?: string | null;
}

export function createAihotMaterial(input: AihotInput & Record<string, unknown>, now = new Date()): AgentMaterial {
  return {
    id: `aihot:${input.id}`,
    sourceType: 'aihot',
    title: cleanText(input.title) || '未命名动态',
    summary: cleanText(input.summary) || '无摘要',
    addedAt: now.toISOString()
  };
}

export function createXMaterial(input: XInput, now = new Date()): AgentMaterial {
  const title = cleanText(input.displayName) || cleanText(input.handle) || 'X 来源';
  const summary = cleanText(input.translatedText) || cleanText(input.text) || '无可展示内容';

  return {
    id: `x:${input.handle.toLowerCase()}`,
    sourceType: 'x',
    title,
    summary,
    addedAt: now.toISOString()
  };
}

export function mergeMaterials(current: AgentMaterial[], incoming: AgentMaterial[]): AgentMaterial[] {
  const seen = new Set<string>();
  const merged: AgentMaterial[] = [];

  for (const material of [...current, ...incoming]) {
    if (seen.has(material.id)) {
      continue;
    }
    seen.add(material.id);
    merged.push(material);
  }

  return merged;
}

export function renderMaterialsMarkdown(topic: string, materials: AgentMaterial[]): string {
  const aihot = materials.filter((item) => item.sourceType === 'aihot');
  const xItems = materials.filter((item) => item.sourceType === 'x');
  const lines = ['# 发文主题', '', topic.trim(), '', '# 写作素材', ''];

  if (aihot.length) {
    lines.push('## AI HOT 素材', '');
    for (const item of aihot) {
      lines.push(`- 标题：${item.title}`);
      lines.push(`- 摘要：${item.summary}`);
      lines.push('');
    }
  }

  if (xItems.length) {
    lines.push('## X 特定来源素材', '');
    for (const item of xItems) {
      lines.push(`- 账号：${item.title}`);
      lines.push(`- 内容：${item.summary}`);
      lines.push('');
    }
  }

  if (!materials.length) {
    lines.push('无外部素材。');
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/https?:\/\/\S+/g, '').replace(/www\.\S+/g, '').replace(/\s+/g, ' ').trim() : '';
}
