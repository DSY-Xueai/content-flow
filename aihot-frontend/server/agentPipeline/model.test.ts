import { describe, expect, it, vi } from 'vitest';
import { buildDraftPrompt, generateDraftMarkdown, isEnglishMarkdown, readModelConfig } from './model';

describe('agent model', () => {
  it.each([
    ['# English article\n\nThis article explains how agents work.', true],
    ['# 中文标题\n\nThis article explains how agents help people build useful tools.', true],
    ['# 中文文章\n\n这是一篇介绍 AI Agent 的中文文章。', false],
    [
      '---\ntitle: An English metadata title for this document\n---\n\n# 中文文章\n\n正文介绍。\n\n```ts\nconst englishExample = "a long example with many English words";\n```\n\n~~~python\nprint("another long example with many English words")\n~~~\n\n`inline code with English words`\n\n[文档](https://example.com/some/long/english/path)\n\n[ref]: https://example.com/another/english/path\n\n<!-- An English comment with many words -->',
      false
    ],
    ['```js\nconsole.log("Hello world");\n```', false]
  ])('detects prose language without treating code or metadata as body text: %s', (markdown, expected) => {
    expect(isEnglishMarkdown(markdown)).toBe(expected);
  });

  it('uses a translation prompt that preserves the imported document instead of writing a new article', () => {
    const original = '---\ntitle: Agent tools\n---\n\n# Agent tools\n\nUse [docs](https://example.com).\n\n```js\nconsole.log("Hello");\n```';
    const prompt = buildDraftPrompt({
      topic: 'Agent tools',
      materialsMarkdown: '',
      previousDraft: original,
      translateToChinese: true
    });

    expect(prompt.user).toBe(original);
    expect(prompt.system).toContain('先识别正文语言');
    expect(prompt.system).toContain('简体中文');
    expect(prompt.system).toContain('不扩写');
    expect(prompt.system).toContain('图片路径');
    expect(prompt.system).not.toContain('有立意');
  });

  it('builds a prompt that forbids source sections and summary stitching', () => {
    const prompt = buildDraftPrompt({
      topic: 'AI Agent 商业化',
      materialsMarkdown: '# 写作素材\n\n## AI HOT 素材\n\n- 标题：新闻\n- 摘要：摘要\n'
    });

    expect(prompt.system).toContain('公众号文章');
    expect(prompt.system).toContain('不能只是素材摘要拼接');
    expect(prompt.system).toContain('不要输出“参考来源”');
    expect(prompt.user).toContain('AI Agent 商业化');
    expect(prompt.user).toContain('标题：新闻');
  });

  it('calls OpenAI-compatible chat completions and returns markdown', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '---\ntitle: 测试文章\n---\n\n# 测试文章\n\n正文'
              }
            }
          ]
        }),
        { status: 200 }
      )
    );

    const markdown = await generateDraftMarkdown(
      {
        topic: '测试主题',
        materialsMarkdown: '# 写作素材\n无外部素材。'
      },
      {
        apiKey: 'key',
        baseUrl: 'https://api.example.com/v1',
        model: 'model-a',
        fetchImpl: fetchMock
      }
    );

    expect(markdown).toContain('title: 测试文章');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer key',
          'Content-Type': 'application/json'
        })
      })
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.model).toBe('model-a');
    expect(body.messages).toHaveLength(2);
  });

  it('passes the abort signal to the model request', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '# Draft' } }]
        }),
        { status: 200 }
      )
    );

    await generateDraftMarkdown(
      { topic: 'Topic', materialsMarkdown: '# Materials' },
      {
        apiKey: 'key',
        baseUrl: 'https://api.example.com/v1',
        model: 'model-a',
        fetchImpl: fetchMock,
        signal: controller.signal
      }
    );

    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ signal: controller.signal }));
  });

  it('fails clearly when model config is missing', async () => {
    await expect(
      generateDraftMarkdown(
        { topic: '主题', materialsMarkdown: '# 写作素材\n' },
        { apiKey: '', baseUrl: '', model: '', fetchImpl: vi.fn() }
      )
    ).rejects.toThrow('缺少 AGENT_TEXT_API_KEY、AGENT_TEXT_BASE_URL 或 AGENT_TEXT_MODEL');
  });

  it('uses dedicated text model env before generic OpenAI env', () => {
    expect(
      readModelConfig({
        OPENAI_API_KEY: 'image-key',
        OPENAI_BASE_URL: 'https://api.example.com/v1/images/generations',
        OPENAI_MODEL: 'image-model',
        AGENT_TEXT_API_KEY: 'text-key',
        AGENT_TEXT_BASE_URL: 'https://chat.example.com/v1',
        AGENT_TEXT_MODEL: 'chat-model'
      })
    ).toMatchObject({
      apiKey: 'text-key',
      baseUrl: 'https://chat.example.com/v1',
      model: 'chat-model'
    });
  });

  it('ignores empty dedicated text fields when reading legacy text settings', () => {
    expect(readModelConfig({
      AGENT_TEXT_API_KEY: ' ', AGENT_TEXT_BASE_URL: '', AGENT_TEXT_MODEL: '',
      OPENAI_API_KEY: 'legacy-key', OPENAI_BASE_URL: 'https://text.example.com/v1', OPENAI_MODEL: 'chat-model'
    })).toMatchObject({ apiKey: 'legacy-key', baseUrl: 'https://text.example.com/v1', model: 'chat-model' });
  });

  it('never uses neutral image credentials for draft text generation', () => {
    expect(readModelConfig({
      AGENT_IMAGE_API_KEY: 'image-key',
      AGENT_IMAGE_BASE_URL: 'https://ark.cn-beijing.volces.com/api/v3',
      AGENT_IMAGE_MODEL: 'doubao-seedream-5-0-pro-260628'
    })).toMatchObject({ apiKey: '', baseUrl: '', model: '' });
  });

  it('does not treat an image generations endpoint as the draft chat model endpoint', () => {
    expect(
      readModelConfig({
        OPENAI_API_KEY: 'image-key',
        OPENAI_BASE_URL: 'https://api.example.com/v1/images/generations',
        OPENAI_MODEL: 'image-model'
      })
    ).toMatchObject({
      apiKey: '',
      baseUrl: '',
      model: ''
    });
  });
});
