import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { CliArgs } from "../types.ts";

import {
  buildOpenAIGenerationsBody,
  extractImageFromResponse,
  generateImage,
  getOpenAIAspectRatio,
  getOpenAIImageApiDialect,
  getOpenAIResolution,
  getMimeType,
  getOpenAISize,
  getOrientationFromAspectRatio,
  inferAspectRatioFromSize,
  inferResolutionFromSize,
  parseAspectRatio,
} from "./openai.ts";

test("OpenAI aspect-ratio parsing and size selection match model families", () => {
  assert.deepEqual(parseAspectRatio("16:9"), { width: 16, height: 9 });
  assert.equal(parseAspectRatio("wide"), null);
  assert.equal(parseAspectRatio("0:1"), null);

  assert.equal(getOpenAISize("dall-e-3", "16:9", "2k"), "1792x1024");
  assert.equal(getOpenAISize("dall-e-3", "9:16", "normal"), "1024x1792");
  assert.equal(getOpenAISize("dall-e-2", "16:9", "2k"), "1024x1024");
  assert.equal(getOpenAISize("gpt-image-1.5", "16:9", "2k"), "1536x1024");
  assert.equal(getOpenAISize("gpt-image-1.5", "4:3", "2k"), "1024x1024");
  assert.equal(inferAspectRatioFromSize("1536x1024"), "3:2");
  assert.equal(inferResolutionFromSize("1536x1024"), "2K");
  assert.equal(getOpenAIAspectRatio({ aspectRatio: null, size: "2048x1152" }), "16:9");
  assert.equal(getOpenAIResolution({ imageSize: null, size: "2048x1152", quality: "normal" }), "2K");
  assert.equal(getOrientationFromAspectRatio("16:9"), "landscape");
  assert.equal(getOrientationFromAspectRatio("9:16"), "portrait");
  assert.equal(getOrientationFromAspectRatio("1:1"), null);
  assert.equal(getOpenAIImageApiDialect({ imageApiDialect: null }), "openai-native");
});

test("OpenAI generations body switches between native and ratio-metadata dialects", () => {
  assert.deepEqual(
    buildOpenAIGenerationsBody("Draw a skyline", "gpt-image-1.5", {
      aspectRatio: "16:9",
      size: null,
      quality: "2k",
      imageSize: null,
      imageApiDialect: null,
    }),
    {
      model: "gpt-image-1.5",
      prompt: "Draw a skyline",
      size: "1536x1024",
    },
  );

  assert.deepEqual(
    buildOpenAIGenerationsBody("Draw a skyline", "gemini-3-pro-image-preview", {
      aspectRatio: "16:9",
      size: null,
      quality: "2k",
      imageSize: null,
      imageApiDialect: "ratio-metadata",
    }),
    {
      model: "gemini-3-pro-image-preview",
      prompt: "Draw a skyline",
      size: "16:9",
      metadata: {
        resolution: "2K",
        orientation: "landscape",
      },
    },
  );

  assert.deepEqual(
    buildOpenAIGenerationsBody("Draw a portrait", "gemini-3-pro-image-preview", {
      aspectRatio: null,
      size: "1152x2048",
      quality: "normal",
      imageSize: null,
      imageApiDialect: "ratio-metadata",
    }),
    {
      model: "gemini-3-pro-image-preview",
      prompt: "Draw a portrait",
      size: "9:16",
      metadata: {
        resolution: "2K",
        orientation: "portrait",
      },
    },
  );
});

test("OpenAI mime-type detection covers supported reference image extensions", () => {
  assert.equal(getMimeType("frame.png"), "image/png");
  assert.equal(getMimeType("frame.jpg"), "image/jpeg");
  assert.equal(getMimeType("frame.webp"), "image/webp");
  assert.equal(getMimeType("frame.gif"), "image/gif");
});

test("OpenAI response extraction supports base64 and URL download flows", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const fromBase64 = await extractImageFromResponse({
    data: [{ b64_json: Buffer.from("hello").toString("base64") }],
  });
  assert.equal(Buffer.from(fromBase64).toString("utf8"), "hello");

  globalThis.fetch = async () =>
    new Response(Uint8Array.from([1, 2, 3]), {
      status: 200,
      headers: { "Content-Type": "application/octet-stream" },
    });

  const fromUrl = await extractImageFromResponse({
    data: [{ url: "https://example.com/image.png" }],
  });
  assert.deepEqual([...fromUrl], [1, 2, 3]);

  await assert.rejects(
    () => extractImageFromResponse({ data: [{}] }),
    /No image in response/,
  );
});

