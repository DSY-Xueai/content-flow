import path from "node:path";
import { readFile } from "node:fs/promises";
import type { CliArgs, OpenAIImageApiDialect } from "../types";

export function getDefaultModel(): string {
  return process.env.OPENAI_IMAGE_MODEL || "gpt-image-1.5";
}

type OpenAIImageResponse = { data: Array<{ url?: string; b64_json?: string }> };

export function parseAspectRatio(ar: string): { width: number; height: number } | null {
  const match = ar.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const w = parseFloat(match[1]!);
  const h = parseFloat(match[2]!);
  if (w <= 0 || h <= 0) return null;
  return { width: w, height: h };
}

type SizeMapping = {
  square: string;
  landscape: string;
  portrait: string;
};

type OpenAIGenerationsBody = Record<string, unknown>;

export function getOpenAISize(
  model: string,
  ar: string | null,
  quality: CliArgs["quality"]
): string {
  const isDalle3 = model.includes("dall-e-3");
  const isDalle2 = model.includes("dall-e-2");

  if (isDalle2) {
    return "1024x1024";
  }

  const sizes: SizeMapping = isDalle3
    ? {
        square: "1024x1024",
        landscape: "1792x1024",
        portrait: "1024x1792",
      }
    : {
        square: "1024x1024",
        landscape: "1536x1024",
        portrait: "1024x1536",
      };

  if (!ar) return sizes.square;

  const parsed = parseAspectRatio(ar);
  if (!parsed) return sizes.square;

  const ratio = parsed.width / parsed.height;

  if (Math.abs(ratio - 1) < 0.1) return sizes.square;
  if (ratio > 1.5) return sizes.landscape;
  if (ratio < 0.67) return sizes.portrait;
  return sizes.square;
}

function parsePixelSize(value: string): { width: number; height: number } | null {
  const match = value.match(/^(\d+)\s*[xX]\s*(\d+)$/);
  if (!match) return null;

  const width = parseInt(match[1]!, 10);
  const height = parseInt(match[2]!, 10);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  return { width, height };
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
}

export function getOpenAIImageApiDialect(args: Pick<CliArgs, "imageApiDialect">): OpenAIImageApiDialect {
  return args.imageApiDialect ?? "openai-native";
}

export function inferAspectRatioFromSize(size: string | null): string | null {
  if (!size) return null;
  const parsed = parsePixelSize(size);
  if (!parsed) return null;

  const divisor = gcd(parsed.width, parsed.height);
  return `${parsed.width / divisor}:${parsed.height / divisor}`;
}

export function inferResolutionFromSize(size: string | null): "1K" | "2K" | "4K" | null {
  if (!size) return null;
  const parsed = parsePixelSize(size);
  if (!parsed) return null;

  const longestEdge = Math.max(parsed.width, parsed.height);
  if (longestEdge <= 1024) return "1K";
  if (longestEdge <= 2048) return "2K";
  return "4K";
}

export function getOpenAIAspectRatio(args: Pick<CliArgs, "aspectRatio" | "size">): string {
  return args.aspectRatio ?? inferAspectRatioFromSize(args.size) ?? "1:1";
}

export function getOpenAIResolution(
  args: Pick<CliArgs, "imageSize" | "size" | "quality">
): "1K" | "2K" | "4K" {
  if (args.imageSize === "1K" || args.imageSize === "2K" || args.imageSize === "4K") {
    return args.imageSize;
  }

  const inferred = inferResolutionFromSize(args.size);
  if (inferred) return inferred;

  return args.quality === "normal" ? "1K" : "2K";
}

export function getOrientationFromAspectRatio(ar: string): "landscape" | "portrait" | null {
  const parsed = parseAspectRatio(ar);
  if (!parsed) return null;

  const ratio = parsed.width / parsed.height;
  if (Math.abs(ratio - 1) < 0.1) return null;
  return ratio > 1 ? "landscape" : "portrait";
}

export function buildOpenAIGenerationsBody(
  prompt: string,
  model: string,
  args: Pick<CliArgs, "aspectRatio" | "size" | "quality" | "imageSize" | "imageApiDialect">
): OpenAIGenerationsBody {
  if (getOpenAIImageApiDialect(args) === "ratio-metadata") {
    const aspectRatio = getOpenAIAspectRatio(args);
    const metadata: Record<string, string> = {
      resolution: getOpenAIResolution(args),
    };
    const orientation = getOrientationFromAspectRatio(aspectRatio);
    if (orientation) metadata.orientation = orientation;

    return {
      model,
      prompt,
      size: aspectRatio,
      metadata,
    };
  }

  const body: OpenAIGenerationsBody = {
    model,
    prompt,
    size: args.size || getOpenAISize(model, args.aspectRatio, args.quality),
  };

  if (model.includes("dall-e-3")) {
    body.quality = args.quality === "2k" ? "hd" : "standard";
  }

  return body;
}

