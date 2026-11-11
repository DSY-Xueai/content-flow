import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface CommandOptions {
  cwd: string;
  env?: Record<string, string | undefined>;
  signal?: AbortSignal;
}

export interface CommandInvocation {
  command: string;
  args: string[];
  options: CommandOptions;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (command: string, args: string[], options: CommandOptions) => Promise<CommandResult>;

interface ScriptAdapterOptions {
  repoRoot?: string;
  runCommand?: CommandRunner;
  env?: Record<string, string | undefined>;
  bunExecutable?: string;
  pathExists?: (target: string) => boolean;
  writeInstallMarker?: (target: string) => void;
}

interface GenerateImageInput {
  promptPath: string;
  imagePath: string;
  aspectRatio: string;
}

interface PublishWechatDraftInput {
  markdownPath: string;
  coverPath: string;
}

export interface ScriptAdapter {
  formatMarkdown(markdownPath: string, signal?: AbortSignal): Promise<void>;
  generateImage(input: GenerateImageInput, signal?: AbortSignal): Promise<void>;
  renderHtml(markdownPath: string, signal?: AbortSignal): Promise<string>;
  publishWechatDraft(input: PublishWechatDraftInput, signal?: AbortSignal): Promise<unknown>;
}

export function createScriptAdapter(options: ScriptAdapterOptions = {}): ScriptAdapter {
  const repoRoot = options.repoRoot ?? resolveRepoRoot();
  const runCommand = options.runCommand ?? spawnCommand;
  const pathExists = options.pathExists ?? existsSync;
  const writeInstallMarker = options.writeInstallMarker ?? ((target: string) => writeFileSync(target, ''));
  const bunExecutable = options.bunExecutable ?? resolveBunExecutable(pathExists);
  const env = createRuntimeEnv(repoRoot, normalizeScriptEnv(options.env));
  const preparedDirectories = new Set<string>();
  const pendingPreparations = new Map<string, Promise<void>>();

  function commandOptions(cwd: string, signal?: AbortSignal): CommandOptions {
    return signal ? { cwd, env, signal } : { cwd, env };
  }

  async function prepareScriptDirectory(directory: string, signal?: AbortSignal): Promise<void> {
    const markerPath = path.join(directory, 'node_modules', '.agent-install-complete');
    if (preparedDirectories.has(directory) || pathExists(markerPath) || !pathExists(path.join(directory, 'package.json'))) {
      return;
    }
    const pending = pendingPreparations.get(directory);
    if (pending) {
      await pending;
      return;
    }

    const preparation = (async () => {
      throwIfAborted(signal);
      const installArgs = ['install', '--frozen-lockfile'];
      if (pathExists(path.join(directory, 'node_modules'))) {
        installArgs.push('--force');
      }
      const result = await runCommand(bunExecutable, installArgs, commandOptions(directory, signal));
      throwIfAborted(signal);
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || result.stdout.trim() || `Script failed: ${bunExecutable} ${installArgs.join(' ')}`);
      }
      writeInstallMarker(markerPath);
      preparedDirectories.add(directory);
    })();
    pendingPreparations.set(directory, preparation);
    try {
      await preparation;
    } finally {
      pendingPreparations.delete(directory);
    }
  }

  async function run(args: string[], directory: string, signal?: AbortSignal): Promise<CommandResult> {
    throwIfAborted(signal);
    await prepareScriptDirectory(directory, signal);
    const result = await runCommand(bunExecutable, args, commandOptions(repoRoot, signal));
    throwIfAborted(signal);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || `Script failed: ${bunExecutable} ${args.join(' ')}`);
    }
    return result;
  }

  return {
    async formatMarkdown(markdownPath, signal) {
      const script = scriptPath(repoRoot, 'baoyu-format-markdown', 'main.ts');
      await run([script, markdownPath], path.dirname(script), signal);
    },

    async generateImage(input, signal) {
      const script = scriptPath(repoRoot, 'baoyu-imagine', 'main.ts');
      const baseArgs = [script, '--promptfiles', input.promptPath, '--image', input.imagePath, '--ar', input.aspectRatio];
      const attempts = buildAgentImageArgAttempts(env);

      for (let index = 0; index < attempts.length; index += 1) {
        try {
          await run([...baseArgs, ...attempts[index]], path.dirname(script), signal);
          return;
        } catch (error) {
          if (signal?.aborted || isAbortError(error)) {
            throw createAbortError(error);
          }
          if (index === attempts.length - 1) {
            throw error;
          }
        }
      }
    },

    async renderHtml(markdownPath, signal) {
      const script = scriptPath(repoRoot, 'baoyu-markdown-to-html', 'main.ts');
      const result = await run([script, markdownPath, '--theme', 'grace', '--color', 'blue'], path.dirname(script), signal);
      const data = parseJsonOutput<{ htmlPath?: unknown }>(result.stdout);
      if (typeof data.htmlPath !== 'string' || !data.htmlPath) {
        throw new Error('markdown-to-html did not return htmlPath');
      }
      return data.htmlPath;
    },

    async publishWechatDraft(input, signal) {
      const script = scriptPath(repoRoot, 'baoyu-post-to-wechat', 'wechat-api.ts');
      const result = await run(
        [script, input.markdownPath, '--theme', 'grace', '--color', 'blue', '--cover', input.coverPath, '--no-cite'],
        path.dirname(script),
        signal
      );
      return parseJsonOutput<unknown>(result.stdout);
    }
  };
}

