export type AgentMaterialSourceType = 'aihot' | 'x';
export type AgentJobSourceMode = 'topic' | 'materials' | 'markdown';

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

export interface AgentJobPaths {
  workDir: string;
  materialsMarkdown?: string;
  draftMarkdown?: string;
  formattedMarkdown?: string;
  html?: string;
  cover?: string;
  illustrations?: string[];
}

export interface AgentJob {
  id: string;
  topic: string;
  sourceMode?: AgentJobSourceMode;
  status: AgentJobStatus;
  currentStep: AgentStepId;
  failedStep?: AgentStepId;
  createdAt: string;
  updatedAt: string;
  materials: AgentMaterial[];
  paths: AgentJobPaths;
  error?: string;
  publishResult?: string;
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

export interface AgentLogEntry {
  at: string;
  level: 'info' | 'error';
  step: AgentStepId;
  message: string;
}
