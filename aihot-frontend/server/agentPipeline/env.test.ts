import path from 'node:path';
import os from 'node:os';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadAgentEnv } from './env';

describe('agent env loader', () => {
  it.each(['.env', '.env.development.local'])('rejects duplicate model settings in %s without exposing values', (filename) => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'agent-env-'));
    try {
      writeFileSync(path.join(directory, filename), 'OPENAI_API_KEY=text-secret\nOPENAI_API_KEY=image-secret\n');
      expect(() => loadAgentEnv('development', directory, () => ({})))
        .toThrow('重复配置了 OPENAI_API_KEY');
      expect(() => loadAgentEnv('development', directory, () => ({})))
        .not.toThrow(/text-secret|image-secret/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('loads repo-root env first and lets aihot-frontend env override it', () => {
    const appRoot = path.join('repo', 'aihot-frontend');
    const calls: Array<{ mode: string; dir: string; prefix: string }> = [];
    const env = loadAgentEnv('development', appRoot, (mode, dir, prefix) => {
      calls.push({ mode, dir, prefix });
      if (dir.endsWith('repo')) {
        return {
          OPENAI_API_KEY: 'root-key',
          AGENT_IMAGE_PROVIDER: 'openai'
        };
      }
      return {
        OPENAI_API_KEY: 'app-key',
        OPENAI_MODEL: 'chat-model'
      };
    });

    expect(env).toEqual({
      OPENAI_API_KEY: 'app-key',
      AGENT_IMAGE_PROVIDER: 'openai',
      OPENAI_MODEL: 'chat-model'
    });
    expect(calls).toEqual([
      { mode: 'development', dir: path.join('repo'), prefix: '' },
      { mode: 'development', dir: appRoot, prefix: '' }
    ]);
  });
});