function createRuntimeEnv(repoRoot: string, env: Record<string, string | undefined> | undefined): Record<string, string | undefined> {
  const runtimeRoot = path.join(repoRoot, 'pipeline-output', 'agent', '.runtime');
  const npmCache = path.join(runtimeRoot, 'npm-cache');
  const temp = path.join(runtimeRoot, 'tmp');
  return {
    ...env,
    BUN_INSTALL_CACHE_DIR: path.join(runtimeRoot, 'bun-cache'),
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: path.join(runtimeRoot, 'bun-transpiler-cache'),
    npm_config_cache: npmCache,
    NPM_CONFIG_CACHE: npmCache,
    TMP: temp,
    TEMP: temp,
    TMPDIR: temp
  };
}

function resolveBunExecutable(pathExists: (target: string) => boolean): string {
  const executable = process.platform === 'win32' ? 'bun.exe' : 'bun';
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!directory) {
      continue;
    }
    for (const candidate of [path.join(directory, executable), path.join(directory, 'node_modules', 'bun', 'bin', executable)]) {
      if (pathExists(candidate)) {
        return candidate;
      }
    }
  }
  return executable;
}

function scriptPath(repoRoot: string, skill: string, entrypoint: string): string {
  return path.join(repoRoot, 'task_skills', skill, 'scripts', entrypoint);
}

function buildAgentImageArgs(env?: Record<string, string | undefined>): string[] {
  const provider = readEnvValue(env, 'AGENT_IMAGE_PROVIDER') || inferAgentImageProvider(env);
  const model = readAgentImageModel(env, provider);
  const args: string[] = [];

  if (provider) {
    args.push('--provider', provider);
  }
  if (model) {
    args.push('--model', model);
  }

  return args;
}

function inferAgentImageProvider(env?: Record<string, string | undefined>): string {
  const baseUrl = readEnvValue(env, 'AGENT_IMAGE_BASE_URL');
  const model = readEnvValue(env, 'AGENT_IMAGE_MODEL');
  if (/^https:\/\/ark\.[^/]*volces\.com(?:\/|$)/i.test(baseUrl) || (!baseUrl && /^doubao-seedream-/i.test(model))) {
    return 'seedream';
  }
  if (readEnvValue(env, 'AGENT_IMAGE_API_KEY') || baseUrl) {
    return 'openai';
  }
  if (hasOpenAiImageConfig(env)) {
    return 'openai';
  }
  if (readEnvValue(env, 'ARK_API_KEY')) {
    return 'seedream';
  }
  return readEnvValue(env, 'JIMENG_ACCESS_KEY_ID') && readEnvValue(env, 'JIMENG_SECRET_ACCESS_KEY') ? 'jimeng' : '';
}

