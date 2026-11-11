import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentHistoryEntry, AgentJob, AgentLogEntry, AgentMaterial } from './types';

export interface AgentStore {
  baseDir: string;
  jobsDir: string;
  readMaterials(): Promise<AgentMaterial[]>;
  writeMaterials(materials: AgentMaterial[]): Promise<void>;
  readCurrentJob(): Promise<AgentJob | null>;
  writeCurrentJob(job: AgentJob): Promise<void>;
  clearCurrentJob(): Promise<void>;
  appendLog(jobId: string, entry: AgentLogEntry): Promise<void>;
  readLogs(jobId: string): Promise<AgentLogEntry[]>;
  writeJobText(jobId: string, filename: string, content: string): Promise<string>;
  readJobText(jobId: string, filename: string): Promise<string>;
  addHistory(entry: AgentHistoryEntry): Promise<void>;
  readHistory(): Promise<AgentHistoryEntry[]>;
}

export function createAgentStore(baseDir = path.join(process.cwd(), 'data', 'agent-pipeline')): AgentStore {
  const jobsDir = path.join(baseDir, 'jobs');
  const materialsPath = path.join(baseDir, 'materials.json');
  const currentJobPath = path.join(baseDir, 'current-job.json');
  const historyPath = path.join(baseDir, 'history.json');

  async function writeJson(filePath: string, value: unknown) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  }

  async function readJson<T>(filePath: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await readFile(filePath, 'utf8')) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return fallback;
      }
      throw error;
    }
  }

  function jobDir(jobId: string) {
    return path.join(jobsDir, jobId);
  }

  return {
    baseDir,
    jobsDir,

    readMaterials() {
      return readJson<AgentMaterial[]>(materialsPath, []);
    },

    writeMaterials(materials) {
      return writeJson(materialsPath, materials);
    },

    readCurrentJob() {
      return readJson<AgentJob | null>(currentJobPath, null);
    },

    async writeCurrentJob(job) {
      await writeJson(currentJobPath, job);
      await writeJson(path.join(jobDir(job.id), 'job.json'), job);
    },

    clearCurrentJob() {
      return writeJson(currentJobPath, null);
    },

    async appendLog(jobId, entry) {
      const filePath = path.join(jobDir(jobId), 'logs.jsonl');
      await mkdir(path.dirname(filePath), { recursive: true });
      await appendFile(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
    },

    async readLogs(jobId) {
      try {
        const content = await readFile(path.join(jobDir(jobId), 'logs.jsonl'), 'utf8');
        return content
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as AgentLogEntry);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return [];
        }
        throw error;
      }
    },

    async writeJobText(jobId, filename, content) {
      const filePath = path.join(jobDir(jobId), filename);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content, 'utf8');
      return filePath;
    },

    readJobText(jobId, filename) {
      return readFile(path.join(jobDir(jobId), filename), 'utf8');
    },

    async addHistory(entry) {
      const history = await readJson<AgentHistoryEntry[]>(historyPath, []);
      await writeJson(historyPath, [entry, ...history]);
    },

    readHistory() {
      return readJson<AgentHistoryEntry[]>(historyPath, []);
    }
  };
}
