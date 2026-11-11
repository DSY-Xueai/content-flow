export type AgentMaterialSourceType = 'aihot' | 'x';

export interface AgentMaterial {
  id: string;
  sourceType: AgentMaterialSourceType;
  title: string;
  summary: string;
  addedAt: string;
}

export type AgentStepId =
  | 'prepare_materials'
  | 'generate_draft'
  | 'review_draft'
  | 'format_markdown'
  | 'generate_cover'
  | 'generate_illustrations'
  | 'render_html'
  | 'publish_wechat_draft'
  | 'completed';

export type AgentJobStatus = 'running' | 'waiting_review' | 'stopped' | 'failed' | 'completed';

export interface AgentJob {
  id: string;
  topic: string;
  sourceMode?: 'topic' | 'materials' | 'markdown';
  status: AgentJobStatus;
  currentStep: AgentStepId;
  failedStep?: AgentStepId;
  createdAt: string;
  updatedAt: string;
  materials: AgentMaterial[];
  paths: {
    workDir: string;
    materialsMarkdown?: string;
    draftMarkdown?: string;
    formattedMarkdown?: string;
    html?: string;
    cover?: string;
    illustrations?: string[];
  };
  error?: string;
  publishResult?: string;
}

export interface AgentLogEntry {
  at: string;
  level: 'info' | 'error';
  step: AgentStepId;
  message: string;
}

export interface AgentHistoryEntry {
  id: string;
  topic: string;
  createdAt: string;
  completedAt: string;
  materialCount: number;
  workDir: string;
  draftMarkdown?: string;
  formattedMarkdown?: string;
  html?: string;
  cover?: string;
  illustrations?: string[];
  publishResult?: string;
}

export type AddAgentMaterialInput =
  | {
      sourceType: 'aihot';
      item: {
        id: string;
        title?: string | null;
        summary?: string | null;
      };
    }
  | {
      sourceType: 'x';
      item: {
        handle: string;
        displayName?: string | null;
        text?: string | null;
        translatedText?: string | null;
        latestPost?: {
          text?: string | null;
          translatedText?: string | null;
        } | null;
      };
    };

export async function fetchAgentMaterials(): Promise<AgentMaterial[]> {
  const data = await requestJson<{ materials?: AgentMaterial[] }>('/api/agent/materials');
  return data.materials ?? [];
}

export async function addAgentMaterial(input: AddAgentMaterialInput): Promise<AgentMaterial[]> {
  const data = await requestJson<{ materials?: AgentMaterial[] }>('/api/agent/materials', {
    method: 'POST',
    body: input
  });
  return data.materials ?? [];
}

export async function deleteAgentMaterial(id: string): Promise<AgentMaterial[]> {
  const data = await requestJson<{ materials?: AgentMaterial[] }>(`/api/agent/materials/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
  return data.materials ?? [];
}

export async function clearAgentMaterials(): Promise<AgentMaterial[]> {
  const data = await requestJson<{ materials?: AgentMaterial[] }>('/api/agent/materials', { method: 'DELETE' });
  return data.materials ?? [];
}

export async function fetchCurrentAgentJob(): Promise<AgentJob | null> {
  const data = await requestJson<{ job?: AgentJob | null }>('/api/agent/current-job');
  return data.job ?? null;
}

export async function startAgentJob(topic: string): Promise<AgentJob> {
  const data = await requestJson<{ job: AgentJob }>('/api/agent/jobs', {
    method: 'POST',
    body: { topic }
  });
  return data.job;
}

export async function startAgentMarkdownJob(fileName: string, markdown: string): Promise<AgentJob> {
  const data = await requestJson<{ job: AgentJob }>('/api/agent/jobs', {
    method: 'POST',
    body: { sourceMode: 'markdown', fileName, markdown }
  });
  return data.job;
}

export async function saveAgentDraft(jobId: string, markdown: string): Promise<AgentJob> {
  const data = await requestJson<{ job: AgentJob }>(`/api/agent/jobs/${jobId}/save-draft`, {
    method: 'POST',
    body: { markdown }
  });
  return data.job;
}

export async function fetchAgentDraft(jobId: string): Promise<string> {
  const data = await requestJson<{ markdown?: string }>(`/api/agent/jobs/${jobId}/draft`);
  return data.markdown ?? '';
}

export async function regenerateAgentDraft(jobId: string, revisionNote: string): Promise<AgentJob> {
  const data = await requestJson<{ job: AgentJob }>(`/api/agent/jobs/${jobId}/regenerate-draft`, {
    method: 'POST',
    body: { revisionNote }
  });
  return data.job;
}

export async function confirmAgentDraft(jobId: string): Promise<AgentJob> {
  const data = await requestJson<{ job: AgentJob }>(`/api/agent/jobs/${jobId}/confirm-draft`, { method: 'POST' });
  return data.job;
}

export async function retryAgentJob(jobId: string): Promise<AgentJob> {
  const data = await requestJson<{ job: AgentJob }>(`/api/agent/jobs/${jobId}/retry`, { method: 'POST' });
  return data.job;
}

export async function restartAgentJob(jobId: string): Promise<AgentJob> {
  const data = await requestJson<{ job: AgentJob }>(`/api/agent/jobs/${jobId}/restart`, { method: 'POST' });
  return data.job;
}

export async function stopAgentJob(jobId: string): Promise<AgentJob> {
  const data = await requestJson<{ job: AgentJob }>(`/api/agent/jobs/${jobId}/stop`, { method: 'POST' });
  return data.job;
}

export async function resumeAgentJob(jobId: string): Promise<AgentJob> {
  const data = await requestJson<{ job: AgentJob }>(`/api/agent/jobs/${jobId}/resume`, { method: 'POST' });
  return data.job;
}

export async function fetchAgentLogs(jobId: string): Promise<AgentLogEntry[]> {
  const data = await requestJson<{ logs?: AgentLogEntry[] }>(`/api/agent/jobs/${jobId}/logs`);
  return data.logs ?? [];
}

export async function fetchAgentHistory(): Promise<AgentHistoryEntry[]> {
  const data = await requestJson<{ history?: AgentHistoryEntry[] }>('/api/agent/history');
  return data.history ?? [];
}

async function requestJson<T>(url: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const init: RequestInit | undefined = options.method
    ? {
        method: options.method,
        headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      }
    : undefined;
  const response = init ? await fetch(url, init) : await fetch(url);
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || `Agent API 请求失败：${response.status}`);
  }
  return data;
}
