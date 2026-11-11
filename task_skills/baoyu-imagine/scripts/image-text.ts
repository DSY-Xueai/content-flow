import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import type { ImageTextMode } from "./types";

export type ResolvedImageTextMode = Exclude<ImageTextMode, "auto">;

export type OcrLine = {
  language: string;
  text: string;
};

export type ImageTextFailureType =
  | "unexpected_text"
  | "unexpected_language"
  | "garbled_text"
  | "pseudo_text"
  | "ocr_unavailable";

export type ImageTextVerificationResult = {
  ok: boolean;
  mode: ResolvedImageTextMode;
  detectedLines: OcrLine[];
  detectedText: string;
  failureType: ImageTextFailureType | null;
  reason: string | null;
};

const WINDOWS_POWERSHELL = "C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const ALLOWED_ENGLISH_ACRONYMS = new Set([
  "AI",
  "AGI",
  "API",
  "APP",
  "B2B",
  "B2C",
  "CEO",
  "CPU",
  "CTO",
  "DB",
  "GPU",
  "HTML",
  "HTTP",
  "JSON",
  "LLM",
  "MCP",
  "OCR",
  "PDF",
  "ROI",
  "SLA",
  "SQL",
  "UI",
  "URL",
  "UX",
]);
const WINDOWS_OCR_SCRIPT = String.raw`
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
$ImagePath = $env:BAOYU_IMAGE_VERIFY_PATH
if ([string]::IsNullOrWhiteSpace($ImagePath)) {
  throw "BAOYU_IMAGE_VERIFY_PATH is required"
}

function Await([object]$Operation, [Type]$ResultType) {
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } |
    Select-Object -First 1
  $task = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  $task.Wait()
  return $task.Result
}

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

$ocrType = [Type]::GetType('Windows.Media.Ocr.OcrEngine, Windows, ContentType=WindowsRuntime')
$langType = [Type]::GetType('Windows.Globalization.Language, Windows, ContentType=WindowsRuntime')
$ocrResultType = [Type]::GetType('Windows.Media.Ocr.OcrResult, Windows, ContentType=WindowsRuntime')
$available = @($ocrType.GetProperty('AvailableRecognizerLanguages').GetValue($null) | ForEach-Object { $_.LanguageTag })
$targets = @('zh-Hans-CN', 'en-US')

$seen = New-Object 'System.Collections.Generic.HashSet[string]'
$lines = New-Object 'System.Collections.Generic.List[object]'

foreach ($tag in $targets) {
  if ($available -notcontains $tag) { continue }
  $lang = [Activator]::CreateInstance($langType, @($tag))
  $engine = $ocrType.GetMethod('TryCreateFromLanguage').Invoke($null, @($lang))
  if ($null -eq $engine) { continue }
  $result = Await ($engine.RecognizeAsync($bitmap)) ($ocrResultType)
  foreach ($text in ($result.Text -split "\r?\n")) {
    if ([string]::IsNullOrWhiteSpace($text)) { continue }
    $normalized = ([string]$text).Trim()
    if ($seen.Add($normalized)) {
      $lines.Add([pscustomobject]@{
        language = $tag
        text = $normalized
      })
    }
  }
}

[pscustomobject]@{ lines = $lines } | ConvertTo-Json -Compress -Depth 5
`;

function execFileUtf8(
  file: string,
  args: string[],
  timeoutMs: number,
  envOverrides: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string }> {
  try {
    const stdout = execFileSync(file, args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        ...envOverrides,
      },
    });
    return Promise.resolve({ stdout, stderr: "" });
  } catch (error) {
    const err = error as { message?: string; stderr?: string | Buffer };
    const stderr =
      typeof err.stderr === "string"
        ? err.stderr
        : err.stderr
          ? err.stderr.toString("utf8")
          : "";
    return Promise.reject(new Error(stderr.trim() || err.message || "Command failed"));
  }
}

export function parseImageTextMode(value: string | null | undefined): ImageTextMode | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "auto" || normalized === "zh" || normalized === "en" || normalized === "none") {
    return normalized;
  }
  throw new Error(`Invalid imageTextMode: ${value}`);
}

export function getImageTextAttemptOrder(mode: ImageTextMode | null): ResolvedImageTextMode[] {
  if (mode === "en") return ["en", "none"];
  if (mode === "none") return ["none"];
  return ["zh", "en", "none"];
}

export function buildPromptForImageTextMode(prompt: string, mode: ResolvedImageTextMode): string {
  const trimmed = prompt.trim();
  const policy =
    mode === "zh"
      ? [
          "Visible text is optional.",
          "If text is needed, use simplified Chinese only.",
          "Do not render English labels, garbled characters, pseudo-text, hex codes, UI tags, or stray annotations.",
          "If clean simplified Chinese cannot be rendered, omit visible text instead of inventing broken labels.",
        ].join(" ")
      : mode === "en"
        ? [
            "Visible text is optional.",
            "If text is needed, use natural English only.",
            "Do not render Chinese labels, garbled characters, pseudo-text, broken letters, hex codes, UI tags, or stray annotations.",
            "If clean English cannot be rendered, omit visible text instead of inventing broken labels.",
          ].join(" ")
        : [
            "Do not render any visible text.",
            "No letters, numbers, labels, captions, legends, UI tags, hex codes, signs, or watermark text anywhere in the image.",
          ].join(" ");

  return `${trimmed}\n\nTEXT OUTPUT POLICY:\n${policy}`;
}