const generationArgs: CliArgs = {
  prompt: null, promptFiles: [], imagePath: null, provider: "openai", model: null,
  aspectRatio: "3:4", size: null, quality: "2k", imageSize: null,
  imageApiDialect: null, imageTextMode: null, referenceImages: [], n: 1,
  batchFile: null, jobs: null, json: false, help: false,
};

function mockGeneration(t: TestContext, responses: Response[]) {
  const originalFetch = globalThis.fetch;
  const keys = ["OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_IMAGE_USE_CHAT"];
  const previous = keys.map((key) => process.env[key]);
  process.env.OPENAI_API_KEY = "test-key";
  process.env.OPENAI_BASE_URL = "https://example.com/v1";
  delete process.env.OPENAI_IMAGE_USE_CHAT;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    assert.ok(responses.length, "unexpected extra API call");
    return responses.shift()!;
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  });
  return calls;
}

function unavailableImages(): Response {
  return Response.json({ code: 503, message: "no available images channels" }, { status: 503 });
}

test("OpenAI native image success does not call Responses", async (t) => {
  const calls = mockGeneration(t, [Response.json({ data: [{ b64_json: "aW1hZ2U=" }] })]);
  const image = await generateImage("Cover", "gpt-image-2", generationArgs);
  assert.equal(Buffer.from(image).toString(), "image");
  assert.deepEqual(calls.map((call) => call.url), ["https://example.com/v1/images/generations"]);
});

test("OpenAI image-channel failure falls back to Responses JSON with the original model, prompt and size", async (t) => {
  const calls = mockGeneration(t, [unavailableImages(), Response.json({
    output: [{ type: "image_generation_call", result: "aW1hZ2U=" }],
  })]);
  const image = await generateImage("Cover", "gpt-image-2", { ...generationArgs, size: "1024x1536" });
  assert.equal(Buffer.from(image).toString(), "image");
  assert.deepEqual(calls.map((call) => call.url), [
    "https://example.com/v1/images/generations", "https://example.com/v1/responses",
  ]);
  assert.deepEqual(JSON.parse(calls[1]!.init!.body as string), {
    model: "gpt-image-2", input: "Cover", tools: [{ type: "image_generation", size: "1024x1536" }],
  });
  assert.equal((calls[1]!.init!.headers as Record<string, string>).Authorization, "Bearer test-key");
  assert.ok(calls[1]!.init!.signal instanceof AbortSignal);
});

test("OpenAI Responses parses fragmented UTF-8 SSE and cancels after a complete image without waiting for EOF", async (t) => {
  const events = [
    { type: "response.created", description: "生成封面" },
    { type: "response.output_item.added", item: { type: "image_generation_call", status: "in_progress" } },
    { type: "response.image_generation_call.partial_image", partial_image_b64: "cGFydGlhbA==" },
    { type: "response.output_item.done", item: { type: "image_generation_call", result: "aW1hZ2U=" } },
  ];
  const bytes = new TextEncoder().encode(events.map((event) => `event: ${event.type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`).join(""));
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let index = 0; index < bytes.length; index += 7) controller.enqueue(bytes.slice(index, index + 7));
    },
    cancel() { cancelled = true; },
  });
  mockGeneration(t, [unavailableImages(), new Response(stream, { headers: { "Content-Type": "text/event-stream" } })]);
  const image = await generateImage("Cover", "gpt-image-2", generationArgs);
  assert.equal(Buffer.from(image).toString(), "image");
  assert.equal(cancelled, true);
});

test("OpenAI authentication failures do not switch to Responses", async (t) => {
  const calls = mockGeneration(t, [Response.json({ message: "invalid key" }, { status: 401 })]);
  await assert.rejects(() => generateImage("Cover", "gpt-image-2", generationArgs), /invalid key/);
  assert.equal(calls.length, 1);
});

test("OpenAI Responses reports HTTP and streamed errors and rejects an image-less stream", async (t) => {
  mockGeneration(t, [
    unavailableImages(), Response.json({ message: "upstream unavailable" }, { status: 503 }),
    unavailableImages(), new Response('data: {"type":"response.failed","response":{"error":{"message":"generation failed"}}}\n\n', { headers: { "Content-Type": "text/event-stream" } }),
    unavailableImages(), new Response('data: {"type":"response.completed","response":{"output":[]}}\n\ndata: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } }),
  ]);
  await assert.rejects(() => generateImage("Cover", "gpt-image-2", generationArgs), /Responses API error \(503\).*upstream unavailable/);
  await assert.rejects(() => generateImage("Cover", "gpt-image-2", generationArgs), /generation failed/);
  await assert.rejects(() => generateImage("Cover", "gpt-image-2", generationArgs), /No image in Responses response/);
});
