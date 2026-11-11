import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

export type LoadEnvImpl = (mode: string, envDir: string, prefix: string) => Record<string, string>;

export function loadAgentEnv(
  mode: string,
  appRoot: string,
  loadEnvImpl: LoadEnvImpl
): Record<string, string> {
  const repoRoot = path.normalize(path.join(appRoot, '..'));
  for (const directory of [repoRoot, appRoot]) {
    for (const filename of ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`]) {
      const filePath = path.join(directory, filename);
      if (!existsSync(filePath)) continue;
      const keys = new Set<string>();
      for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
        const key = line.match(/^\s*(?:export\s+)?((?:AGENT_TEXT_|AGENT_IMAGE_|OPENAI_)[A-Z_]+)\s*=/)?.[1];
        if (!key) continue;
        if (keys.has(key)) {
          throw new Error(`${filePath} 中重复配置了 ${key}，后面的值会覆盖前面的值。文本请使用 AGENT_TEXT_*，生图请使用 AGENT_IMAGE_*，每个字段只保留一行。`);
        }
        keys.add(key);
      }
    }
  }
  return {
    ...loadEnvImpl(mode, repoRoot, ''),
    ...loadEnvImpl(mode, appRoot, '')
  };
}