function buildAgentImageArgAttempts(env?: Record<string, string | undefined>): string[][] {
  const primary = buildAgentImageArgs(env);
  const attempts = [primary];
  const primaryProvider = readProviderFromArgs(primary);

  if (primaryProvider && primaryProvider !== 'jimeng' && readEnvValue(env, 'JIMENG_ACCESS_KEY_ID') && readEnvValue(env, 'JIMENG_SECRET_ACCESS_KEY')) {
    attempts.push(buildProviderArgs('jimeng', readEnvValue(env, 'JIMENG_IMAGE_MODEL')));
  }

  return uniqueArgAttempts(attempts);
}

function buildProviderArgs(provider: string, model: string): string[] {
  const args = ['--provider', provider];
  if (model) {
    args.push('--model', model);
  }
  return args;
}

function readAgentImageModel(env: Record<string, string | undefined> | undefined, provider: string): string {
  const explicitModel = readEnvValue(env, 'AGENT_IMAGE_MODEL');
  if (explicitModel) {
    return explicitModel;
  }
  if (provider === 'openai') {
    return (
      readEnvValue(env, 'OPENAI_IMAGE_MODEL') ||
      (isImageGenerationEndpoint(readEnvValue(env, 'OPENAI_BASE_URL')) ? readEnvValue(env, 'OPENAI_MODEL') : '')
    );
  }
  if (provider === 'jimeng') {
    return readEnvValue(env, 'JIMENG_IMAGE_MODEL');
  }
  if (provider === 'seedream') {
    return readEnvValue(env, 'SEEDREAM_IMAGE_MODEL');
  }
  return '';
}

function readProviderFromArgs(args: string[]): string {
  const index = args.indexOf('--provider');
  return index >= 0 ? args[index + 1] ?? '' : '';
}

