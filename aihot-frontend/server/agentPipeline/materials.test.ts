import { describe, expect, it } from 'vitest';
import {
  createAihotMaterial,
  createXMaterial,
  mergeMaterials,
  renderMaterialsMarkdown
} from './materials';

describe('agent materials', () => {
  it('keeps only title and summary for AI HOT materials', () => {
    const material = createAihotMaterial({
      id: 'item-1',
      title: 'OpenAI 发布新工具',
      summary: '一个面向开发者的 Agent 工作流更新。',
      source: 'OpenAI Blog',
      url: 'https://example.com',
      tags: ['Agent'],
      reason: '推荐理由',
      time: '素材发布时间',
      media: ['cover.png']
    });

    expect(material).toEqual({
      id: 'aihot:item-1',
      sourceType: 'aihot',
      title: 'OpenAI 发布新工具',
      summary: '一个面向开发者的 Agent 工作流更新。',
      addedAt: material.addedAt
    });
    expect(JSON.stringify(material)).not.toContain('OpenAI Blog');
    expect(JSON.stringify(material)).not.toContain('https://example.com');
    expect(JSON.stringify(material)).not.toContain('推荐理由');
    expect(JSON.stringify(material)).not.toContain('素材发布时间');
    expect(JSON.stringify(material)).not.toContain('cover.png');
  });

  it('uses translated text for X materials and falls back to visible text', () => {
    expect(
      createXMaterial({
        handle: 'OpenAI',
        displayName: 'OpenAI',
        text: 'Original text',
        translatedText: '中文译文'
      }).summary
    ).toBe('中文译文');

    expect(
      createXMaterial({
        handle: 'AnthropicAI',
        text: 'Visible text',
        translatedText: ''
      }).summary
    ).toBe('Visible text');
  });

  it('uses display name for X title and falls back to handle', () => {
    expect(
      createXMaterial({
        handle: 'OpenAI',
        displayName: 'OpenAI 官方',
        text: 'X post'
      }).title
    ).toBe('OpenAI 官方');

    expect(
      createXMaterial({
        handle: 'AnthropicAI',
        text: 'X post'
      }).title
    ).toBe('AnthropicAI');
  });

  it('removes URLs from material text before rendering', () => {
    const markdown = renderMaterialsMarkdown('topic', [
      createAihotMaterial({
        id: '1',
        title: '标题 https://example.com/a',
        summary: '摘要 www.example.com/path'
      }),
      createXMaterial({
        handle: 'OpenAI',
        translatedText: '中文动态 https://example.com/post',
        text: 'English post'
      })
    ]);

    expect(markdown).toContain('- 标题：标题');
    expect(markdown).toContain('- 摘要：摘要');
    expect(markdown).toContain('- 内容：中文动态');
    expect(markdown).not.toContain('http');
    expect(markdown).not.toContain('www.');
    expect(markdown).not.toContain('example.com');
  });

  it('deduplicates materials by id while preserving order', () => {
    const first = createAihotMaterial({ id: '1', title: 'A', summary: 'S' });
    const duplicate = { ...first, summary: 'Changed' };
    const second = createXMaterial({ handle: 'OpenAI', text: 'X post' });

    expect(mergeMaterials([first], [duplicate, second])).toEqual([first, second]);
  });

  it('renders a source-free materials markdown package', () => {
    const markdown = renderMaterialsMarkdown('AI Agent 的产品化机会', [
      createAihotMaterial({ id: '1', title: '标题', summary: '摘要' }),
      createXMaterial({ handle: 'OpenAI', translatedText: '中文动态', text: 'English post' })
    ]);

    expect(markdown).toContain('# 发文主题');
    expect(markdown).toContain('AI Agent 的产品化机会');
    expect(markdown).toContain('## AI HOT 素材');
    expect(markdown).toContain('- 标题：标题');
    expect(markdown).toContain('- 摘要：摘要');
    expect(markdown).toContain('## X 特定来源素材');
    expect(markdown).toContain('- 账号：OpenAI');
    expect(markdown).toContain('- 内容：中文动态');
    expect(markdown).not.toContain('参考来源');
    expect(markdown).not.toContain('http');
  });
});
