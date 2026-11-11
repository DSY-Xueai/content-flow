import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createScriptAdapter, spawnCommand, type CommandInvocation } from './scripts';
import { readModelConfig } from './model';

const repoRoot = path.resolve('..');

function createFakeAdapter(stdout = '{}') {
  const calls: CommandInvocation[] = [];
  const adapter = createScriptAdapter({
    repoRoot,
    bunExecutable: 'C:\\tools\\bun.exe',
    pathExists: () => false,
    runCommand: async (command, args, options) => {
      calls.push({ command, args, options });
      return { exitCode: 0, stdout, stderr: '' };
    }
  });

  return { adapter, calls };
}

const bunExecutable = 'C:\\tools\\bun.exe';
const runtimeRoot = path.join(repoRoot, 'pipeline-output', 'agent', '.runtime');

function runtimeEnv(env: Record<string, string | undefined> = {}) {
  return {
    ...env,
    BUN_INSTALL_CACHE_DIR: path.join(runtimeRoot, 'bun-cache'),
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: path.join(runtimeRoot, 'bun-transpiler-cache'),
    npm_config_cache: path.join(runtimeRoot, 'npm-cache'),
    NPM_CONFIG_CACHE: path.join(runtimeRoot, 'npm-cache'),
    TMP: path.join(runtimeRoot, 'tmp'),
    TEMP: path.join(runtimeRoot, 'tmp'),
    TMPDIR: path.join(runtimeRoot, 'tmp')
  };
}

