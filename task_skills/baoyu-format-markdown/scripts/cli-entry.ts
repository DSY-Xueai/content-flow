import path from "node:path";
import { fileURLToPath } from "node:url";

export function isDirectCliEntrypoint(metaUrl: string, argvPath?: string): boolean {
  if (!argvPath) return false;
  try {
    return path.resolve(fileURLToPath(metaUrl)) === path.resolve(argvPath);
  } catch {
    return false;
  }
}