function uniqueArgAttempts(attempts: string[][]): string[][] {
  const seen = new Set<string>();
  return attempts.filter((args) => {
    const key = JSON.stringify(args);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function hasOpenAiImageConfig(env?: Record<string, string | undefined>): boolean {
  return Boolean(
    readEnvValue(env, 'OPENAI_API_KEY') &&
      (readEnvValue(env, 'AGENT_IMAGE_MODEL') || readEnvValue(env, 'OPENAI_IMAGE_MODEL') || isImageGenerationEndpoint(readEnvValue(env, 'OPENAI_BASE_URL')))
  );
}

function readEnvValue(env: Record<string, string | undefined> | undefined, key: string): string {
  return env?.[key]?.trim() ?? '';
}

function normalizeScriptEnv(env: Record<string, string | undefined> | undefined): Record<string, string | undefined> | undefined {
  if (!env) {
    return undefined;
  }
  const normalized = { ...env };
  const provider = readEnvValue(env, 'AGENT_IMAGE_PROVIDER') || inferAgentImageProvider(env);
  const imageKey = readEnvValue(env, 'AGENT_IMAGE_API_KEY');
  const imageBaseUrl = readEnvValue(env, 'AGENT_IMAGE_BASE_URL').replace(/\/images\/generations\/?$/i, '').replace(/\/$/, '');
  if (provider === 'seedream') {
    normalized.AGENT_IMAGE_PROVIDER = provider;
    if (imageKey) normalized.ARK_API_KEY = imageKey;
    if (imageBaseUrl) normalized.SEEDREAM_BASE_URL = imageBaseUrl;
  } else if (provider === 'openai') {
    normalized.AGENT_IMAGE_PROVIDER = provider;
    if (imageKey) normalized.OPENAI_API_KEY = imageKey;
    if (imageBaseUrl) normalized.OPENAI_BASE_URL = imageBaseUrl;
  }
  const baseUrl = readEnvValue(normalized, 'OPENAI_BASE_URL');
  if (provider === 'openai' && isImageGenerationEndpoint(baseUrl)) {
    normalized.OPENAI_BASE_URL = baseUrl.replace(/\/images\/generations\/?$/i, '');
    normalized.AGENT_IMAGE_PROVIDER = readEnvValue(normalized, 'AGENT_IMAGE_PROVIDER') || 'openai';
    normalized.AGENT_IMAGE_MODEL =
      readEnvValue(normalized, 'AGENT_IMAGE_MODEL') ||
      readEnvValue(normalized, 'OPENAI_IMAGE_MODEL') ||
      readEnvValue(normalized, 'OPENAI_MODEL');
  }
  return normalized;
}

function isImageGenerationEndpoint(value: string): boolean {
  return /\/images\/generations\/?$/i.test(value.trim());
}

function resolveRepoRoot(): string {
  return path.basename(process.cwd()) === 'aihot-frontend' ? path.resolve(process.cwd(), '..') : process.cwd();
}

function parseJsonOutput<T>(stdout: string): T {
  try {
    return JSON.parse(stdout.trim()) as T;
  } catch {
    throw new Error(`Script output is not JSON: ${stdout.trim()}`);
  }
}

type ProcessTerminator = (child: ChildProcess) => Promise<void>;

export function spawnCommand(
  command: string,
  args: string[],
  options: CommandOptions,
  terminate: ProcessTerminator = terminateProcess
): Promise<CommandResult> {
  ensureRuntimeDirectories(options.env);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env ? { ...process.env, ...options.env } : process.env, shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let aborting = false;
    const onAbort = () => {
      if (settled || aborting) {
        return;
      }
      aborting = true;
      options.signal?.removeEventListener('abort', onAbort);
      void terminateWithFallback(child, terminate).then(() => {
        if (!settled) {
          settled = true;
          reject(createAbortError());
        }
      });
    };
    const settle = (result: CommandResult) => {
      if (!settled) {
        settled = true;
        options.signal?.removeEventListener('abort', onAbort);
        resolve(result);
      }
    };

    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => aborting || options.signal?.aborted ? onAbort() : settle({ exitCode: 1, stdout, stderr: stderr || error.message }));
    child.on('close', (code) => aborting || options.signal?.aborted ? onAbort() : settle({ exitCode: code ?? 1, stdout, stderr }));
  });
}

function ensureRuntimeDirectories(env: Record<string, string | undefined> | undefined): void {
  for (const directory of [env?.BUN_INSTALL_CACHE_DIR, env?.BUN_RUNTIME_TRANSPILER_CACHE_PATH, env?.npm_config_cache, env?.TMP]) {
    if (directory) mkdirSync(directory, { recursive: true });
  }
}

async function terminateProcess(child: ChildProcess): Promise<void> {
  if (process.platform === 'win32' && child.pid) {
    const terminated = await runTaskkill(child.pid);
    if (!terminated && isChildRunning(child)) {
      child.kill();
    }
  } else {
    child.kill('SIGTERM');
  }
  await waitForChildClose(child);
}

async function terminateWithFallback(child: ChildProcess, terminate: ProcessTerminator): Promise<void> {
  try {
    await terminate(child);
  } catch {
    if (isChildRunning(child)) {
      child.kill();
    }
    await waitForChildClose(child);
  }
}

function runTaskkill(pid: number): Promise<boolean> {
  return new Promise((resolve) => {
    const taskkill = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { shell: false, windowsHide: true });
    let settled = false;
    const finish = (success: boolean) => {
      if (!settled) {
        settled = true;
        resolve(success);
      }
    };
    taskkill.on('error', () => finish(false));
    taskkill.on('close', (code) => finish(code === 0));
  });
}

function waitForChildClose(child: ChildProcess): Promise<void> {
  if (!isChildRunning(child)) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    child.once('close', () => resolve());
  });
}

function isChildRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createAbortError();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function createAbortError(cause?: unknown): Error {
  const error = new Error(cause instanceof Error && cause.message ? cause.message : 'Command aborted');
  error.name = 'AbortError';
  return error;
}