describe('script adapter', () => {
  it('formats markdown with the existing formatter script', async () => {
    const { adapter, calls } = createFakeAdapter();
    const markdownPath = path.join(repoRoot, 'pipeline-output', 'article.md');

    await adapter.formatMarkdown(markdownPath);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      command: bunExecutable,
      args: [
        path.join(repoRoot, 'task_skills', 'baoyu-format-markdown', 'scripts', 'main.ts'),
        markdownPath
      ],
      options: { cwd: repoRoot, env: runtimeEnv() }
    });
  });

  it('generates images from saved prompt files through baoyu-imagine', async () => {
    const { adapter, calls } = createFakeAdapter();
    const promptPath = path.join(repoRoot, 'pipeline-output', 'cover-prompt.md');
    const imagePath = path.join(repoRoot, 'pipeline-output', 'cover.png');

    await adapter.generateImage({ promptPath, imagePath, aspectRatio: '3:4' });

    expect(calls[0]).toEqual({
      command: bunExecutable,
      args: [
        path.join(repoRoot, 'task_skills', 'baoyu-imagine', 'scripts', 'main.ts'),
        '--promptfiles',
        promptPath,
        '--image',
        imagePath,
        '--ar',
        '3:4'
      ],
      options: { cwd: repoRoot, env: runtimeEnv() }
    });
  });

  it('passes Agent image provider and model overrides to baoyu-imagine', async () => {
    const calls: CommandInvocation[] = [];
    const adapter = createScriptAdapter({
      repoRoot,
      bunExecutable,
      pathExists: () => false,
      env: {
        AGENT_IMAGE_PROVIDER: 'jimeng',
        AGENT_IMAGE_MODEL: 'jimeng_t2i_v40'
      },
      runCommand: async (command, args, options) => {
        calls.push({ command, args, options });
        return { exitCode: 0, stdout: '{}', stderr: '' };
      }
    });
    const promptPath = path.join(repoRoot, 'pipeline-output', 'cover-prompt.md');
    const imagePath = path.join(repoRoot, 'pipeline-output', 'cover.png');

    await adapter.generateImage({ promptPath, imagePath, aspectRatio: '3:4' });

    expect(calls[0]).toEqual({
      command: bunExecutable,
      args: [
        path.join(repoRoot, 'task_skills', 'baoyu-imagine', 'scripts', 'main.ts'),
        '--promptfiles',
        promptPath,
        '--image',
        imagePath,
        '--ar',
        '3:4',
        '--provider',
        'jimeng',
        '--model',
        'jimeng_t2i_v40'
      ],
      options: {
        cwd: repoRoot,
        env: runtimeEnv({
          AGENT_IMAGE_PROVIDER: 'jimeng',
          AGENT_IMAGE_MODEL: 'jimeng_t2i_v40'
        })
      }
    });
  });

  it('prefers Jimeng for Agent images when Jimeng credentials are loaded', async () => {
    const calls: CommandInvocation[] = [];
    const adapter = createScriptAdapter({
      repoRoot,
      bunExecutable,
      pathExists: () => false,
      env: {
        OPENAI_API_KEY: 'text-model-key',
        JIMENG_ACCESS_KEY_ID: 'jimeng-ak',
        JIMENG_SECRET_ACCESS_KEY: 'jimeng-sk'
      },
      runCommand: async (command, args, options) => {
        calls.push({ command, args, options });
        return { exitCode: 0, stdout: '{}', stderr: '' };
      }
    });
    const promptPath = path.join(repoRoot, 'pipeline-output', 'cover-prompt.md');
    const imagePath = path.join(repoRoot, 'pipeline-output', 'cover.png');

    await adapter.generateImage({ promptPath, imagePath, aspectRatio: '3:4' });

    expect(calls[0].args).toContain('--provider');
    expect(calls[0].args).toContain('jimeng');
    expect(calls[0].args).not.toContain('--model');
  });

  it('uses image OpenAI env as primary and falls back to Jimeng when primary image generation fails', async () => {
    const calls: CommandInvocation[] = [];
    const adapter = createScriptAdapter({
      repoRoot,
      bunExecutable,
      pathExists: () => false,
      env: {
        OPENAI_API_KEY: 'image-key',
        OPENAI_BASE_URL: 'https://api.example.com/v1/images/generations',
        OPENAI_MODEL: 'gpt-image-2:stable',
        JIMENG_ACCESS_KEY_ID: 'jimeng-ak',
        JIMENG_SECRET_ACCESS_KEY: 'jimeng-sk'
      },
      runCommand: async (command, args, options) => {
        calls.push({ command, args, options });
        return calls.length === 1
          ? { exitCode: 1, stdout: '', stderr: 'primary failed' }
          : { exitCode: 0, stdout: '{}', stderr: '' };
      }
    });
    const promptPath = path.join(repoRoot, 'pipeline-output', 'cover-prompt.md');
    const imagePath = path.join(repoRoot, 'pipeline-output', 'cover.png');

    await adapter.generateImage({ promptPath, imagePath, aspectRatio: '3:4' });

    expect(calls).toHaveLength(2);
    expect(calls[0].args).toContain('--provider');
    expect(calls[0].args).toContain('openai');
    expect(calls[0].args).toContain('--model');
    expect(calls[0].args).toContain('gpt-image-2:stable');
    expect(calls[0].options.env?.OPENAI_BASE_URL).toBe('https://api.example.com/v1');
    expect(calls[1].args).toContain('--provider');
    expect(calls[1].args).toContain('jimeng');
    expect(calls[1].args).not.toContain('gpt-image-2:stable');
  });

  it.each([
    {
      name: 'OpenAI-compatible image service',
      baseUrl: 'https://images.example.com/v1/images/generations',
      model: 'gpt-image-2',
      provider: 'openai',
      expectedEnv: { OPENAI_API_KEY: 'image-key', OPENAI_BASE_URL: 'https://images.example.com/v1' }
    },
    {
      name: 'Ark Seedream image service',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/',
      model: 'doubao-seedream-5-0-pro-260628',
      provider: 'seedream',
      expectedEnv: { ARK_API_KEY: 'image-key', SEEDREAM_BASE_URL: 'https://ark.cn-beijing.volces.com/api/v3' }
    },
    {
      name: 'Seedream model hosted by a compatible third party',
      baseUrl: 'https://images.example.com/v1',
      model: 'doubao-seedream-5-0-pro-260628',
      provider: 'openai',
      expectedEnv: { OPENAI_API_KEY: 'image-key', OPENAI_BASE_URL: 'https://images.example.com/v1' }
    }
  ])('keeps text credentials isolated when using $name', async ({ baseUrl, model, provider, expectedEnv }) => {
    const calls: CommandInvocation[] = [];
    const env = {
      AGENT_TEXT_API_KEY: 'text-key',
      AGENT_TEXT_BASE_URL: 'https://text.example.com/v1',
      AGENT_TEXT_MODEL: 'text-model',
      AGENT_IMAGE_API_KEY: 'image-key',
      AGENT_IMAGE_BASE_URL: baseUrl,
      AGENT_IMAGE_MODEL: model,
      OPENAI_API_KEY: 'legacy-key',
      OPENAI_BASE_URL: 'https://legacy.example.com/v1/images/generations',
      OPENAI_MODEL: 'legacy-image-model'
    };
    const original = { ...env };
    const adapter = createScriptAdapter({
      repoRoot,
      bunExecutable,
      pathExists: () => false,
      env,
      runCommand: async (command, args, options) => {
        calls.push({ command, args, options });
        return { exitCode: 0, stdout: '{}', stderr: '' };
      }
    });

    await adapter.generateImage({ promptPath: 'prompt.md', imagePath: 'cover.png', aspectRatio: '3:4' });

    expect(calls[0].args.slice(-4)).toEqual(['--provider', provider, '--model', model]);
    expect(calls[0].options.env).toMatchObject(expectedEnv);
    expect(readModelConfig(env)).toMatchObject({
      apiKey: 'text-key', baseUrl: 'https://text.example.com/v1', model: 'text-model'
    });
    expect(env).toEqual(original);
  });

  it.each([
    { OPENAI_API_KEY: 'old-key', OPENAI_BASE_URL: 'https://images.example.com/v1', AGENT_IMAGE_MODEL: 'gpt-image-2' },
    { AGENT_IMAGE_API_KEY: ' ', AGENT_IMAGE_BASE_URL: '', OPENAI_API_KEY: 'old-key', OPENAI_IMAGE_MODEL: 'gpt-image-2' }
  ])('keeps legacy image credentials working with a model or empty new fields', async (env) => {
    const calls: CommandInvocation[] = [];
    const adapter = createScriptAdapter({
      repoRoot, bunExecutable, pathExists: () => false, env,
      runCommand: async (command, args, options) => {
        calls.push({ command, args, options });
        return { exitCode: 0, stdout: '{}', stderr: '' };
      }
    });

    await adapter.generateImage({ promptPath: 'prompt.md', imagePath: 'cover.png', aspectRatio: '3:4' });

    expect(calls[0].args.slice(-4)).toEqual(['--provider', 'openai', '--model', 'gpt-image-2']);
    expect(calls[0].options.env?.OPENAI_API_KEY).toBe('old-key');
  });

  it('uses the default Ark endpoint when only a neutral key and Seedream model are configured', async () => {
    const calls: CommandInvocation[] = [];
    const adapter = createScriptAdapter({
      repoRoot, bunExecutable, pathExists: () => false,
      env: { AGENT_IMAGE_API_KEY: 'ark-key', AGENT_IMAGE_MODEL: 'doubao-seedream-5-0-pro-260628' },
      runCommand: async (command, args, options) => {
        calls.push({ command, args, options });
        return { exitCode: 0, stdout: '{}', stderr: '' };
      }
    });

    await adapter.generateImage({ promptPath: 'prompt.md', imagePath: 'cover.png', aspectRatio: '3:4' });

    expect(calls[0].args).toContain('seedream');
    expect(calls[0].options.env?.ARK_API_KEY).toBe('ark-key');
  });

  it('reports the image service error without falling back to unconfigured Jimeng credentials', async () => {
    let attempts = 0;
    const adapter = createScriptAdapter({
      repoRoot, bunExecutable, pathExists: () => false,
      env: { AGENT_IMAGE_API_KEY: 'image-key', AGENT_IMAGE_PROVIDER: 'openai' },
      runCommand: async () => {
        attempts += 1;
        return { exitCode: 1, stdout: '', stderr: 'Image service: invalid API key' };
      }
    });

    await expect(adapter.generateImage({ promptPath: 'prompt.md', imagePath: 'cover.png', aspectRatio: '3:4' }))
      .rejects.toThrow('Image service: invalid API key');
    expect(attempts).toBe(1);
  });

  it('renders markdown to html and returns the generated html path', async () => {
    const htmlPath = path.join(repoRoot, 'pipeline-output', 'article.html');
    const { adapter, calls } = createFakeAdapter(JSON.stringify({ htmlPath }));
    const markdownPath = path.join(repoRoot, 'pipeline-output', 'article.md');

    await expect(adapter.renderHtml(markdownPath)).resolves.toBe(htmlPath);

    expect(calls[0]).toEqual({
      command: bunExecutable,
      args: [
        path.join(repoRoot, 'task_skills', 'baoyu-markdown-to-html', 'scripts', 'main.ts'),
        markdownPath,
        '--theme',
        'grace',
        '--color',
        'blue'
      ],
      options: { cwd: repoRoot, env: runtimeEnv() }
    });
  });

  it('publishes the markdown draft with cover and without source citations', async () => {
    const result = { success: true, media_id: 'draft-media-id' };
    const { adapter, calls } = createFakeAdapter(JSON.stringify(result));
    const markdownPath = path.join(repoRoot, 'pipeline-output', 'article.md');
    const coverPath = path.join(repoRoot, 'pipeline-output', 'cover.png');

    await expect(adapter.publishWechatDraft({ markdownPath, coverPath })).resolves.toEqual(result);

    expect(calls[0]).toEqual({
      command: bunExecutable,
      args: [
        path.join(repoRoot, 'task_skills', 'baoyu-post-to-wechat', 'scripts', 'wechat-api.ts'),
        markdownPath,
        '--theme',
        'grace',
        '--color',
        'blue',
        '--cover',
        coverPath,
        '--no-cite'
      ],
      options: { cwd: repoRoot, env: runtimeEnv() }
    });
  });

  it('throws command output when a script fails', async () => {
    const adapter = createScriptAdapter({
      repoRoot,
      bunExecutable,
      pathExists: () => false,
      runCommand: async () => ({ exitCode: 1, stdout: 'stdout details', stderr: 'stderr details' })
    });

    await expect(adapter.formatMarkdown('article.md')).rejects.toThrow('stderr details');
  });

  it('passes loaded environment variables to child scripts', async () => {
    const calls: CommandInvocation[] = [];
    const adapter = createScriptAdapter({
      repoRoot,
      bunExecutable,
      pathExists: () => false,
      env: { OPENAI_API_KEY: 'from-dotenv' },
      runCommand: async (command, args, options) => {
        calls.push({ command, args, options });
        return { exitCode: 0, stdout: '{}', stderr: '' };
      }
    });

    await adapter.formatMarkdown('article.md');

    expect(calls[0].options.env).toMatchObject({ OPENAI_API_KEY: 'from-dotenv' });
  });

  it('installs missing script dependencies once with the selected Bun executable', async () => {
    const calls: CommandInvocation[] = [];
    const writtenMarkers: string[] = [];
    const scriptDirectory = path.join(repoRoot, 'task_skills', 'baoyu-format-markdown', 'scripts');
    const adapter = createScriptAdapter({
      repoRoot,
      bunExecutable,
      pathExists: (target) => target === path.join(scriptDirectory, 'package.json'),
      writeInstallMarker: (target) => writtenMarkers.push(target),
      runCommand: async (command, args, options) => {
        calls.push({ command, args, options });
        return { exitCode: 0, stdout: '{}', stderr: '' };
      }
    });

    await adapter.formatMarkdown('first.md');
    await adapter.formatMarkdown('second.md');

    expect(calls).toEqual([
      { command: bunExecutable, args: ['install', '--frozen-lockfile'], options: { cwd: scriptDirectory, env: runtimeEnv() } },
      expect.objectContaining({ command: bunExecutable }),
      expect.objectContaining({ command: bunExecutable })
    ]);
    expect(writtenMarkers).toEqual([path.join(scriptDirectory, 'node_modules', '.agent-install-complete')]);
  });

  it('repairs an incomplete existing installation with force and writes a completion marker', async () => {
    const calls: CommandInvocation[] = [];
    const writtenMarkers: string[] = [];
    const scriptDirectory = path.join(repoRoot, 'task_skills', 'baoyu-format-markdown', 'scripts');
    const adapter = createScriptAdapter({
      repoRoot,
      bunExecutable,
      pathExists: (target) =>
        target === path.join(scriptDirectory, 'package.json') || target === path.join(scriptDirectory, 'node_modules'),
      writeInstallMarker: (target) => writtenMarkers.push(target),
      runCommand: async (command, args, options) => {
        calls.push({ command, args, options });
        return { exitCode: 0, stdout: '{}', stderr: '' };
      }
    });

    await adapter.formatMarkdown('article.md');

    expect(calls[0]).toEqual({
      command: bunExecutable,
      args: ['install', '--frozen-lockfile', '--force'],
      options: { cwd: scriptDirectory, env: runtimeEnv() }
    });
    expect(writtenMarkers).toEqual([path.join(scriptDirectory, 'node_modules', '.agent-install-complete')]);
  });

  it('skips installation in a new adapter when the completion marker exists', async () => {
    const calls: CommandInvocation[] = [];
    const scriptDirectory = path.join(repoRoot, 'task_skills', 'baoyu-format-markdown', 'scripts');
    const markerPath = path.join(scriptDirectory, 'node_modules', '.agent-install-complete');
    const adapter = createScriptAdapter({
      repoRoot,
      bunExecutable,
      pathExists: (target) => target === path.join(scriptDirectory, 'package.json') || target === markerPath,
      writeInstallMarker: () => {
        throw new Error('marker should not be rewritten');
      },
      runCommand: async (command, args, options) => {
        calls.push({ command, args, options });
        return { exitCode: 0, stdout: '{}', stderr: '' };
      }
    });

    await adapter.formatMarkdown('article.md');

    expect(calls).toHaveLength(1);
    expect(calls[0].args[0]).not.toBe('install');
  });

  it('shares a pending dependency installation across concurrent first calls', async () => {
    const scriptDirectory = path.join(repoRoot, 'task_skills', 'baoyu-format-markdown', 'scripts');
    let releaseInstall!: () => void;
    const installPending = new Promise<void>((resolve) => {
      releaseInstall = resolve;
    });
    let installCount = 0;
    const adapter = createScriptAdapter({
      repoRoot,
      bunExecutable,
      pathExists: (target) => target === path.join(scriptDirectory, 'package.json'),
      writeInstallMarker: () => {},
      runCommand: async (_command, args) => {
        if (args[0] === 'install') {
          installCount += 1;
          await installPending;
        }
        return { exitCode: 0, stdout: '{}', stderr: '' };
      }
    });

    const first = adapter.formatMarkdown('first.md');
    const second = adapter.formatMarkdown('second.md');
    await Promise.resolve();

    expect(installCount).toBe(1);
    releaseInstall();
    await Promise.all([first, second]);
  });

  it('retries installation after a failed attempt leaves node_modules behind', async () => {
    const scriptDirectory = path.join(repoRoot, 'task_skills', 'baoyu-format-markdown', 'scripts');
    let nodeModulesExists = false;
    const installArgs: string[][] = [];
    const writtenMarkers: string[] = [];
    const adapter = createScriptAdapter({
      repoRoot,
      bunExecutable,
      pathExists: (target) =>
        target === path.join(scriptDirectory, 'package.json') ||
        (target === path.join(scriptDirectory, 'node_modules') && nodeModulesExists),
      writeInstallMarker: (target) => writtenMarkers.push(target),
      runCommand: async (_command, args) => {
        if (args[0] === 'install') {
          installArgs.push(args);
          nodeModulesExists = true;
          if (installArgs.length === 1) {
            return { exitCode: 1, stdout: '', stderr: 'install failed' };
          }
        }
        return { exitCode: 0, stdout: '{}', stderr: '' };
      }
    });

    await expect(adapter.formatMarkdown('first.md')).rejects.toThrow('install failed');
    expect(writtenMarkers).toEqual([]);
    await adapter.formatMarkdown('second.md');

    expect(installArgs).toEqual([
      ['install', '--frozen-lockfile'],
      ['install', '--frozen-lockfile', '--force']
    ]);
    expect(writtenMarkers).toEqual([path.join(scriptDirectory, 'node_modules', '.agent-install-complete')]);
  });

  it('does not mark an aborted installation complete and retries it with force', async () => {
    const scriptDirectory = path.join(repoRoot, 'task_skills', 'baoyu-format-markdown', 'scripts');
    const controller = new AbortController();
    const installArgs: string[][] = [];
    const writtenMarkers: string[] = [];
    const adapter = createScriptAdapter({
      repoRoot,
      bunExecutable,
      pathExists: (target) =>
        target === path.join(scriptDirectory, 'package.json') || target === path.join(scriptDirectory, 'node_modules'),
      writeInstallMarker: (target) => writtenMarkers.push(target),
      runCommand: async (_command, args) => {
        if (args[0] === 'install') {
          installArgs.push(args);
          if (installArgs.length === 1) {
            controller.abort();
          }
        }
        return { exitCode: 0, stdout: '{}', stderr: '' };
      }
    });

    await expect(adapter.formatMarkdown('first.md', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(writtenMarkers).toEqual([]);

    await adapter.formatMarkdown('second.md');

    expect(installArgs).toEqual([
      ['install', '--frozen-lockfile', '--force'],
      ['install', '--frozen-lockfile', '--force']
    ]);
    expect(writtenMarkers).toEqual([path.join(scriptDirectory, 'node_modules', '.agent-install-complete')]);
  });

  it('waits for process termination to finish before rejecting an aborted command', async () => {
    const controller = new AbortController();
    let releaseTermination!: () => void;
    const terminationPending = new Promise<void>((resolve) => {
      releaseTermination = resolve;
    });
    let terminationStarted = false;
    const command = spawnCommand(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      { cwd: repoRoot, signal: controller.signal },
      async (child) => {
        terminationStarted = true;
        await terminationPending;
        await new Promise<void>((resolve) => {
          child.once('close', () => resolve());
          child.kill();
        });
      }
    );
    let rejected = false;
    void command.catch(() => {
      rejected = true;
    });

    controller.abort();
    await Promise.resolve();

    const terminationStartedBeforeRelease = terminationStarted;
    const rejectedBeforeRelease = rejected;
    releaseTermination();
    await expect(command).rejects.toMatchObject({ name: 'AbortError' });
    expect(terminationStartedBeforeRelease).toBe(true);
    expect(rejectedBeforeRelease).toBe(false);
  });

  it('passes an AbortSignal to direct Bun commands', async () => {
    const { adapter, calls } = createFakeAdapter();
    const controller = new AbortController();

    await adapter.formatMarkdown('article.md', controller.signal);

    expect(calls[0].options.signal).toBe(controller.signal);
  });

  it('does not fall back to Jimeng when image generation is aborted', async () => {
    const calls: CommandInvocation[] = [];
    const controller = new AbortController();
    const adapter = createScriptAdapter({
      repoRoot,
      bunExecutable,
      pathExists: () => false,
      env: {
        OPENAI_API_KEY: 'image-key',
        OPENAI_BASE_URL: 'https://api.example.com/v1/images/generations',
        JIMENG_ACCESS_KEY_ID: 'jimeng-ak',
        JIMENG_SECRET_ACCESS_KEY: 'jimeng-sk'
      },
      runCommand: async (command, args, options) => {
        calls.push({ command, args, options });
        controller.abort();
        throw new Error('command cancelled');
      }
    });

    await expect(
      adapter.generateImage({ promptPath: 'prompt.md', imagePath: 'image.png', aspectRatio: '3:4' }, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toHaveLength(1);
  });
});