export function normalizeDetectedText(lines: Array<string | OcrLine>): { lines: OcrLine[]; text: string } {
  const normalizedLines = lines
    .map((line) =>
      typeof line === "string"
        ? { language: "unknown", text: line.trim() }
        : { language: line.language, text: line.text.trim() },
    )
    .filter((line) => line.text.length > 0);

  return {
    lines: normalizedLines,
    text: normalizedLines.map((line) => line.text).join("\n").trim(),
  };
}

function makeSuccess(
  mode: ResolvedImageTextMode,
  detectedLines: OcrLine[],
  detectedText: string,
): ImageTextVerificationResult {
  return {
    ok: true,
    mode,
    detectedLines,
    detectedText,
    failureType: null,
    reason: null,
  };
}

function makeFailure(
  mode: ResolvedImageTextMode,
  detectedLines: OcrLine[],
  detectedText: string,
  failureType: ImageTextFailureType,
  reason: string,
): ImageTextVerificationResult {
  return {
    ok: false,
    mode,
    detectedLines,
    detectedText,
    failureType,
    reason,
  };
}

function containsHan(text: string): boolean {
  return /\p{Script=Han}/u.test(text);
}

function containsLatin(text: string): boolean {
  return /[A-Za-z]/.test(text);
}

function hasSuspiciousGarbledText(text: string): boolean {
  return /�/.test(text) || /[_=~`|\\<>[\]{}]{2,}/.test(text);
}

function isLikelyPseudoEnglishToken(token: string): boolean {
  const normalized = token.replace(/[-']/g, "");
  if (normalized.length < 4) return false;
  if (/^[A-Z0-9]{2,6}$/.test(normalized)) {
    return !ALLOWED_ENGLISH_ACRONYMS.has(normalized);
  }
  if (/[AEIOUYaeiouy]/.test(normalized)) return false;
  if (/(.)\1\1/i.test(normalized)) return true;
  return /^[A-Za-z]+$/.test(normalized);
}

export function evaluateDetectedText(
  mode: ResolvedImageTextMode,
  lines: Array<string | OcrLine>,
): ImageTextVerificationResult {
  const normalized = normalizeDetectedText(lines);
  const detectedLines = normalized.lines;
  const detectedText = normalized.text;

  if (!detectedText) {
    return makeSuccess(mode, detectedLines, detectedText);
  }

  if (mode === "none") {
    return makeFailure(
      mode,
      detectedLines,
      detectedText,
      "unexpected_text",
      "no-text mode detected visible text",
    );
  }

  if (hasSuspiciousGarbledText(detectedText)) {
    return makeFailure(
      mode,
      detectedLines,
      detectedText,
      "garbled_text",
      "detected garbled or placeholder characters",
    );
  }

  if (mode === "zh") {
    if (containsLatin(detectedText)) {
      return makeFailure(
        mode,
        detectedLines,
        detectedText,
        "unexpected_language",
        "simplified-Chinese mode detected Latin text",
      );
    }

    const stripped = detectedText.replace(/[\p{Script=Han}\d\s，。！？、：；（）《》〈〉“”‘’—…·,.!?%+\-:/]/gu, "");
    if (stripped.length > 0) {
      return makeFailure(
        mode,
        detectedLines,
        detectedText,
        "garbled_text",
        "simplified-Chinese mode detected unsupported characters",
      );
    }

    return makeSuccess(mode, detectedLines, detectedText);
  }

  if (containsHan(detectedText)) {
    return makeFailure(
      mode,
      detectedLines,
      detectedText,
      "unexpected_language",
      "English mode detected Chinese text",
    );
  }

  const unsupported = detectedText.replace(/[A-Za-z0-9\s.,:;!?'"%&()\-+/#]/g, "");
  if (unsupported.length > 0) {
    return makeFailure(
      mode,
      detectedLines,
      detectedText,
      "garbled_text",
      "English mode detected unsupported characters",
    );
  }

  const tokens = detectedText.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  const pseudoToken = tokens.find((token) => isLikelyPseudoEnglishToken(token));
  if (pseudoToken) {
    return makeFailure(
      mode,
      detectedLines,
      detectedText,
      "pseudo_text",
      `English mode detected pseudo-word: ${pseudoToken}`,
    );
  }

  return makeSuccess(mode, detectedLines, detectedText);
}

export async function detectVisibleTextWithWindowsOcr(imagePath: string): Promise<OcrLine[]> {
  if (process.platform !== "win32") {
    throw new Error("Automatic image text verification currently requires Windows OCR.");
  }

  const { stdout } = await execFileUtf8(
    WINDOWS_POWERSHELL,
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      WINDOWS_OCR_SCRIPT,
    ],
    60000,
    {
      BAOYU_IMAGE_VERIFY_PATH: imagePath,
    },
  );

  const parsed = JSON.parse(stdout) as { lines?: OcrLine[] };
  return Array.isArray(parsed.lines) ? parsed.lines : [];
}

export async function verifyImageTextFile(
  imagePath: string,
  mode: ResolvedImageTextMode,
): Promise<ImageTextVerificationResult> {
  try {
    const lines = await detectVisibleTextWithWindowsOcr(imagePath);
    return evaluateDetectedText(mode, lines);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return makeFailure(mode, [], "", "ocr_unavailable", message);
  }
}

export async function verifyImageTextData(
  imageData: Uint8Array,
  outputPath: string,
  mode: ResolvedImageTextMode,
): Promise<ImageTextVerificationResult> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "baoyu-imagine-verify-"));
  const ext = path.extname(outputPath) || ".png";
  const tempPath = path.join(tempDir, `candidate${ext}`);

  try {
    await writeFile(tempPath, imageData);
    return await verifyImageTextFile(tempPath, mode);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
