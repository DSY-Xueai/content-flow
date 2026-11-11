// 从 aihot-frontend 运行：node scripts/test-model-connection.ts
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { loadAgentEnv } from '../server/agentPipeline/env.ts';
import { readModelConfig } from '../server/agentPipeline/model.ts';
import { createScriptAdapter } from '../server/agentPipeline/scripts.ts';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const env = loadAgentEnv('development', appRoot, loadEnv);
const textConfig = readModelConfig(env);
const scripts = createScriptAdapter({ repoRoot: path.resolve(appRoot, '..'), env });
const outputDir = path.resolve(appRoot, '../pipeline-output/model-connection', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(outputDir, { recursive: true });

// 服务错误可能包含请求信息，输出前去掉本次使用的密钥。
function redact(message: string): string {
  for (const key of [textConfig.apiKey, env.AGENT_IMAGE_API_KEY, env.OPENAI_API_KEY, env.ARK_API_KEY, env.JIMENG_ACCESS_KEY_ID, env.JIMENG_SECRET_ACCESS_KEY]) {
    if (key) message = message.replaceAll(key, '[REDACTED]');
  }
  return message;
}

async function request(config: { apiKey?: string; baseUrl: string; model?: string }, endpoint: string, body: object) {
  if (!config.apiKey || !config.baseUrl || !config.model) {
    throw new Error('缺少 API Key、服务地址或模型名称，请检查 .env');
  }
  const baseUrl = config.baseUrl.replace(/\/(?:images\/generations|chat\/completions)\/?$/, '').replace(/\/$/, '');
  console.log(`请求 ${baseUrl}${endpoint}，模型：${config.model}`);
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.model, ...body }),
    signal: AbortSignal.timeout(300_000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 1500)}`);
  if (response.headers.get('content-type')?.includes('text/html')) {
    throw new Error('接口返回了 HTML 页面，请检查 BASE_URL 是否缺少 /v1 等 API 路径');
  }
  return response.json();
}

const results: Record<string, object> = {};
for (const kind of ['text', 'image']) {
  const started = Date.now();
  try {
    if (kind === 'text') {
      const data = await request(textConfig, '/chat/completions', {
        messages: [{ role: 'user', content: '你好' }],
        temperature: 0.7
      });
      const reply = data.choices?.[0]?.message?.content?.trim();
      if (!reply) throw new Error('接口未返回文本 choices[0].message.content');
      await writeFile(path.join(outputDir, 'hello.txt'), redact(reply), 'utf8');
      console.log(`文本连接成功：${redact(reply)}`);
      results.text = { ok: true, model: textConfig.model, reply: redact(reply), seconds: (Date.now() - started) / 1000 };
    } else {
      const promptPath = path.join(outputDir, 'image-prompt.md');
      const imagePath = path.join(outputDir, 'kitten.png');
      await writeFile(promptPath, '生成一张可爱的小猫照片：一只毛茸茸的小橘猫坐在窗边，柔和的自然光，画面干净，没有文字。', 'utf8');
      await scripts.generateImage({ promptPath, imagePath, aspectRatio: '1:1' });
      const { size } = await stat(imagePath);
      console.log(`生图连接成功：${imagePath}（${size} 字节）`);
      results.image = { ok: true, path: imagePath, bytes: size, seconds: (Date.now() - started) / 1000 };
    }
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : String(error));
    console.error(`${kind === 'text' ? '文本' : '生图'}连接失败：${message}`);
    results[kind] = { ok: false, error: message, seconds: (Date.now() - started) / 1000 };
    process.exitCode = 1;
  }
}
await writeFile(path.join(outputDir, 'results.json'), JSON.stringify(results, null, 2), 'utf8');
console.log(`测试结果：${outputDir}`);