export async function generateImage(
  prompt: string,
  model: string,
  args: CliArgs
): Promise<Uint8Array> {
  const baseURL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is required. Codex/ChatGPT desktop login does not automatically grant OpenAI Images API access to this script."
    );
  }

  if (process.env.OPENAI_IMAGE_USE_CHAT === "true") {
    return generateWithChatCompletions(baseURL, apiKey, prompt, model);
  }

  const imageApiDialect = getOpenAIImageApiDialect(args);

  if (args.referenceImages.length > 0) {
    if (imageApiDialect !== "openai-native") {
      throw new Error(
        "Reference images are not supported with the ratio-metadata OpenAI dialect yet. Use openai-native, Google, Azure, OpenRouter, MiniMax, Seedream, or Replicate for image-edit workflows."
      );
    }
    if (model.includes("dall-e-2") || model.includes("dall-e-3")) {
      throw new Error(
        "Reference images with OpenAI in this skill require GPT Image models. Use --model gpt-image-1.5 (or another gpt-image model)."
      );
    }
    const size = args.size || getOpenAISize(model, args.aspectRatio, args.quality);
    return generateWithOpenAIEdits(baseURL, apiKey, prompt, model, size, args.referenceImages, args.quality);
  }

  return generateWithOpenAIGenerations(
    baseURL,
    apiKey,
    buildOpenAIGenerationsBody(prompt, model, args)
  );
}

async function generateWithChatCompletions(
  baseURL: string,
  apiKey: string,
  prompt: string,
  model: string
): Promise<Uint8Array> {
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error: ${err}`);
  }

  const result = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  const content = result.choices[0]?.message?.content ?? "";

  const match = content.match(/data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)/);
  if (match) {
    return Uint8Array.from(Buffer.from(match[1]!, "base64"));
  }

  throw new Error("No image found in chat completions response");
}

async function generateWithOpenAIGenerations(
  baseURL: string,
  apiKey: string,
  body: OpenAIGenerationsBody
): Promise<Uint8Array> {
  const res = await fetch(`${baseURL}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    if (res.status === 503 && /no available images channels/i.test(err)) {
      console.error("[openai] Images channel unavailable; using /responses image_generation.");
      return generateWithResponses(baseURL, apiKey, body);
    }
    throw new Error(`OpenAI API error: ${err}`);
  }

  const result = (await res.json()) as OpenAIImageResponse;
  return extractImageFromResponse(result);
}

type ResponsesImage = { type?: string; result?: string };
type ResponsesPayload = {
  type?: string;
  status?: string;
  message?: string;
  error?: { message?: string };
  item?: ResponsesImage;
  output?: ResponsesImage[];
  response?: { output?: ResponsesImage[]; error?: { message?: string } };
};

function imageFromResponses(payload: ResponsesPayload): Uint8Array | null {
  const error = payload.error ?? payload.response?.error;
  if (error || ["error", "response.failed", "response.incomplete"].includes(payload.type ?? "") ||
      ["failed", "incomplete"].includes(payload.status ?? "")) {
    throw new Error(`OpenAI Responses API error: ${error?.message ?? payload.message ?? payload.type ?? payload.status}`);
  }
  const items = [payload.item, ...(payload.output ?? []), ...(payload.response?.output ?? [])];
  const image = items.find((item) => item?.type === "image_generation_call" && item.result)?.result;
  return image ? Uint8Array.from(Buffer.from(image.replace(/^data:image\/[^;]+;base64,/, ""), "base64")) : null;
}

async function generateWithResponses(
  baseURL: string,
  apiKey: string,
  body: OpenAIGenerationsBody
): Promise<Uint8Array> {
  const res = await fetch(`${baseURL}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: body.model,
      input: body.prompt,
      tools: [{ type: "image_generation", size: body.size, quality: body.quality }],
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`OpenAI Responses API error (${res.status}): ${await res.text()}`);
  if (!res.headers.get("content-type")?.includes("text/event-stream")) {
    const image = imageFromResponses(await res.json() as ResponsesPayload);
    if (image) return image;
    throw new Error("No image in Responses response");
  }
  if (!res.body) throw new Error("No image in Responses response");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const events = pending.split(/\r?\n\r?\n/);
      pending = events.pop()!;
      if (done && pending.trim()) events.push(pending);
      for (const event of events) {
        const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart()).join("\n");
        if (!data || data === "[DONE]") continue;
        const image = imageFromResponses(JSON.parse(data) as ResponsesPayload);
        if (image) return image;
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  throw new Error("No image in Responses response");
}

async function generateWithOpenAIEdits(
  baseURL: string,
  apiKey: string,
  prompt: string,
  model: string,
  size: string,
  referenceImages: string[],
  quality: CliArgs["quality"]
): Promise<Uint8Array> {
  const form = new FormData();
  form.append("model", model);
  form.append("prompt", prompt);
  form.append("size", size);

  if (model.includes("gpt-image")) {
    form.append("quality", quality === "2k" ? "high" : "medium");
  }

  for (const refPath of referenceImages) {
    const bytes = await readFile(refPath);
    const filename = path.basename(refPath);
    const mimeType = getMimeType(filename);
    const blob = new Blob([bytes], { type: mimeType });
    form.append("image[]", blob, filename);
  }

  const res = await fetch(`${baseURL}/images/edits`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI edits API error: ${err}`);
  }

  const result = (await res.json()) as OpenAIImageResponse;
  return extractImageFromResponse(result);
}

export function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/png";
}

export async function extractImageFromResponse(result: OpenAIImageResponse): Promise<Uint8Array> {
  const img = result.data[0];

  if (img?.b64_json) {
    return Uint8Array.from(Buffer.from(img.b64_json, "base64"));
  }

  if (img?.url) {
    const imgRes = await fetch(img.url);
    if (!imgRes.ok) throw new Error("Failed to download image");
    const buf = await imgRes.arrayBuffer();
    return new Uint8Array(buf);
  }

  throw new Error("No image in response");
}
