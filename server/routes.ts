import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import { storage, refreshDebateCostSummary } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import OpenAI from "openai";
import sharp from "sharp";
import rateLimit from "express-rate-limit";
import { registerObjectStorageRoutes, ObjectStorageService, ObjectPermission } from "./replit_integrations/object_storage";
import { DEFAULT_COUNCIL_MODELS, DEFAULT_CHAIRMAN_MODEL, isVisionCapable, getDebateCreditCost, AVAILABLE_MODELS, FREE_TIER_CREDITS, getUserTier, getModelContextWindow, MODEL_FALLBACKS, getModelById } from "@shared/models";
import { users } from "@shared/models/auth";
import { isAuthenticated } from "./replit_integrations/auth";
import { authStorage } from "./replit_integrations/auth/storage";
import { getAuth, clerkClient } from "@clerk/express";
import { getUncachableStripeClient } from "./stripeClient";
import { getCreditPackBySize } from "./creditPacks";
import { extractTextFromFile, renderPdfToImages, cleanupRenderedImages, getPdfPageCount } from "./documentParser";
import { sendSupportMessage } from "./email";
import path from "path";
import fs from "fs";
import { db } from "./db";
import { sql, eq } from "drizzle-orm";
import { conversations, messages } from "@shared/schema";
import { creditTransactions } from "@shared/models/auth";
import { securityLog } from "./securityLogger";
import { checkPerUserLimit } from "./security/rateLimiter";
import { requireRecentAuth } from "./security/recentAuth";

const conversationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests. Please try again shortly." },
});

const stripeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many payment requests. Please try again shortly." },
});

const supportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many support requests. Please try again shortly." },
});

const extractTextLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many extraction requests. Please try again shortly." },
});

const sensitiveStripeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests. Please try again shortly." },
});

const accountDeleteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests. Please try again shortly." },
});


function getUserId(req: Request): string | undefined {
  return getAuth(req).userId ?? undefined;
}

function isAdmin(req: Request): boolean {
  const userId = getUserId(req);
  if (!userId) return false;
  const adminIds = (process.env.ADMIN_USER_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
  return adminIds.includes(userId);
}

function registerConfigRoutes(app: Express) {
  app.get("/api/config", (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({
      clerkPublishableKey: process.env.CLERK_PUBLISHABLE_KEY || "",
    });
  });
}

function getAllowedDomains(): string[] {
  const domains: string[] = [];
  if (process.env.REPLIT_DOMAINS) {
    domains.push(...process.env.REPLIT_DOMAINS.split(",").map(d => d.trim()).filter(Boolean));
  }
  if (process.env.REPLIT_DEV_DOMAIN) {
    domains.push(process.env.REPLIT_DEV_DOMAIN);
  }
  return domains;
}

function getBaseUrl(req: Request): string {
  const host = req.get("host");
  const allowedDomains = getAllowedDomains();

  if (host && allowedDomains.length > 0) {
    if (allowedDomains.some(d => host === d || host.endsWith(`.${d}`))) {
      return `https://${host}`;
    }
  }

  if (allowedDomains.length > 0) {
    const customDomain = allowedDomains.find(d => !d.includes(".replit.dev") && !d.includes(".repl.co"));
    return `https://${customDomain || allowedDomains[0]}`;
  }

  return `http://localhost:${process.env.PORT || "5000"}`;
}


// Object storage service for direct file access
const objectStorageService = new ObjectStorageService();

const openrouter = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
  apiKey: process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY,
});

// Compress large images to ensure compatibility with all vision models
// Claude has stricter size limits than Gemini/Grok
const MAX_IMAGE_SIZE_BYTES = 1.5 * 1024 * 1024; // 1.5MB target for compressed images
const MAX_IMAGE_DIMENSION = 2048; // Max width/height

async function compressImageBuffer(buffer: Buffer, contentType: string): Promise<{ buffer: Buffer; contentType: string }> {
  const originalSize = buffer.length;
  console.log(`[IMAGE COMPRESS] Original size: ${Math.round(originalSize / 1024)}KB, type: ${contentType}`);
  
  // If image is small enough, return as-is
  if (originalSize <= MAX_IMAGE_SIZE_BYTES) {
    console.log(`[IMAGE COMPRESS] Image small enough, no compression needed`);
    return { buffer, contentType };
  }
  
  try {
    // Get image metadata
    const metadata = await sharp(buffer).metadata();
    console.log(`[IMAGE COMPRESS] Dimensions: ${metadata.width}x${metadata.height}`);
    
    // Calculate resize dimensions if needed
    let resizeOptions: sharp.ResizeOptions | undefined;
    if (metadata.width && metadata.height) {
      if (metadata.width > MAX_IMAGE_DIMENSION || metadata.height > MAX_IMAGE_DIMENSION) {
        resizeOptions = {
          width: MAX_IMAGE_DIMENSION,
          height: MAX_IMAGE_DIMENSION,
          fit: 'inside',
          withoutEnlargement: true
        };
      }
    }
    
    // Compress to JPEG for best size reduction
    let compressedBuffer = await sharp(buffer)
      .resize(resizeOptions)
      .jpeg({ quality: 85, progressive: true })
      .toBuffer();
    
    console.log(`[IMAGE COMPRESS] After initial compression: ${Math.round(compressedBuffer.length / 1024)}KB`);
    
    // If still too large, reduce quality further
    if (compressedBuffer.length > MAX_IMAGE_SIZE_BYTES) {
      compressedBuffer = await sharp(buffer)
        .resize(resizeOptions)
        .jpeg({ quality: 70, progressive: true })
        .toBuffer();
      console.log(`[IMAGE COMPRESS] After quality reduction: ${Math.round(compressedBuffer.length / 1024)}KB`);
    }
    
    // If STILL too large, resize more aggressively
    if (compressedBuffer.length > MAX_IMAGE_SIZE_BYTES) {
      compressedBuffer = await sharp(buffer)
        .resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 65, progressive: true })
        .toBuffer();
      console.log(`[IMAGE COMPRESS] After aggressive resize: ${Math.round(compressedBuffer.length / 1024)}KB`);
    }
    
    const reduction = Math.round((1 - compressedBuffer.length / originalSize) * 100);
    console.log(`[IMAGE COMPRESS] Compression complete: ${Math.round(originalSize / 1024)}KB -> ${Math.round(compressedBuffer.length / 1024)}KB (${reduction}% reduction)`);
    
    return { buffer: compressedBuffer, contentType: 'image/jpeg' };
  } catch (error: any) {
    console.error(`[IMAGE COMPRESS] Compression failed: ${error.message}, using original`);
    return { buffer, contentType };
  }
}

function resolveLocalFilePath(url: string): string | null {
  if (url.includes("/uploads/")) {
    const rawFilename = url.split("/uploads/").pop();
    if (!rawFilename) return null;
    const filename = path.basename(decodeURIComponent(rawFilename));
    if (!filename || filename === "." || filename === ".." || filename.includes(path.sep)) return null;
    const uploadsRoot = path.resolve(process.cwd(), "uploads");
    const resolved = path.resolve(uploadsRoot, filename);
    if (!resolved.startsWith(uploadsRoot + path.sep)) return null;
    return resolved;
  }
  return null;
}

// Convert image URL to base64 data URI for reliable vision API calls
function getExternalFetchAllowlist(): string[] {
  const allowed: string[] = [];
  if (process.env.REPLIT_DOMAINS) {
    allowed.push(...process.env.REPLIT_DOMAINS.split(",").map(d => d.trim()).filter(Boolean));
  }
  if (process.env.REPLIT_DEV_DOMAIN) {
    allowed.push(process.env.REPLIT_DEV_DOMAIN);
  }
  allowed.push("storage.googleapis.com");
  return allowed;
}

function isUrlSafeForFetch(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'https:') return false;
    const hostname = parsed.hostname.toLowerCase();
    const allowlist = getExternalFetchAllowlist();
    return allowlist.some(d => hostname === d || hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

async function imageUrlToBase64(imageUrl: string): Promise<string | null> {
  if (!imageUrl || typeof imageUrl !== 'string' || imageUrl.trim() === '') {
    return null;
  }
  
  try {
    const objectsPathMatch = imageUrl.match(/\/objects\/(.+?)(?:\?.*)?$/);
    if (objectsPathMatch) {
      const objectPath = `/objects/${objectsPathMatch[1]}`;
      try {
        const objectFile = await objectStorageService.getObjectEntityFile(`/objects/${objectsPathMatch[1]}`);
        const [metadata] = await objectFile.getMetadata();
        const contentType = metadata.contentType || 'image/png';
        
        const chunks: Buffer[] = [];
        const stream = objectFile.createReadStream();
        
        await new Promise<void>((resolve, reject) => {
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => resolve());
          stream.on('error', (err: Error) => reject(err));
        });
        
        const buffer = Buffer.concat(chunks);
        
        const compressed = await compressImageBuffer(buffer, contentType);
        const base64 = compressed.buffer.toString('base64');
        const dataUri = `data:${compressed.contentType};base64,${base64}`;
        
        return dataUri;
      } catch (storageError: any) {
        console.error(`[IMAGE ERROR] Failed to read from object storage: ${storageError.message}`);
      }
    }

    const localPath = resolveLocalFilePath(imageUrl);
    if (localPath && fs.existsSync(localPath)) {
      const buffer = fs.readFileSync(localPath);
      const ext = path.extname(localPath).toLowerCase();
      const mimeMap: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
      const contentType = mimeMap[ext] || 'image/png';
      const compressed = await compressImageBuffer(buffer, contentType);
      const base64 = compressed.buffer.toString('base64');
      return `data:${compressed.contentType};base64,${base64}`;
    }
    
    if (!isUrlSafeForFetch(imageUrl)) {
      console.warn(`[IMAGE] Blocked fetch to unsafe URL: ${imageUrl}`);
      return null;
    }

    const response = await fetch(imageUrl);
    
    if (!response.ok) {
      console.error(`[IMAGE ERROR] Failed to fetch image: ${response.status} ${response.statusText}`);
      return null;
    }
    
    const contentType = response.headers.get('content-type') || 'image/png';
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Compress image if needed for vision API compatibility
    const compressed = await compressImageBuffer(buffer, contentType);
    const base64 = compressed.buffer.toString('base64');
    const dataUri = `data:${compressed.contentType};base64,${base64}`;
    
    console.log(`[IMAGE] Successfully converted to base64 (${Math.round(base64.length / 1024)}KB)`);
    return dataUri;
  } catch (error: any) {
    console.error(`[IMAGE ERROR] Failed to convert image to base64: ${error.message}`);
    return null;
  }
}

// Convert multiple image URLs to base64 data URIs
async function convertImagesToBase64(imageUrls: string[]): Promise<string[]> {
  const results = await Promise.all(imageUrls.map(url => imageUrlToBase64(url)));
  return results.filter((uri): uri is string => uri !== null);
}

// Track active requests per message for cancellation (more granular than per-conversation)
const activeMessageRequests = new Map<number, AbortController>();

function createAbortController(messageId: number): AbortController {
  // Clean up any existing controller for this message
  const existing = activeMessageRequests.get(messageId);
  if (existing) {
    existing.abort("replaced");
  }
  const controller = new AbortController();
  activeMessageRequests.set(messageId, controller);
  return controller;
}

function cancelMessage(messageId: number): boolean {
  const controller = activeMessageRequests.get(messageId);
  if (controller) {
    controller.abort("cancelled");
    activeMessageRequests.delete(messageId);
    console.log(`[CANCEL] Aborted request for message ${messageId}`);
    return true;
  }
  return false;
}

function cancelConversationMessages(conversationId: number, messageIds: number[]): number {
  let cancelled = 0;
  for (const msgId of messageIds) {
    if (cancelMessage(msgId)) {
      cancelled++;
    }
  }
  console.log(`[CANCEL] Cancelled ${cancelled} active requests for conversation ${conversationId}`);
  return cancelled;
}

function clearMessageController(messageId: number): void {
  activeMessageRequests.delete(messageId);
}

// Extract meaningful error message from OpenRouter error response
function extractErrorMessage(error: any, model: string): string {
  const modelShort = model.split('/').pop() || model;
  const raw = error.error?.message || error.response?.data?.error?.message || error.message || '';
  const msg = raw.toLowerCase();

  if (msg.includes('rate limit') || msg.includes('429') || msg.includes('too many')) {
    return `${modelShort} is getting too many requests right now. Try again in a moment.`;
  }
  if (msg.includes('timeout') || msg.includes('etimedout') || msg.includes('timed out')) {
    return `${modelShort} took too long to respond. Try switching to a faster model.`;
  }
  if (msg.includes('503') || msg.includes('unavailable') || msg.includes('overloaded')) {
    return `${modelShort} is temporarily unavailable. Try a different model.`;
  }
  if (msg.includes('500') || msg.includes('internal server') || msg.includes('internal error')) {
    return `${modelShort} encountered an issue. Try again in a moment.`;
  }
  if (msg.includes('401') || msg.includes('unauthorized') || msg.includes('invalid key')) {
    return `${modelShort} authentication failed. Check your API configuration.`;
  }
  if (msg.includes('content') && (msg.includes('filter') || msg.includes('moderation') || msg.includes('policy'))) {
    return `${modelShort} declined to answer. Try rephrasing your question.`;
  }
  if (!raw) {
    return `${modelShort} didn't respond. Try again or switch models.`;
  }
  return `${modelShort} encountered an issue: ${raw.length > 120 ? raw.slice(0, 120) + '...' : raw}`;
}

function categorizeError(error: any): string {
  const raw = error.error?.message || error.response?.data?.error?.message || error.message || '';
  const msg = raw.toLowerCase();

  if (msg.includes('rate limit') || msg.includes('429') || msg.includes('too many')) {
    return 'rate_limit';
  }
  if (msg.includes('503') || msg.includes('unavailable') || msg.includes('overloaded')) {
    return 'model_unavailable';
  }
  if (msg.includes('timeout') || msg.includes('etimedout') || msg.includes('timed out')) {
    return 'timeout';
  }
  return 'unknown';
}

const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
const NON_STREAM_TIMEOUT_MS = 15 * 60 * 1000;

const LLM_MAX_RETRIES = 3;
const LLM_RETRY_BASE_DELAY_MS = 2000;
const LLM_RATE_LIMIT_DELAY_MS = 8000;
const LLM_MAX_CONCURRENT = 6;

function isRateLimitError(error: any): boolean {
  const msg = (error.message || error.error?.message || '').toLowerCase();
  return msg.includes('rate limit') || msg.includes('429') || msg.includes('too many');
}

function isRetryableError(error: any): boolean {
  if (error.message === "Request cancelled") return false;
  const msg = (error.message || error.error?.message || '').toLowerCase();
  if (msg.includes('content') && (msg.includes('filter') || msg.includes('moderation') || msg.includes('policy'))) return false;
  if (msg.includes('401') || msg.includes('unauthorized') || msg.includes('invalid key')) return false;
  return true;
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error("Request cancelled")); return; }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error("Request cancelled")); }, { once: true });
  });
}

const modelRateLimitTracker = new Map<string, number>();
const RATE_LIMIT_COOLDOWN_MS = 30000;

function markModelRateLimited(model: string) {
  modelRateLimitTracker.set(model, Date.now());
  console.log(`[RATE LIMIT] Marked ${model} as rate-limited for ${RATE_LIMIT_COOLDOWN_MS / 1000}s`);
}

function isModelRateLimited(model: string): boolean {
  const limitedAt = modelRateLimitTracker.get(model);
  if (!limitedAt) return false;
  if (Date.now() - limitedAt > RATE_LIMIT_COOLDOWN_MS) {
    modelRateLimitTracker.delete(model);
    return false;
  }
  return true;
}

class ConcurrencySemaphore {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private maxConcurrent: number) {}

  async acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error("Request cancelled");
    if (this.running < this.maxConcurrent) {
      this.running++;
      return;
    }
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        const idx = this.queue.indexOf(release);
        if (idx !== -1) this.queue.splice(idx, 1);
        reject(new Error("Request cancelled"));
      };
      const release = () => {
        signal?.removeEventListener('abort', onAbort);
        this.running++;
        resolve();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.queue.push(release);
    });
  }

  release() {
    this.running--;
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    }
  }
}

const llmSemaphore = new ConcurrencySemaphore(LLM_MAX_CONCURRENT);

const NON_STREAMING_MODELS: string[] = [
];

function shouldSkipStreaming(model: string): boolean {
  return NON_STREAMING_MODELS.some(m => model === m);
}

interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalCost?: number;
}

interface LLMResult {
  content: string;
  usage: LLMUsage;
}

interface OpenRouterUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_cost?: number;
}

interface OpenRouterMessage extends OpenAI.Chat.Completions.ChatCompletionMessage {
  reasoning_content?: string;
}

interface OpenRouterDelta {
  content?: string;
  reasoning_content?: string;
  reasoning?: string;
}

interface OpenRouterStreamChoice {
  delta?: OpenRouterDelta;
  message?: { content?: string };
  text?: string;
}

function isAnthropicModel(model: string): boolean {
  return model.startsWith('anthropic/');
}

function isGoogleModel(model: string): boolean {
  return model.startsWith('google/');
}

function getProviderPreferences(model: string): ProviderPreferences | undefined {
  if (isAnthropicModel(model)) {
    return {
      order: ["Anthropic"],
      allow_fallbacks: true,
    };
  }
  if (isGoogleModel(model)) {
    return {
      order: ["Google"],
      allow_fallbacks: true,
    };
  }
  return undefined;
}

interface ProviderPreferences {
  order: string[];
  allow_fallbacks: boolean;
}

interface AnthropicCacheableContentPart {
  type: "text";
  text: string;
  cache_control: { type: "ephemeral" };
}

function buildMessages(
  model: string,
  systemPrompt: string,
  userContent: string | OpenAI.Chat.Completions.ChatCompletionContentPart[]
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  let systemMessage: OpenAI.Chat.Completions.ChatCompletionMessageParam;
  if (isAnthropicModel(model)) {
    const cacheablePart: AnthropicCacheableContentPart = {
      type: "text",
      text: systemPrompt,
      cache_control: { type: "ephemeral" },
    };
    systemMessage = { role: "system", content: [cacheablePart] };
  } else {
    systemMessage = { role: "system", content: systemPrompt };
  }

  const userMessage: OpenAI.Chat.Completions.ChatCompletionMessageParam = { role: "user", content: userContent };

  return [systemMessage, userMessage];
}

async function nonStreamLLMResponse(
  model: string,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  signal?: AbortSignal,
  maxTokens: number = 4096
): Promise<LLMResult> {
  await llmSemaphore.acquire(signal);
  
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort("timeout"), NON_STREAM_TIMEOUT_MS);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal;

  const providerPrefs = getProviderPreferences(model);

  try {
    console.log(`[LLM] ${model}: using non-streaming mode (max_tokens=${maxTokens})`);
    const response = await openrouter.chat.completions.create({
      model,
      max_tokens: maxTokens,
      messages,
      ...(providerPrefs ? { provider: providerPrefs } : {}),
    }, { signal: combinedSignal });
    clearTimeout(timer);

    const msg = response.choices[0]?.message as OpenRouterMessage;
    const content = msg?.content || msg?.reasoning_content || '';
    const responseUsage = response.usage as OpenRouterUsage | undefined;
    const usage: LLMUsage = {
      promptTokens: responseUsage?.prompt_tokens || 0,
      completionTokens: responseUsage?.completion_tokens || 0,
      totalCost: responseUsage?.total_cost,
    };
    console.log(`[LLM] ${model} non-stream: ${content.length} chars, tokens: ${usage.promptTokens}in/${usage.completionTokens}out`);
    return { content: content || "No response generated.", usage };
  } catch (error: any) {
    clearTimeout(timer);
    if (signal?.aborted) {
      throw new Error("Request cancelled");
    }
    if (timeoutController.signal.aborted) {
      const timeoutError = new Error(`Request timed out for ${model} (no response within ${NON_STREAM_TIMEOUT_MS / 1000}s)`);
      (timeoutError as any).model = model;
      throw timeoutError;
    }
    throw error;
  } finally {
    llmSemaphore.release();
  }
}

async function streamLLMResponse(
  model: string,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  signal?: AbortSignal,
  maxTokens: number = 4096
): Promise<LLMResult> {
  if (shouldSkipStreaming(model)) {
    return nonStreamLLMResponse(model, messages, signal, maxTokens);
  }

  await llmSemaphore.acquire(signal);
  let semaphoreHeld = true;
  
  const inactivityController = new AbortController();
  let inactivityTimer = setTimeout(() => inactivityController.abort("inactivity_timeout"), INACTIVITY_TIMEOUT_MS);
  const combinedSignal = signal
    ? AbortSignal.any([signal, inactivityController.signal])
    : inactivityController.signal;

  const providerPrefs = getProviderPreferences(model);

  try {
    const stream = await openrouter.chat.completions.create({
      model,
      max_tokens: maxTokens,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(providerPrefs ? { provider: providerPrefs } : {}),
    }, { signal: combinedSignal });

    let result = '';
    let reasoningResult = '';
    let chunkCount = 0;
    let streamUsage: LLMUsage = { promptTokens: 0, completionTokens: 0 };
    for await (const chunk of stream) {
      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => inactivityController.abort("inactivity_timeout"), INACTIVITY_TIMEOUT_MS);
      chunkCount++;
      const choice = chunk.choices[0] as OpenRouterStreamChoice | undefined;
      const delta = choice?.delta;
      
      if (delta?.content) result += delta.content;
      if (delta?.reasoning_content) reasoningResult += delta.reasoning_content;
      if (delta?.reasoning) reasoningResult += delta.reasoning;
      
      if (choice?.message?.content) result += choice.message.content;
      if (choice?.text) result += choice.text;

      const chunkUsage = (chunk as unknown as { usage?: OpenRouterUsage }).usage;
      if (chunkUsage) {
        streamUsage = {
          promptTokens: chunkUsage.prompt_tokens || 0,
          completionTokens: chunkUsage.completion_tokens || 0,
          totalCost: chunkUsage.total_cost,
        };
      }
    }
    clearTimeout(inactivityTimer);
    
    console.log(`[LLM] ${model}: ${chunkCount} chunks, content=${result.length} chars, reasoning=${reasoningResult.length} chars`);
    
    if (chunkCount === 0) {
      console.log(`[LLM] ${model}: streaming returned 0 chunks, retrying with non-streaming`);
      llmSemaphore.release();
      semaphoreHeld = false;
      return nonStreamLLMResponse(model, messages, signal, maxTokens);
    }
    
    if (!result && reasoningResult) {
      console.log(`[LLM] Model ${model} returned reasoning tokens only, using as response`);
      return { content: reasoningResult, usage: streamUsage };
    }
    
    return { content: result || "No response generated.", usage: streamUsage };
  } catch (error: any) {
    clearTimeout(inactivityTimer);
    if (signal?.aborted) {
      throw new Error("Request cancelled");
    }
    if (inactivityController.signal.aborted) {
      const timeoutError = new Error(`Request timed out for ${model} (no activity for ${INACTIVITY_TIMEOUT_MS / 1000}s)`);
      (timeoutError as any).model = model;
      throw timeoutError;
    }
    throw error;
  } finally {
    if (semaphoreHeld) llmSemaphore.release();
  }
}

async function callLLM(model: string, prompt: string, systemPrompt: string = "You are a helpful assistant.", signal?: AbortSignal, maxTokens: number = 4096): Promise<LLMResult> {
  if (signal?.aborted) {
    throw new Error("Request cancelled");
  }
  
  console.log(`[LLM] Calling model: ${model}`);
  const messages = buildMessages(model, systemPrompt, prompt);

  let lastError: any = null;
  for (let attempt = 1; attempt <= LLM_MAX_RETRIES; attempt++) {
    try {
      if (signal?.aborted) throw new Error("Request cancelled");
      const result = await streamLLMResponse(model, messages, signal, maxTokens);
      console.log(`[LLM] Success from ${model}${attempt > 1 ? ` (attempt ${attempt})` : ''}`);
      return result;
    } catch (error: any) {
      lastError = error;
      if (error.message === "Request cancelled") {
        console.log(`[LLM CANCELLED] Request cancelled for ${model}`);
        throw error;
      }
      if (isRateLimitError(error)) {
        markModelRateLimited(model);
      }
      if (!isRetryableError(error) || attempt === LLM_MAX_RETRIES) {
        break;
      }
      const delay = isRateLimitError(error)
        ? LLM_RATE_LIMIT_DELAY_MS * attempt
        : LLM_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      const errorMessage = error.message?.includes('timed out') ? error.message : extractErrorMessage(error, model);
      console.log(`[LLM RETRY] Attempt ${attempt + 1}/${LLM_MAX_RETRIES} for ${model} after: ${errorMessage} (waiting ${delay}ms${isRateLimitError(error) ? ', rate-limit cooldown' : ''})`);
      await sleep(delay, signal);
    }
  }

  const errorMessage = lastError.message?.includes('timed out') ? lastError.message : extractErrorMessage(lastError, model);
  console.error(`[LLM ERROR] Model: ${model}, Error: ${errorMessage} (failed after ${LLM_MAX_RETRIES} attempts)`);
  const structuredError = new Error(errorMessage);
  (structuredError as any).model = model;
  (structuredError as any).originalError = lastError;
  (structuredError as any).isRateLimit = isRateLimitError(lastError);
  throw structuredError;
}

// Multimodal LLM call with image support for vision-capable models
type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

async function callLLMWithVision(
  model: string, 
  prompt: string, 
  imageUrls: string[], 
  systemPrompt: string = "You are a helpful assistant.",
  signal?: AbortSignal,
  maxTokens: number = 4096
): Promise<LLMResult> {
  if (signal?.aborted) {
    throw new Error("Request cancelled");
  }
  
  const hasVision = isVisionCapable(model);
  console.log(`[LLM Vision] Calling model: ${model} (vision: ${hasVision}, images: ${imageUrls.length})`);

  if (!hasVision && imageUrls.length > 0) {
    const noteAboutImages = `\n\n[Note: ${imageUrls.length} image(s) were attached. This model cannot see images, but vision-capable models in the council will analyze them.]`;
    return callLLM(model, prompt + noteAboutImages, systemPrompt, signal, maxTokens);
  }
  
  let base64Images: string[] = [];
  if (imageUrls.length > 0) {
    console.log(`[LLM Vision] Converting ${imageUrls.length} image(s) to base64 for ${model}...`);
    base64Images = await convertImagesToBase64(imageUrls);
    if (base64Images.length === 0) {
      console.error(`[LLM Vision] Failed to convert any images for ${model}`);
      const fallbackPrompt = prompt + `\n\n[Note: ${imageUrls.length} image(s) were attached but could not be loaded for analysis.]`;
      return callLLM(model, fallbackPrompt, systemPrompt, signal, maxTokens);
    }
    console.log(`[LLM Vision] Successfully converted ${base64Images.length}/${imageUrls.length} images for ${model}`);
  }

  const content: ContentPart[] = [{ type: "text", text: prompt }];
  for (const dataUri of base64Images) {
    content.push({ type: "image_url", image_url: { url: dataUri } });
  }
  const visionMessages = buildMessages(model, systemPrompt, content as OpenAI.Chat.Completions.ChatCompletionContentPart[]);

  let lastError: any = null;
  for (let attempt = 1; attempt <= LLM_MAX_RETRIES; attempt++) {
    try {
      if (signal?.aborted) throw new Error("Request cancelled");
      const result = await streamLLMResponse(model, visionMessages, signal, maxTokens);
      console.log(`[LLM Vision] Success from ${model}${attempt > 1 ? ` (attempt ${attempt})` : ''}`);
      return result;
    } catch (error: any) {
      lastError = error;
      if (error.message === "Request cancelled") throw error;
      if (isRateLimitError(error)) {
        markModelRateLimited(model);
      }
      if (!isRetryableError(error) || attempt === LLM_MAX_RETRIES) {
        break;
      }
      const delay = isRateLimitError(error)
        ? LLM_RATE_LIMIT_DELAY_MS * attempt
        : LLM_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      const errMsg = error.message?.includes('timed out') ? error.message : extractErrorMessage(error, model);
      console.log(`[LLM RETRY] Vision attempt ${attempt + 1}/${LLM_MAX_RETRIES} for ${model} after: ${errMsg} (waiting ${delay}ms${isRateLimitError(error) ? ', rate-limit cooldown' : ''})`);
      await sleep(delay, signal);
    }
  }

  const visionErrorMessage = lastError.message?.includes('timed out') ? lastError.message : extractErrorMessage(lastError, model);
  console.error(`[LLM ERROR] Vision failed for ${model}: ${visionErrorMessage} (after ${LLM_MAX_RETRIES} attempts)`);
  
  if (imageUrls.length > 0) {
    console.log(`[LLM] Retrying ${model} without images (text-only fallback)...`);
    try {
      const fallbackPrompt = prompt + `\n\n[Note: Image analysis failed for this model. ${imageUrls.length} image(s) were attached but could not be processed.]`;
      return await callLLM(model, fallbackPrompt, systemPrompt, signal, maxTokens);
    } catch (fallbackError: any) {
      if (fallbackError.message === "Request cancelled") throw fallbackError;
      const fallbackErrorMessage = fallbackError.message?.includes('timed out') ? fallbackError.message : extractErrorMessage(fallbackError, model);
      console.error(`[LLM ERROR] Fallback also failed for ${model}: ${fallbackErrorMessage}`);
      const structuredError = new Error(`Vision failed: ${visionErrorMessage}. Fallback also failed: ${fallbackErrorMessage}`);
      (structuredError as any).model = model;
      throw structuredError;
    }
  }
  
  const structuredError = new Error(visionErrorMessage);
  (structuredError as any).model = model;
  throw structuredError;
}

interface Attachment {
  name: string;
  url: string;
  type: string;
  size: number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\./i;

function cleanupAttachmentFiles(attachments?: Attachment[]): void {
  if (!attachments || attachments.length === 0) return;
  const uploadsRoot = path.resolve(process.cwd(), "uploads");
  for (const attachment of attachments) {
    try {
      const localPath = resolveLocalFilePath(attachment.url);
      if (!localPath) continue;
      const basename = path.basename(localPath);
      if (!UUID_PATTERN.test(basename)) continue;
      if (!localPath.startsWith(uploadsRoot + path.sep)) continue;
      if (fs.existsSync(localPath)) {
        fs.unlinkSync(localPath);
        console.log(`[CLEANUP] Deleted attachment file: ${basename}`);
      }
    } catch (err: any) {
      console.error(`[CLEANUP] Failed to delete attachment ${attachment.name}: ${err.message}`);
    }
  }
}

function estimateAttachmentTokensFromMetadata(attachments: Attachment[]): number {
  let total = 0;
  for (const a of attachments) {
    if (a.type.startsWith('image/')) {
      total += 1000;
    } else if (a.type === 'application/pdf') {
      const estimatedPages = Math.max(1, Math.ceil(a.size / 50000));
      total += estimatedPages * 500;
    } else {
      total += Math.ceil(a.size / 4);
    }
  }
  return total;
}

const PROCESS_TIMEOUT_MS = 10 * 60 * 1000;

async function processCouncilMessage(conversationId: number, userMessageId: number, prompt: string, previousContext?: string, attachments?: Attachment[], customModels?: string[], chairmanModel?: string, creditCost?: number, userId?: string) {
  const controller = createAbortController(userMessageId);
  const signal = controller.signal;
  const renderedImagePaths: string[] = [];
  const totalUsage: { stage: string; model: string; promptTokens: number; completionTokens: number; apiCostDollars: number }[] = [];

  function trackUsage(modelId: string, usage: LLMUsage, stage: string, maxTokens?: number) {
    const model = getModelById(modelId);
    if (!model) return;
    const calculatedCost = (usage.promptTokens * model.apiCostInput + usage.completionTokens * model.apiCostOutput) / 1_000_000;
    const cost = usage.totalCost ?? calculatedCost;
    totalUsage.push({ stage, model: modelId, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, apiCostDollars: cost });
    const utilRatio = maxTokens && usage.completionTokens > 0 ? (usage.completionTokens / maxTokens).toFixed(2) : 'n/a';
    const costSource = usage.totalCost != null ? 'openrouter' : 'calculated';
    const drift = usage.totalCost != null && calculatedCost > 0 ? ` (calc=$${calculatedCost.toFixed(4)}, drift=${((cost - calculatedCost) / calculatedCost * 100).toFixed(1)}%)` : '';
    console.log(`[USAGE] ${stage} ${modelId}: ${usage.promptTokens} prompt, ${usage.completionTokens} completion, UTIL=${utilRatio}${maxTokens ? `/${maxTokens}` : ''}, cost=$${cost.toFixed(4)} [${costSource}]${drift}`);
  }

  let processTimedOut = false;
  const processTimer = setTimeout(() => {
    processTimedOut = true;
    console.error(`[TIMEOUT] Council deliberation for conversation ${conversationId} (message ${userMessageId}) exceeded ${PROCESS_TIMEOUT_MS / 1000}s — aborting`);
    controller.abort("process_timeout");
  }, PROCESS_TIMEOUT_MS);
  
  try {
    const initialResponses: { model: string; content: string }[] = [];
    const peerReviews: { model: string; content: string }[] = [];
    
    const contextPrefix = previousContext 
      ? `<previous_deliberation_summary>
${previousContext}
</previous_deliberation_summary>

<instruction>Build on the previous deliberation. Do not repeat settled points. Focus on what is new or unresolved.</instruction>

<user_followup>` 
      : "";
    const contextSuffix = previousContext ? `</user_followup>` : "";
    
    // Process attachments - separate images from other files
    const baseUrl = process.env.REPLIT_DEV_DOMAIN 
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : process.env.REPLIT_DOMAINS
      ? `https://${process.env.REPLIT_DOMAINS.split(',')[0]}`
      : 'http://localhost:5000';
    
    const imageUrls: string[] = [];
    const nonImageAttachments: Attachment[] = [];
    
    if (attachments && attachments.length > 0) {
      for (const attachment of attachments) {
        const absoluteUrl = attachment.url.startsWith('http') ? attachment.url : `${baseUrl}${attachment.url}`;
        if (attachment.type.startsWith('image/')) {
          imageUrls.push(absoluteUrl);
        } else {
          nonImageAttachments.push({ ...attachment, url: absoluteUrl });
        }
      }
    }
    
    const MAX_TOTAL_CONTEXT = 200000;
    const MAX_TOTAL_RENDERED_IMAGES = 15;

    const EXTRACTION_BATCH_SIZE = 4;
    const extractedDocs: { attachment: typeof nonImageAttachments[0]; text: string | null; renderedAsImages: boolean }[] = [];
    if (nonImageAttachments.length > 0) {
      const extractionResults: { attachment: typeof nonImageAttachments[0]; text: string | null; localImageUrls: string[]; localRenderedPaths: string[]; localPath: string | null }[] = [];
      for (let i = 0; i < nonImageAttachments.length; i += EXTRACTION_BATCH_SIZE) {
        const batch = nonImageAttachments.slice(i, i + EXTRACTION_BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(async (a) => {
            const localPath = resolveLocalFilePath(a.url);
            let text: string | null = null;
            const localRenderedPaths: string[] = [];
            const localImageUrls: string[] = [];
            if (localPath) {
              text = await extractTextFromFile(localPath, a.type);
            }
            return { attachment: a, text, localImageUrls, localRenderedPaths, localPath };
          })
        );
        extractionResults.push(...batchResults);
      }

      let totalRenderedImages = 0;
      for (const result of extractionResults) {
        if (!result.text && result.attachment.type === "application/pdf" && result.localPath) {
          if (totalRenderedImages < MAX_TOTAL_RENDERED_IMAGES) {
            const remainingBudget = MAX_TOTAL_RENDERED_IMAGES - totalRenderedImages;
            const rendered = renderPdfToImages(result.localPath);
            const usable = rendered.slice(0, remainingBudget);
            const excess = rendered.slice(remainingBudget);
            for (const imgPath of excess) {
              try { fs.unlinkSync(imgPath); } catch {}
            }
            if (usable.length > 0) {
              for (const imgPath of usable) {
                result.localImageUrls.push(imgPath);
                result.localRenderedPaths.push(imgPath);
              }
              totalRenderedImages += usable.length;
            }
          }
        }
        imageUrls.push(...result.localImageUrls);
        renderedImagePaths.push(...result.localRenderedPaths);
        const renderedAsImages = result.localRenderedPaths.length > 0;
        extractedDocs.push({ attachment: result.attachment, text: result.text, renderedAsImages });
      }

      const textsWithContent = extractedDocs.filter(d => d.text);
      const totalChars = textsWithContent.reduce((sum, d) => sum + (d.text?.length || 0), 0);
      if (totalChars > MAX_TOTAL_CONTEXT && textsWithContent.length > 0) {
        const budgetPerFile = Math.floor(MAX_TOTAL_CONTEXT / textsWithContent.length);
        console.log(`[CONTEXT] Total ${totalChars} chars exceeds ${MAX_TOTAL_CONTEXT} limit. Distributing ${budgetPerFile} chars/file across ${textsWithContent.length} files.`);
        for (const doc of textsWithContent) {
          if (doc.text && doc.text.length > budgetPerFile) {
            doc.text = doc.text.slice(0, budgetPerFile) + `\n\n[... Truncated to ${budgetPerFile} chars to fit context budget. Full document is ${doc.text.length} chars.]`;
          }
        }
      }
    }

    const hasImages = imageUrls.length > 0;
    const hasNonImageFiles = nonImageAttachments.length > 0;

    let documentContext = "";
    if (hasNonImageFiles) {
      for (const { attachment: a, text, renderedAsImages } of extractedDocs) {
        if (text) {
          documentContext += `\n[DOCUMENT: ${a.name}]\n${text}\n[END DOCUMENT]\n`;
        } else if (renderedAsImages) {
          documentContext += `- ${a.name}: This PDF contains visual/graphic content. Its pages have been rendered as images for you to analyze visually.\n`;
        } else {
          const sizeKB = Math.round(a.size / 1024);
          documentContext += `- ${a.name} (${a.type}, ${sizeKB}KB): ${a.url}\n`;
        }
      }
    }

    const councilModelsForContext = customModels && customModels.length === 3 ? customModels : DEFAULT_COUNCIL_MODELS;
    const selectedChairmanForContext = chairmanModel || DEFAULT_CHAIRMAN_MODEL;
    const allModelIds = [...councilModelsForContext, selectedChairmanForContext];
    const smallestContextWindow = Math.min(...allModelIds.map(id => getModelContextWindow(id)));
    const maxPromptChars = Math.floor(smallestContextWindow * 0.75 * 4);
    const basePromptLength = (contextPrefix + prompt).length;
    if (documentContext.length > 0 && basePromptLength + documentContext.length > maxPromptChars) {
      const availableForDocs = maxPromptChars - basePromptLength - 500;
      if (availableForDocs > 0 && documentContext.length > availableForDocs) {
        const limitingModel = allModelIds.reduce((a, b) => getModelContextWindow(a) <= getModelContextWindow(b) ? a : b);
        console.log("[CONTEXT] Truncated document context to fit model context window: " + limitingModel);
        documentContext = documentContext.slice(0, availableForDocs) + "\n\n[... Document context truncated to fit model context window.]";
      }
    }

    let attachmentContext = "";
    if (hasImages || hasNonImageFiles) {
      attachmentContext = "\n\n[ATTACHED FILES]\n";
      if (hasImages) {
        attachmentContext += `- ${imageUrls.length} image(s) attached. Please analyze the image(s) carefully and describe what you see.\n`;
      }
      attachmentContext += documentContext;
    }
    
    // Build prompts for vision vs text-only models
    const visionPrompt = contextPrefix + prompt + contextSuffix + attachmentContext;
    
    // For text-only models: include non-image attachments + note about vision limitations
    let textOnlyAttachmentContext = "";
    if (hasNonImageFiles) {
      textOnlyAttachmentContext = "\n\n[ATTACHED FILES]\n" + documentContext;
    }
    if (hasImages) {
      textOnlyAttachmentContext += `\n[Note: The user has attached ${imageUrls.length} image(s), but you do not have vision capabilities. The other council members with vision will describe the images. Please respond to the text query as best you can.]\n`;
    }
    
    const textOnlyPrompt = contextPrefix + prompt + contextSuffix + textOnlyAttachmentContext;
    
    // Use custom models or defaults
    const councilModels = customModels && customModels.length === 3 ? customModels : DEFAULT_COUNCIL_MODELS;
    
    console.log(`[COUNCIL DEBUG] Starting initial stage with ${councilModels.length} models`);
    console.log(`[COUNCIL DEBUG] Has images: ${hasImages}, Image URLs: ${JSON.stringify(imageUrls)}`);
    
    // Progressive Pipeline: Models start reviewing as soon as peers finish.
    // Instead of waiting for all Stage 1 to complete before any Stage 2 begins,
    // each model starts its review as soon as at least 1 other model has responded.
    // Trade-off: early-starting reviewers may only see a subset of peers (e.g., model B
    // finishes 2nd, reviews only model A, misses model C). This is acceptable because:
    // 1. The deferred first-finisher always reviews all peers
    // 2. The last finisher always reviews all peers
    // 3. The Chairman synthesis receives ALL initial responses + ALL reviews regardless
    const failedModels: string[] = [];
    const usedFallbacks = new Set<string>();
    const reviewPromises: Promise<void>[] = [];
    const reviewStarted = new Set<string>();
    
    const truncateForReview = (text: string): string => {
      const baseLimit = 3000;
      const maxLimit = 6000;
      const dynamicLimit = Math.min(maxLimit, Math.max(baseLimit, Math.floor(text.length * 0.8)));
      if (text.length <= dynamicLimit) return text;
      const keepStart = Math.floor(dynamicLimit * 0.6);
      const keepEnd = Math.floor(dynamicLimit * 0.35);
      return text.slice(0, keepStart) + '\n\n... [middle truncated for review brevity] ...\n\n' + text.slice(text.length - keepEnd);
    };

    const startReview = async (reviewerModel: string) => {
      const otherResponses = initialResponses.filter(r => r.model !== reviewerModel);
      if (otherResponses.length === 0) {
        console.log(`[REVIEW] ${reviewerModel} skipping review - no other responses available`);
        return;
      }
      
      const reviewSystemPrompt = "You are a cross-examiner on an AI Council. Your job is to stress-test your colleagues' reasoning through rigorous critique. Every review MUST contain at least one substantive disagreement — if you cannot find a factual error, challenge an assumption, framing, or omission. You are also responsible for auditing factual claims: flag anything that may be incorrect, unverifiable, or outdated. Do not be polite at the expense of being useful. Use direct language and quote specific claims you're challenging.";
      
      const reviewPrompt = `You MUST address each of the following:

1. **Strongest Disagreement**: Identify the strongest claim from a peer that you believe is wrong or incomplete. Quote the specific claim and explain why you disagree.

2. **Factual Audit**: Flag any specific factual claims from peers that may be incorrect, unverifiable, or outdated. Cite the claim, name the source issue, and state what the correct or verifiable position is.

3. **Weakest Shared Assumption**: Identify one assumption that ALL responses take for granted that may be wrong. Focus on unstated premises, not obvious gaps.

4. **Forced Endorsement**: If you had to endorse one peer's response as the best, which would it be — and what does it still get wrong?

Be specific. Quote actual text from peer responses. Vague agreement adds no value.

User Query: "${prompt}"

Your colleagues' responses:

${otherResponses.map(r => `[${r.model}]: ${truncateForReview(r.content)}`).join("\n\n")}`;

      let effectiveModel = reviewerModel;
      if (isModelRateLimited(reviewerModel)) {
        const proactiveFallbacks = (MODEL_FALLBACKS[reviewerModel] || []).filter(fb =>
          !councilModels.includes(fb) && !failedModels.includes(fb) && !usedFallbacks.has(fb) && !isModelRateLimited(fb)
        );
        if (proactiveFallbacks.length > 0) {
          effectiveModel = proactiveFallbacks[0];
          usedFallbacks.add(effectiveModel);
          console.log(`[REVIEW] ${reviewerModel} is rate-limited, proactively using ${effectiveModel} instead`);
        }
      }

      try {
        console.log(`[REVIEW] ${effectiveModel} starting review of ${otherResponses.length} responses`);
        
        const reviewResult = await callLLM(
          effectiveModel, 
          reviewPrompt, 
          reviewSystemPrompt,
          signal,
          2048
        );
        trackUsage(effectiveModel, reviewResult.usage, 'S2-review', 2048);
        
        await storage.createCouncilResponse({
          messageId: userMessageId,
          model: effectiveModel,
          content: reviewResult.content,
          stage: "review",
          ...(effectiveModel !== reviewerModel ? { substitutedFor: reviewerModel } : {})
        });
        peerReviews.push({ model: effectiveModel, content: reviewResult.content });
      } catch (modelError: any) {
        if (signal.aborted) return;
        const errorMessage = modelError.message || "Unknown error";
        console.error(`[LLM ERROR] ${effectiveModel} failed in review stage: ${errorMessage}`);
        
        const reviewFallbacks = (MODEL_FALLBACKS[reviewerModel] || []).filter(fb =>
          fb !== effectiveModel && !councilModels.includes(fb) && !failedModels.includes(fb) && !usedFallbacks.has(fb) && !isModelRateLimited(fb)
        );
        
        for (const fallbackModel of reviewFallbacks) {
          if (signal.aborted) return;
          try {
            usedFallbacks.add(fallbackModel);
            console.log(`[REVIEW FALLBACK] Trying ${fallbackModel} as substitute for failed ${reviewerModel} review`);
            const fbReviewResult = await callLLM(
              fallbackModel,
              reviewPrompt,
              reviewSystemPrompt,
              signal,
              2048
            );
            trackUsage(fallbackModel, fbReviewResult.usage, 'S2-review', 2048);
            await storage.createCouncilResponse({
              messageId: userMessageId,
              model: fallbackModel,
              content: fbReviewResult.content,
              stage: "review",
              substitutedFor: reviewerModel
            });
            peerReviews.push({ model: fallbackModel, content: fbReviewResult.content });
            console.log(`[REVIEW FALLBACK] ${fallbackModel} succeeded as substitute for ${reviewerModel} review`);
            return;
          } catch (fbError: any) {
            if (signal.aborted) return;
            console.error(`[REVIEW FALLBACK] ${fallbackModel} also failed: ${(fbError as any).message || "Unknown error"}`);
          }
        }
        
        await storage.createCouncilResponse({
          messageId: userMessageId,
          model: reviewerModel,
          content: "",
          stage: "review",
          error: errorMessage
        });
      }
    };

    const EPISTEMIC_STANCES = [
      {
        role: "First Principles Analyst",
        prompt: `You are the First Principles Analyst on an AI Council. Your job is to deconstruct assumptions and challenge the question's framing before answering.

Your response MUST include:
1. **Thesis**: Your core position on the query
2. **Assumptions**: What assumptions underlie both the question and your answer
3. **Strongest Alternative**: The best competing view — even if you disagree
4. **Failure Modes**: How your recommendation could go wrong
5. **Confidence**: Your confidence level (Low / Medium / High) with a one-line justification

If you agree with what a typical AI would say, you're not adding value. Dig deeper. Challenge the premise. Be comprehensive but concise — cover every point the user raises. For multi-part questions, address each part.`
      },
      {
        role: "Pragmatic Implementer",
        prompt: `You are the Pragmatic Implementer on an AI Council. Your job is to focus on what actually works in practice and call out theory that fails in the real world.

Your response MUST include:
1. **Thesis**: Your practical recommendation
2. **Assumptions**: What real-world conditions must hold for your advice to work
3. **Strongest Alternative**: The best competing approach — even if less practical
4. **Failure Modes**: What breaks in implementation, not just in theory
5. **Confidence**: Your confidence level (Low / Medium / High) with a one-line justification

If you agree with what a typical AI would say, you're not adding value. Ground everything in practice. Be comprehensive but concise — cover every point the user raises. For multi-part questions, address each part.`
      },
      {
        role: "Evidence Auditor",
        prompt: `You are the Evidence Auditor on an AI Council. Your job is to audit factual claims made in the question, flag potential hallucination risk, identify where confidence outstrips evidence, and check whether cited mechanisms or precedents actually hold.

Your response MUST include:
1. **Thesis**: Your evidence-based position on the query, grounded in what can actually be verified
2. **Assumptions**: What factual claims in the question are assumed true but may not be — and what claims your own answer rests on
3. **Strongest Alternative**: The best competing interpretation of the evidence — even if you find it less well-supported
4. **Failure Modes**: Where the evidence is thin, outdated, or could be misinterpreted — and how that could derail your recommendation
5. **Confidence**: Your confidence level (Low / Medium / High) with a one-line justification tied to evidence quality

If you can't find anything to verify or challenge, you're not adding value. Scrutinize every claim. Be comprehensive but concise — cover every point the user raises. For multi-part questions, address each part.`
      }
    ];

    // Stage 1 + Progressive Stage 2: Each model generates initial response,
    // then immediately starts reviewing once at least 1 other model has finished
    await Promise.all(councilModels.map(async (model, modelIndex) => {
      const stance = EPISTEMIC_STANCES[modelIndex % EPISTEMIC_STANCES.length];
      
      let activeModel = model;
      if (isModelRateLimited(model)) {
        const proactiveFallbacks = (MODEL_FALLBACKS[model] || []).filter(fb =>
          !councilModels.includes(fb) && !failedModels.includes(fb) && !usedFallbacks.has(fb) && !isModelRateLimited(fb)
        );
        if (proactiveFallbacks.length > 0) {
          activeModel = proactiveFallbacks[0];
          usedFallbacks.add(activeModel);
          console.log(`[COUNCIL] ${model} is rate-limited, proactively using ${activeModel} (${stance.role} stance)`);
        }
      }
      
      try {
        const modelHasVision = isVisionCapable(activeModel);
        const modelPrompt = modelHasVision ? visionPrompt : textOnlyPrompt;
        
        console.log(`[COUNCIL DEBUG] Model ${activeModel}: hasVision=${modelHasVision}, willUseVision=${modelHasVision && hasImages}, stance=${stance.role}`);
        
        const visionAddendum = (modelHasVision && hasImages) 
          ? " If images are attached, analyze them carefully and incorporate visual analysis into your response."
          : "";
        const councilSystemPrompt = stance.prompt + visionAddendum;
        const s1Result = (modelHasVision && hasImages)
          ? await callLLMWithVision(activeModel, modelPrompt, imageUrls, councilSystemPrompt, signal, 2500)
          : await callLLM(activeModel, modelPrompt, councilSystemPrompt, signal, 2500);
        trackUsage(activeModel, s1Result.usage, 'S1-initial', 2500);
        
        await storage.createCouncilResponse({
          messageId: userMessageId,
          model: activeModel,
          content: s1Result.content,
          stage: "initial",
          ...(activeModel !== model ? { substitutedFor: model } : {})
        });
        initialResponses.push({ model: activeModel, content: s1Result.content });
        
        console.log(`[COUNCIL] ${activeModel} finished initial response (${initialResponses.length}/${councilModels.length} done)`);
        
        if (initialResponses.filter(r => r.model !== activeModel).length > 0) {
          reviewStarted.add(activeModel);
          reviewPromises.push(startReview(activeModel));
        }
      } catch (modelError: any) {
        if (signal.aborted) return;
        const errorMessage = modelError.message || "Unknown error";
        console.error(`[LLM ERROR] ${activeModel} failed in initial stage: ${errorMessage}`);
        
        const fallbacks = (MODEL_FALLBACKS[model] || []).filter(fb => 
          !councilModels.includes(fb) && !failedModels.includes(fb) && !usedFallbacks.has(fb)
        );
        
        let substituted = false;
        for (const fallbackModel of fallbacks) {
          if (signal.aborted) return;
          try {
            usedFallbacks.add(fallbackModel);
            console.log(`[FALLBACK] Trying ${fallbackModel} as substitute for failed ${model} (inheriting ${stance.role} stance)`);
            const fbHasVision = isVisionCapable(fallbackModel);
            const fbPrompt = fbHasVision ? visionPrompt : textOnlyPrompt;
            const fbVisionAddendum = (fbHasVision && hasImages)
              ? " If images are attached, analyze them carefully and incorporate visual analysis into your response."
              : "";
            const fbSystemPrompt = stance.prompt + fbVisionAddendum;
            const fbResult = (fbHasVision && hasImages)
              ? await callLLMWithVision(fallbackModel, fbPrompt, imageUrls, fbSystemPrompt, signal, 2500)
              : await callLLM(fallbackModel, fbPrompt, fbSystemPrompt, signal, 2500);
            trackUsage(fallbackModel, fbResult.usage, 'S1-initial', 2500);
            
            await storage.createCouncilResponse({
              messageId: userMessageId,
              model: fallbackModel,
              content: fbResult.content,
              stage: "initial",
              substitutedFor: model
            });
            initialResponses.push({ model: fallbackModel, content: fbResult.content });
            console.log(`[FALLBACK] ${fallbackModel} succeeded as substitute for ${model} (${initialResponses.length}/${councilModels.length} done)`);
            substituted = true;
            
            if (initialResponses.filter(r => r.model !== fallbackModel).length > 0) {
              reviewStarted.add(fallbackModel);
              reviewPromises.push(startReview(fallbackModel));
            }
            break;
          } catch (fbError: any) {
            if (signal.aborted) return;
            console.error(`[FALLBACK] ${fallbackModel} also failed: ${(fbError as any).message || "Unknown error"}`);
            failedModels.push(fallbackModel);
          }
        }
        
        if (!substituted) {
          failedModels.push(model);
          await storage.createCouncilResponse({
            messageId: userMessageId,
            model,
            content: "",
            stage: "initial",
            error: errorMessage
          });
        }
      }
    }));
    
    if (signal.aborted) throw new Error("Request cancelled");
    
    // Start deferred reviews for models that finished before any peers were available
    for (const response of initialResponses) {
      if (!reviewStarted.has(response.model)) {
        const otherResponses = initialResponses.filter(r => r.model !== response.model);
        if (otherResponses.length > 0) {
          console.log(`[REVIEW] ${response.model} was first to finish, starting deferred review`);
          reviewStarted.add(response.model);
          reviewPromises.push(startReview(response.model));
        }
      }
    }
    
    // Wait for all reviews to complete
    await Promise.all(reviewPromises);
    
    // Check if cancelled before chairman synthesis
    if (signal.aborted) throw new Error("Request cancelled");
    
    // Stage 3: Chairman Synthesis - anti-averaging verdict with peer reviews and images
    const allContext = `Based on both the initial opinions AND the cross-examination, deliver your verdict. You MUST address every question or topic the user raised — do not skip any.

IMPORTANT: If the user's query asks you to PRODUCE or CREATE something (a prompt, plan, code, document, template, etc.), you MUST include that complete deliverable first under a "## Deliverable" header before the analytical sections. Synthesize the best elements from the council into a polished, ready-to-use output.

Your verdict MUST follow this structure:
1. **Decision & Rationale**: Take a clear position. Do NOT average the council members' views — choose the strongest position and explain why. If the user asked multiple questions, give each one a clear decision.
2. **Dissent Notes**: Summarize the strongest opposing view from the council that you did NOT adopt, and why it fell short.
3. **Conditions for Reversal**: Under what specific conditions would the opposing view become correct? Include what specific evidence or information, if available, would most change your recommendation.
4. **Confidence**: State your overall confidence (Low / Medium / High) with calibrated operational meaning (e.g., "High — directionally correct ~90% of the time", "Medium — directionally correct ~70% of the time", "Low — better than a coin flip but not by much").
5. **Actionable Implication**: What should the user concretely do with this verdict? Give a specific next step, decision, or action — not a restatement of the rationale.

Use markdown formatting: headers for sections, **bold** for key conclusions, bullet points for actions, code blocks for technical content.${hasImages ? ' Ensure your verdict accurately reflects what is shown in the attached images.' : ''}

User Query: "${prompt}"
${hasImages ? `\n[Note: The user attached ${imageUrls.length} image(s) which you can see. Please verify and incorporate visual analysis in your synthesis.]\n` : ''}
STAGE 1 — Initial Answers from Council Members:
${initialResponses.map(r => `[${r.model}]: ${r.content}`).join("\n\n")}

STAGE 2 — Cross-Examination (each member challenging the others):
${peerReviews.map(r => `[${r.model}'s Cross-Examination]: ${r.content}`).join("\n\n")}`;

    // Use selected chairman model or fall back to default, with rate-limit awareness
    let selectedChairman = chairmanModel || DEFAULT_CHAIRMAN_MODEL;
    if (isModelRateLimited(selectedChairman)) {
      const chairmanFallbacks = (MODEL_FALLBACKS[selectedChairman] || []).filter(fb =>
        !isModelRateLimited(fb)
      );
      if (chairmanFallbacks.length > 0) {
        console.log(`[CHAIRMAN] ${selectedChairman} is rate-limited, proactively using ${chairmanFallbacks[0]} instead`);
        selectedChairman = chairmanFallbacks[0];
      }
    }
    const chairmanHasVision = isVisionCapable(selectedChairman);
    
    const chairmanSystemPrompt = `You are the Chairman of the AI Council. You deliver decisive verdicts — not diplomatic summaries. Your job is to pick the strongest position from the council debate and defend it, while acknowledging dissent honestly.

Rules:
- DELIVERABLE-FIRST RULE: If the user asked you to PRODUCE something (a prompt, plan, code, document, template, outline, script, configuration, etc.), your verdict MUST include that deliverable in full — not just advice about it. Present the complete deliverable first under a "## Deliverable" header, then follow with the 5-section analysis. The deliverable should synthesize the best elements from the council's responses into a single, polished output that the user can immediately use.
- NEVER average or blend opinions. Choose a side and justify it.
- Exception: If the question is a design or optimization problem with multiple legitimate constraints, you may construct a composite answer — but you must explicitly identify which constraint came from which council member and justify each inclusion. You are building from parts, not averaging across wholes.
- If council members agreed, say so briefly and focus on adding what they missed.
- If they disagreed, pick the winner and explain why the loser lost.
- Cover every question the user raised — no exceptions. Breadth over depth.
- You MUST complete ALL 5 verdict sections (Decision & Rationale, Dissent Notes, Conditions for Reversal, Confidence, Actionable Implication). Never stop mid-section. If space is tight, compress each section rather than omitting any.
- CRITICAL OUTPUT BUDGET: You have approximately 3,500 tokens of output space. Plan your response so that all 5 sections fit within roughly 3,200 tokens, reserving the final ~300 tokens as a wrap-up zone. When you sense you are running low on space, immediately begin wrapping up with a brief closing that summarizes your key recommendation. Never end mid-sentence or mid-section — compress earlier sections rather than risking an incomplete ending.
- Use markdown: ## headers for major sections, **bold** for key conclusions, bullet points for actions.${chairmanHasVision && hasImages ? '\n- You can see the attached images. Incorporate visual analysis into your verdict.' : ''}`;

    const CHAIRMAN_MAX_TOKENS = 3500;
    let finalContent: string = "";
    try {
      const chairResult = (chairmanHasVision && hasImages)
        ? await callLLMWithVision(selectedChairman, allContext, imageUrls, chairmanSystemPrompt, signal, CHAIRMAN_MAX_TOKENS)
        : await callLLM(selectedChairman, allContext, chairmanSystemPrompt, signal, CHAIRMAN_MAX_TOKENS);
      finalContent = chairResult.content;
      trackUsage(selectedChairman, chairResult.usage, 'S3-chairman', CHAIRMAN_MAX_TOKENS);
    } catch (chairmanError: any) {
      if (chairmanError.message === "Request cancelled") throw chairmanError;
      console.error(`[CHAIRMAN] ${selectedChairman} failed: ${chairmanError.message}`);
      
      const originalChairman = chairmanModel || DEFAULT_CHAIRMAN_MODEL;
      const chairmanFallbacks = (MODEL_FALLBACKS[originalChairman] || []).filter(fb =>
        fb !== selectedChairman && !isModelRateLimited(fb)
      );
      
      let recovered = false;
      for (const fbModel of chairmanFallbacks) {
        if (signal.aborted) throw new Error("Request cancelled");
        try {
          console.log(`[CHAIRMAN FALLBACK] Trying ${fbModel} as substitute for failed ${selectedChairman}`);
          const fbHasVision = isVisionCapable(fbModel);
          const fbSystemPrompt = chairmanSystemPrompt.replace(
            chairmanHasVision && hasImages ? '- You can see the attached images. Incorporate visual analysis into your verdict.' : '',
            fbHasVision && hasImages ? '- You can see the attached images. Incorporate visual analysis into your verdict.' : ''
          );
          const fbChairResult = (fbHasVision && hasImages)
            ? await callLLMWithVision(fbModel, allContext, imageUrls, fbSystemPrompt, signal, CHAIRMAN_MAX_TOKENS)
            : await callLLM(fbModel, allContext, fbSystemPrompt, signal, CHAIRMAN_MAX_TOKENS);
          finalContent = fbChairResult.content;
          trackUsage(fbModel, fbChairResult.usage, 'S3-chairman', CHAIRMAN_MAX_TOKENS);
          console.log(`[CHAIRMAN FALLBACK] ${fbModel} succeeded as chairman substitute`);
          recovered = true;
          break;
        } catch (fbError: any) {
          if (fbError.message === "Request cancelled") throw fbError;
          console.error(`[CHAIRMAN FALLBACK] ${fbModel} also failed: ${fbError.message}`);
        }
      }
      
      if (!recovered) throw chairmanError;
    }
    
    // Create chairman message
    await storage.createMessage({
      conversationId,
      role: "chairman",
      content: finalContent,
      status: "complete"
    });

    await storage.updateMessageStatus(userMessageId, "complete");
    await storage.updateConversationStatus(conversationId, "complete");

    const totalApiCostDollars = totalUsage.reduce((sum, u) => sum + u.apiCostDollars, 0);
    const totalPromptTokens = totalUsage.reduce((sum, u) => sum + u.promptTokens, 0);
    const totalCompletionTokens = totalUsage.reduce((sum, u) => sum + u.completionTokens, 0);
    const stageBreakdown = ['S1-initial', 'S2-review', 'S3-chairman', 'summary'].map(stage => {
      const stageEntries = totalUsage.filter(u => u.stage === stage);
      if (stageEntries.length === 0) return null;
      const stagePrompt = stageEntries.reduce((s, u) => s + u.promptTokens, 0);
      const stageCompletion = stageEntries.reduce((s, u) => s + u.completionTokens, 0);
      const stageCost = stageEntries.reduce((s, u) => s + u.apiCostDollars, 0);
      return `${stage}(${stageEntries.length}calls,${stagePrompt}in/${stageCompletion}out,$${stageCost.toFixed(4)})`;
    }).filter(Boolean).join(' | ');
    console.log(`[USAGE] Debate #${conversationId}: ${totalUsage.length} calls, ${totalPromptTokens} prompt tokens, ${totalCompletionTokens} completion tokens, actual API cost $${totalApiCostDollars.toFixed(4)}`);
    console.log(`[USAGE] Debate #${conversationId} breakdown: ${stageBreakdown}`);

    try {
      const prevConv = await storage.getConversation(conversationId);
      const previousApiCost = parseFloat(prevConv?.actualApiCost || '0');
      await storage.updateConversationApiCost(conversationId, totalApiCostDollars);
      await storage.updateConversationTokens(conversationId, totalPromptTokens, totalCompletionTokens);
      const costDelta = totalApiCostDollars - previousApiCost;
      if (userId && costDelta > 0) {
        await storage.incrementUserApiCost(userId, costDelta);
      }
    } catch (apiCostErr: any) {
      console.error(`[USAGE] Error storing API cost for debate #${conversationId}:`, apiCostErr.message);
    }

    if (creditCost && userId) {
      try {
        const conv = await storage.getConversation(conversationId);
        const reservedAmount = conv?.reservedCredits || creditCost;
        const actualCost = conv?.estimatedCredits || creditCost;
        const refundAmount = reservedAmount - actualCost;
        if (refundAmount > 0) {
          await storage.refundDebateCredits(userId, refundAmount, `Settlement for debate #${conversationId}: reserved ${reservedAmount}, charged ${actualCost}, refunded ${refundAmount}`, conversationId);
          console.log(`[SETTLE] Debate #${conversationId}: reserved=${reservedAmount}, actual=${actualCost}, refund=${refundAmount}`);
        }
        await storage.settleConversation(conversationId, actualCost);
        refreshDebateCostSummary().catch(err => console.error(`[COST_SUMMARY] Error refreshing:`, err.message));
      } catch (settleErr: any) {
        console.error(`[SETTLE] Error settling debate #${conversationId}:`, settleErr.message);
      }
    }

    if (previousContext) {
      try {
        const updatedConv = await storage.getConversation(conversationId);
        if (updatedConv && updatedConv.messages.length >= 4) {
          const allMessages = updatedConv.messages
            .map(m => `${m.role === 'user' ? 'User' : 'Chairman'}: ${m.content}`)
            .join("\n\n");
          if (allMessages.length > 2000) {
            const summaryModel = "openai/gpt-4o-mini";
            const summaryResult = await callLLM(
              summaryModel,
              `Compress the following AI Council deliberation into a structured summary for use as context in follow-up questions. Preserve disagreements and open questions. Omit redundant agreement.

Conversation:
${allMessages}

Output format:
<decisions>[Bullet list of conclusions reached]</decisions>
<contested_points>[Points where council members disagreed — include both sides]</contested_points>
<caveats>[Important qualifications or conditions mentioned]</caveats>
<open_questions>[Unresolved questions or areas needing more information]</open_questions>`,
              "You are a precision summarizer for an AI Council. Your summary will be used as context for follow-up questions. Preserve: (1) all decisions made, (2) contested points with both sides, (3) caveats and conditions, (4) open questions. Discard: redundant agreement, pleasantries, repeated points. Target ~1500 tokens.",
              signal
            );
            trackUsage(summaryModel, summaryResult.usage, 'summary');
            await storage.updateConversationSummary(conversationId, summaryResult.content);
            console.log(`[SUMMARIZE] Generated context summary for debate #${conversationId} (${summaryResult.content.length} chars)`);
          }
        }
      } catch (sumErr: any) {
        console.error(`[SUMMARIZE] Error generating summary for debate #${conversationId}:`, sumErr.message);
      }
    }
    
    clearTimeout(processTimer);
    clearMessageController(userMessageId);
    cleanupRenderedImages(renderedImagePaths);
    // Note: attachment files are NOT cleaned up here so follow-up questions
    // can still reference them. They are cleaned up when the conversation is deleted.

  } catch (error: any) {
    clearTimeout(processTimer);
    if (processTimedOut) {
      console.error(`[TIMEOUT] Council deliberation timed out for conversation ${conversationId} (message ${userMessageId})`);
      await storage.updateMessageStatus(userMessageId, "error");
      await storage.updateConversationStatus(conversationId, "error", "Deliberation timed out — processing took too long");
      if (creditCost && userId) {
        try {
          const conv = await storage.getConversation(conversationId);
          const refundAmount = conv?.reservedCredits || creditCost;
          await storage.refundDebateCredits(userId, refundAmount, `Deliberation timed out (debate #${conversationId})`, conversationId);
          console.log(`[REFUND] Timed-out debate #${conversationId}: refunded ${refundAmount} credits`);
        } catch (refundErr: any) {
          console.error(`[REFUND] Error refunding timed-out debate #${conversationId}:`, refundErr.message);
        }
      }
    } else if (error.message === "Request cancelled" || signal.aborted) {
      console.log(`[CANCELLED] Council deliberation cancelled for message ${userMessageId}`);
      await storage.updateMessageStatus(userMessageId, "cancelled");
      await storage.updateConversationStatus(conversationId, "cancelled");
      if (creditCost && userId) {
        try {
          const conv = await storage.getConversation(conversationId);
          const refundAmount = conv?.reservedCredits || creditCost;
          await storage.refundDebateCredits(userId, refundAmount, `Debate cancelled by user (debate #${conversationId})`, conversationId);
          console.log(`[REFUND] Cancelled debate #${conversationId}: refunded ${refundAmount} credits`);
        } catch (refundErr: any) {
          console.error(`[REFUND] Error refunding cancelled debate #${conversationId}:`, refundErr.message);
        }
      }
    } else {
      console.error("Error processing council message:", error);
      const errorReason = categorizeError(error);
      await storage.updateConversationStatus(conversationId, "error", errorReason);
      if (creditCost && userId) {
        try {
          const conv = await storage.getConversation(conversationId);
          const refundAmount = conv?.reservedCredits || creditCost;
          await storage.refundDebateCredits(userId, refundAmount, `Deliberation failed: ${error.message || "unknown error"} (debate #${conversationId})`, conversationId);
        } catch (refundErr: any) {
          console.error(`[REFUND] Error refunding failed debate #${conversationId}:`, refundErr.message);
        }
      }
    }
    clearMessageController(userMessageId);
    cleanupRenderedImages(renderedImagePaths);
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  registerConfigRoutes(app);
  
  // === New Conversation Routes ===
  
  app.get("/api/user/usage", isAuthenticated, async (req, res) => {
    res.set("Cache-Control", "no-store");
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    
    const user = await storage.getUserById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    
    const now = new Date();
    const resetAt = user.monthlyResetAt ? new Date(user.monthlyResetAt) : null;
    const needsReset = resetAt && (now.getMonth() !== resetAt.getMonth() || now.getFullYear() !== resetAt.getFullYear());
    
    if (needsReset) {
      await storage.resetMonthlyDebates(userId);
    }
    
    const isSubscribed = user.subscriptionStatus === "active";
    const canSubmit = user.debateCredits > 0;
    const hasPurchased = !!user.stripeCustomerId || isSubscribed || user.deliberationCount > FREE_TIER_CREDITS || user.debateCredits > FREE_TIER_CREDITS;
    
    const paymentFailed = user.subscriptionStatus === "past_due" || user.subscriptionStatus === "unpaid";
    
    res.json({
      deliberationCount: user.deliberationCount,
      debateCredits: user.debateCredits,
      subscriptionStatus: user.subscriptionStatus,
      monthlyDebatesUsed: needsReset ? 0 : user.monthlyDebatesUsed,
      canSubmit,
      isSubscribed,
      hasPurchased,
      paymentFailed,
      creditsPurchasedAt: user.creditsPurchasedAt ? user.creditsPurchasedAt.toISOString() : null,
    });
  });

  app.delete("/api/user", accountDeleteLimiter, isAuthenticated, requireRecentAuth, async (req, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const confirmation = req.body?.confirmation;
    if (confirmation !== "DELETE") {
      return res.status(400).json({ message: "Please confirm account deletion by typing DELETE." });
    }

    securityLog.destructiveAction({ action: "account_deletion", userId });

    try {
      const user = await storage.getUserById(userId);

      if (user?.stripeCustomerId) {
        try {
          const stripe = await getUncachableStripeClient();
          if (stripe) {
            await stripe.customers.del(user.stripeCustomerId);
          }
        } catch (stripeErr: any) {
          console.error(`[DELETE USER] Failed to delete Stripe customer: ${stripeErr.message}`);
        }
      }

      await authStorage.deleteUser(userId);

      try {
        await clerkClient.users.deleteUser(userId);
      } catch (clerkErr: any) {
        console.error(`[DELETE USER] Failed to delete Clerk user: ${clerkErr.message}`);
      }

      res.json({ success: true });
    } catch (error: any) {
      console.error(`[DELETE USER] Failed to delete user ${userId}:`, error.message);
      res.status(500).json({ message: "Failed to delete account. Please try again." });
    }
  });

  app.get(api.conversations.list.path, isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    const convs = await storage.getConversations(userId);
    res.json(convs);
  });

  app.get(api.conversations.get.path, isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    const conv = await storage.getConversation(Number(req.params.id));
    if (!conv) {
      return res.status(404).json({ message: "Conversation not found" });
    }
    if (conv.userId !== userId) {
      return res.status(403).json({ message: "Forbidden" });
    }
    res.json(conv);
  });

  app.patch(api.conversations.rename.path, isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    const id = Number(req.params.id);
    const parsed = api.conversations.rename.input.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Title is required (1-200 characters)" });
    }
    const conv = await storage.getConversation(id);
    if (!conv) {
      return res.status(404).json({ message: "Conversation not found" });
    }
    if (conv.userId !== userId) {
      return res.status(403).json({ message: "Forbidden" });
    }
    await storage.renameConversation(id, parsed.data.title);
    res.json({ message: "Conversation renamed" });
  });

  app.delete(api.conversations.delete.path, isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    const id = Number(req.params.id);
    const conv = await storage.getConversation(id);
    if (!conv) {
      return res.status(404).json({ message: "Conversation not found" });
    }
    if (conv.userId !== userId) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const messageIds = (conv.messages || []).map(m => m.id);
    if (messageIds.length > 0) {
      cancelConversationMessages(id, messageIds);
    }
    const objectStorageUrls: string[] = [];
    const localAttachments: Attachment[] = [];
    for (const msg of conv.messages || []) {
      if (msg.attachments && Array.isArray(msg.attachments)) {
        for (const att of msg.attachments) {
          if (att.url) {
            const localPath = resolveLocalFilePath(att.url);
            if (localPath) {
              localAttachments.push(att);
            } else {
              try {
                const normalized = objectStorageService.normalizeObjectEntityPath(att.url);
                objectStorageUrls.push(normalized);
              } catch {
                objectStorageUrls.push(att.url);
              }
            }
          }
        }
      }
    }
    await storage.deleteConversation(id);
    cleanupAttachmentFiles(localAttachments);
    if (objectStorageUrls.length > 0) {
      Promise.allSettled(
        objectStorageUrls.map(url => objectStorageService.deleteObjectEntityFile(url))
      ).catch(err => console.error(`[DELETE] Attachment cleanup error:`, err));
    }
    res.json({ message: "Conversation deleted" });
  });

  // Register object storage routes
  registerObjectStorageRoutes(app);

  app.post("/api/uploads/extract-text", extractTextLimiter, isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      if (!(await checkPerUserLimit(userId, 10, 60_000, "extract-text"))) {
        securityLog.rateLimitHit({ route: "extract-text", userId });
        return res.status(429).json({ message: "Too many text extraction requests. Please wait." });
      }

      const { fileUrl, fileType } = req.body;
      if (!fileUrl || typeof fileUrl !== "string") {
        return res.status(400).json({ message: "Missing fileUrl" });
      }

      if (fileUrl.includes("/uploads/")) {
        const rawFilename = fileUrl.split("/uploads/").pop();
        if (rawFilename) {
          const filename = path.basename(decodeURIComponent(rawFilename));
          const ownerResult = await db.execute(
            sql`SELECT user_id FROM file_uploads WHERE filename = ${filename}`
          );
          const ownerRow = (ownerResult as any).rows?.[0];
          if (!isAdmin(req)) {
            if (!ownerRow) {
              securityLog.fileAccessDenied({ route: "/api/uploads/extract-text", userId, reason: "no_ownership_record" });
              return res.status(403).json({ message: "Access denied" });
            }
            if (ownerRow.user_id !== userId) {
              securityLog.fileAccessDenied({ route: "/api/uploads/extract-text", userId, reason: "not_owner" });
              return res.status(403).json({ message: "Access denied" });
            }
          }
        }
      }

      const mimeType = fileType || "application/octet-stream";

      if (mimeType.startsWith("image/")) {
        try {
          let buffer: Buffer;
          const localPath = resolveLocalFilePath(fileUrl);
          if (localPath && fs.existsSync(localPath)) {
            buffer = fs.readFileSync(localPath);
          } else {
            const objectsPathMatch = fileUrl.match(/\/objects\/(.+?)(?:\?.*)?$/);
            if (objectsPathMatch) {
              const objectFile = await objectStorageService.getObjectEntityFile(`/objects/${objectsPathMatch[1]}`);
              const canAccess = await objectStorageService.canAccessObjectEntity({
                userId,
                objectFile,
                requestedPermission: ObjectPermission.READ,
              });
              if (!canAccess) {
                securityLog.fileAccessDenied({ route: "/api/uploads/extract-text", userId, reason: "acl_denied" });
                return res.status(403).json({ message: "Access denied" });
              }
              const chunks: Buffer[] = [];
              const stream = objectFile.createReadStream();
              await new Promise<void>((resolve, reject) => {
                stream.on("data", (chunk: Buffer) => chunks.push(chunk));
                stream.on("end", () => resolve());
                stream.on("error", (err: Error) => reject(err));
              });
              buffer = Buffer.concat(chunks);
            } else {
              return res.status(400).json({ message: "File not found on server or object storage" });
            }
          }

          const metadata = await sharp(buffer).metadata();
          const w = metadata.width || 512;
          const h = metadata.height || 512;
          let tokenEstimate: number;
          if (w <= 512 && h <= 512) {
            tokenEstimate = 170;
          } else {
            tokenEstimate = Math.ceil(w / 512) * Math.ceil(h / 512) * 765 + 170;
          }

          return res.json({
            charCount: 0,
            tokenEstimate,
            isScanned: false,
            pageCount: 0,
          });
        } catch (err: any) {
          console.error("[extract-text] Image metadata error:", err.message);
          return res.json({ charCount: 0, tokenEstimate: 170, isScanned: false, pageCount: 0 });
        }
      }

      let resolvedPath = resolveLocalFilePath(fileUrl);
      let tempFile: string | null = null;

      if (!resolvedPath || !fs.existsSync(resolvedPath)) {
        const objectsPathMatch = fileUrl.match(/\/objects\/(.+?)(?:\?.*)?$/);
        if (objectsPathMatch) {
          try {
            const objectFile = await objectStorageService.getObjectEntityFile(`/objects/${objectsPathMatch[1]}`);
            const canAccess = await objectStorageService.canAccessObjectEntity({
              userId,
              objectFile,
              requestedPermission: ObjectPermission.READ,
            });
            if (!canAccess) {
              securityLog.fileAccessDenied({ route: "/api/uploads/extract-text", userId, reason: "acl_denied" });
              return res.status(403).json({ message: "Access denied" });
            }
            const chunks: Buffer[] = [];
            const stream = objectFile.createReadStream();
            await new Promise<void>((resolve, reject) => {
              stream.on("data", (chunk: Buffer) => chunks.push(chunk));
              stream.on("end", () => resolve());
              stream.on("error", (err: Error) => reject(err));
            });
            const buffer = Buffer.concat(chunks);
            const ext = path.extname(objectsPathMatch[1]) || ".tmp";
            tempFile = path.join(path.resolve(process.cwd(), "uploads"), `tmp-${Date.now()}${ext}`);
            fs.writeFileSync(tempFile, buffer);
            resolvedPath = tempFile;
          } catch (err: any) {
            if (err?.status === 403 || err?.message?.includes("Access denied")) {
              return res.status(403).json({ message: "Access denied" });
            }
            return res.status(400).json({ message: "File not found in object storage" });
          }
        } else {
          return res.status(400).json({ message: "File not found on server" });
        }
      }

      try {
        const text = await extractTextFromFile(resolvedPath, mimeType);
        const isScanned = !text && mimeType === "application/pdf";
        const charCount = text ? text.length : 0;
        const tokenEstimate = isScanned ? 765 * 3 + 170 : Math.ceil(charCount / 4);

        let pageCount = 0;
        if (mimeType === "application/pdf") {
          pageCount = await getPdfPageCount(resolvedPath);
        }

        return res.json({
          charCount,
          tokenEstimate,
          isScanned,
          pageCount,
        });
      } finally {
        if (tempFile && fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      }
    } catch (error: any) {
      console.error("[extract-text] Error:", error.message);
      return res.status(500).json({ message: "Failed to extract text" });
    }
  });

  app.post("/api/conversations/:id/cancel", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    const conversationId = Number(req.params.id);
    
    const conv = await storage.getConversation(conversationId);
    if (!conv) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }
    if (conv.userId !== userId) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    
    // Find all processing messages and cancel them
    const processingMessages = conv.messages
      .filter(m => m.status === 'processing')
      .map(m => m.id);
    
    const cancelledCount = cancelConversationMessages(conversationId, processingMessages);
    
    // Update statuses
    for (const msgId of processingMessages) {
      await storage.updateMessageStatus(msgId, "cancelled");
    }
    await storage.updateConversationStatus(conversationId, "cancelled");
    
    console.log(`[API] Cancelled ${cancelledCount} requests for conversation ${conversationId}`);
    res.json({ success: true, message: `Cancelled ${cancelledCount} active request(s)`, cancelled: cancelledCount });
  });

  app.post("/api/conversations/:id/retry", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    if (userId && !(await checkPerUserLimit(userId, 3, 60_000, "conversations.retry"))) {
      securityLog.rateLimitHit({ route: "conversations.retry", userId });
      return res.status(429).json({ success: false, message: "Too many retries. Please wait a moment." });
    }
    const conversationId = Number(req.params.id);
    
    const conv = await storage.getConversation(conversationId);
    if (!conv) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }
    if (conv.userId !== userId) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    
    const retryableStatuses = ['processing', 'error', 'cancelled'];
    const retryMessage = conv.messages
      .filter(m => m.role === 'user' && retryableStatuses.includes(m.status || ''))
      .pop();
    if (!retryMessage) {
      return res.status(400).json({ success: false, message: "No retryable message found" });
    }
    
    cancelConversationMessages(conversationId, [retryMessage.id]);
    
    await storage.clearCouncilResponses(retryMessage.id);
    await storage.updateMessageStatus(retryMessage.id, "processing");
    await storage.updateConversationStatus(conversationId, "processing");
    
    let parsedAttachments: Attachment[] | undefined;
    if (retryMessage.attachments) {
      try {
        const rawAttachments = typeof retryMessage.attachments === 'string' 
          ? JSON.parse(retryMessage.attachments)
          : retryMessage.attachments;
        
        if (Array.isArray(rawAttachments)) {
          parsedAttachments = rawAttachments.filter((att: any) => {
            const isValid = att && typeof att.url === 'string' && att.url.trim() !== '';
            if (!isValid && att) {
              console.warn(`[Retry] Skipping invalid attachment (missing URL):`, att);
            }
            return isValid;
          }) as Attachment[];
          console.log(`[Retry] Validated ${parsedAttachments.length} attachments for retry`);
        }
      } catch (parseErr) {
        console.error(`[Retry] Failed to parse attachments:`, parseErr);
        parsedAttachments = undefined;
      }
    }
    
    processCouncilMessage(
      conversationId,
      retryMessage.id,
      retryMessage.content,
      undefined,
      parsedAttachments,
      conv.models || DEFAULT_COUNCIL_MODELS,
      conv.chairmanModel || DEFAULT_CHAIRMAN_MODEL
    ).catch((err: Error) => {
      console.error(`[Retry] Error processing retry for message ${retryMessage.id}:`, err);
    });
    
    console.log(`[API] Retry initiated for conversation ${conversationId}, message ${retryMessage.id}`);
    res.json({ success: true, message: "Retry initiated" });
  });

  app.get("/api/conversations/:id/status", isAuthenticated, async (req, res) => {
    const userId = getUserId(req);
    const conversationId = Number(req.params.id);
    const conv = await storage.getConversation(conversationId);
    
    if (!conv) {
      return res.status(404).json({ message: "Conversation not found" });
    }
    if (conv.userId !== userId) {
      return res.status(403).json({ message: "Forbidden" });
    }
    
    const processingMessage = conv.messages.find(m => m.status === 'processing' && m.role === 'user');
    
    if (!processingMessage) {
      return res.json({
        isProcessing: false,
        stage: null,
        models: conv.models || DEFAULT_COUNCIL_MODELS,
        chairmanModel: conv.chairmanModel || DEFAULT_CHAIRMAN_MODEL,
        responses: [],
        failures: [],
        isStuck: false,
        stuckMessage: null,
        errorReason: conv.errorReason || null
      });
    }

    const now = Date.now();
    const messageCreatedAt = new Date(processingMessage.createdAt || now).getTime();
    
    const responses = processingMessage.councilResponses || [];
    const councilModels = conv.models || DEFAULT_COUNCIL_MODELS;
    
    const initialResponses = responses.filter(r => r.stage === 'initial');
    const reviewResponses = responses.filter(r => r.stage === 'review');
    
    const successfulInitial = initialResponses.filter(r => !r.error && r.content);
    const successfulReview = reviewResponses.filter(r => !r.error && r.content);
    
    const failures = responses.filter(r => r.error).map(r => ({
      model: r.model,
      stage: r.stage,
      message: r.error || 'Unknown error'
    }));
    
    const initialProcessed = initialResponses.length;
    const reviewProcessed = reviewResponses.length;
    
    let stage: 'hearing' | 'review' | 'verdict' = 'hearing';
    let stageProgress = { completed: successfulInitial.length, total: councilModels.length };
    
    if (initialProcessed >= councilModels.length && successfulInitial.length > 0) {
      stage = 'review';
      stageProgress = { completed: successfulReview.length, total: successfulInitial.length };
      
      if (reviewProcessed >= successfulInitial.length && successfulReview.length > 0) {
        stage = 'verdict';
        stageProgress = { completed: 0, total: 1 };
      }
    } else if (initialProcessed >= councilModels.length && successfulInitial.length === 0) {
      stageProgress = { completed: 0, total: councilModels.length };
    }
    
    const STUCK_THRESHOLD_MS = 3 * 60 * 1000;
    const latestResponseTime = responses.length > 0
      ? Math.max(...responses.map(r => new Date(r.createdAt || now).getTime()))
      : messageCreatedAt;
    
    const timeSinceLastActivity = now - latestResponseTime;
    const isStuck = timeSinceLastActivity > STUCK_THRESHOLD_MS;
    
    let stuckMessage = null;
    if (isStuck) {
      stuckMessage = "This is taking longer than expected. You can wait, or cancel and try again.";
    }
    
    const modelStatuses = councilModels.map(modelId => {
      const initial = initialResponses.find(r => r.model === modelId);
      const review = reviewResponses.find(r => r.model === modelId);
      
      const initialError = initial?.error;
      const reviewError = review?.error;
      const hasFailed = !!(initialError || reviewError);
      
      const initialComplete = !!initial && !!initial.content && !initialError;
      const reviewComplete = !!review && !!review.content && !reviewError;
      
      return {
        model: modelId,
        initialComplete,
        initialContent: initialComplete ? initial?.content || null : null,
        reviewComplete,
        reviewContent: reviewComplete ? review?.content || null : null,
        failed: hasFailed,
        error: initialError || reviewError || null
      };
    });
    
    res.json({
      isProcessing: true,
      stage,
      stageProgress,
      models: councilModels,
      chairmanModel: conv.chairmanModel || DEFAULT_CHAIRMAN_MODEL,
      modelStatuses,
      councilResponses: responses,
      failures,
      isStuck,
      stuckMessage,
      errorReason: conv.errorReason || null,
      startedAt: processingMessage.createdAt,
      lastActivityAt: new Date(latestResponseTime).toISOString()
    });
  });

  app.post('/api/estimate-cost', isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const user = await storage.getUserById(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      const { models, chairmanModel, attachments, conversationId } = req.body;
      const validModelIds = new Set(AVAILABLE_MODELS.map(m => m.id));

      let effectiveModels: string[];
      let effectiveChairman: string;
      let priorContextTokens = 0;

      if (conversationId) {
        const conversation = await storage.getConversation(Number(conversationId));
        if (conversation && conversation.userId === userId) {
          effectiveModels = conversation.models && conversation.models.length === 3
            ? conversation.models
            : DEFAULT_COUNCIL_MODELS;
          effectiveChairman = conversation.chairmanModel || DEFAULT_CHAIRMAN_MODEL;

          const messageCount = conversation.messages.length;
          if (messageCount >= 4 && conversation.contextSummary) {
            priorContextTokens = Math.ceil(conversation.contextSummary.length / 4);
          } else {
            const context = conversation.messages
              .map(m => `${m.role === 'user' ? 'User' : 'Chairman'}: ${m.content}`)
              .join("\n\n");
            priorContextTokens = Math.ceil(context.length / 4);
          }
        } else {
          effectiveModels = DEFAULT_COUNCIL_MODELS;
          effectiveChairman = DEFAULT_CHAIRMAN_MODEL;
        }
      } else {
        effectiveModels = (Array.isArray(models) && models.length === 3 && models.every((m: string) => validModelIds.has(m)))
          ? models
          : DEFAULT_COUNCIL_MODELS;
        effectiveChairman = (chairmanModel && validModelIds.has(chairmanModel))
          ? chairmanModel
          : DEFAULT_CHAIRMAN_MODEL;
      }

      const serverAttachmentTokens = estimateAttachmentTokensFromMetadata(attachments || []);
      const clientAttachmentTokens = typeof req.body.attachmentTokens === 'number' ? Math.max(0, Math.round(req.body.attachmentTokens)) : 0;
      const attachmentTokens = Math.max(clientAttachmentTokens, serverAttachmentTokens);

      const creditCost = getDebateCreditCost(effectiveModels, effectiveChairman, attachmentTokens, priorContextTokens);
      const reserveAmount = creditCost;

      const totalPurchased = await storage.getTotalCreditsPurchased(userId);
      const userTier = getUserTier(totalPurchased, user.debateCredits);

      res.json({ creditCost, reserveAmount, userTier });
    } catch (err) {
      console.error("[ESTIMATE_COST] Error:", err);
      res.status(500).json({ message: "Failed to estimate cost" });
    }
  });

  app.post(api.conversations.create.path, conversationLimiter, isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      if (!(await checkPerUserLimit(userId, 5, 60_000, "conversations.create"))) {
        securityLog.rateLimitHit({ route: "conversations.create", userId });
        return res.status(429).json({ message: "You're creating debates too quickly. Please wait a moment." });
      }
      
      const user = await storage.getUserById(userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      
      const isSubscribed = user.subscriptionStatus === "active";
      
      const { prompt, attachments, models, chairmanModel } = api.conversations.create.input.parse(req.body);

      const MAX_ATTACHMENTS = 30;
      const MAX_TOTAL_ATTACHMENT_SIZE = 50 * 1024 * 1024;
      if (attachments && attachments.length > MAX_ATTACHMENTS) {
        return res.status(400).json({ message: `Too many attachments. Maximum is ${MAX_ATTACHMENTS}.` });
      }
      if (attachments) {
        const totalSize = attachments.reduce((sum, a) => sum + (a.size || 0), 0);
        if (totalSize > MAX_TOTAL_ATTACHMENT_SIZE) {
          return res.status(400).json({ message: `Total attachment size exceeds the 50MB limit.` });
        }
      }

      const clientAttachmentTokens = typeof req.body.attachmentTokens === 'number' ? Math.max(0, Math.round(req.body.attachmentTokens)) : 0;
      const serverAttachmentTokens = estimateAttachmentTokensFromMetadata(attachments || []);
      const attachmentTokens = Math.max(clientAttachmentTokens, serverAttachmentTokens);
      
      const validModelIds = new Set(AVAILABLE_MODELS.map(m => m.id));
      if (models) {
        for (const m of models) {
          if (!validModelIds.has(m)) {
            return res.status(400).json({ message: `Unknown model: ${m}` });
          }
        }
      }
      if (chairmanModel && !validModelIds.has(chairmanModel)) {
        return res.status(400).json({ message: `Unknown chairman model: ${chairmanModel}` });
      }
      
      const hasPurchased = isSubscribed || user.deliberationCount > FREE_TIER_CREDITS || user.debateCredits > FREE_TIER_CREDITS;
      const effectiveModels = (!hasPurchased) ? DEFAULT_COUNCIL_MODELS : (models || DEFAULT_COUNCIL_MODELS);
      const effectiveChairman = (!hasPurchased) ? DEFAULT_CHAIRMAN_MODEL : (chairmanModel || DEFAULT_CHAIRMAN_MODEL);
      
      const creditCost = getDebateCreditCost(effectiveModels, effectiveChairman, attachmentTokens);

      const reserveAmount = creditCost;
      const title = prompt.length > 100 ? prompt.substring(0, 100) + "..." : prompt;

      const txResult = await db.transaction(async (tx) => {
        const [deductResult] = await tx.update(users).set({ 
          debateCredits: sql`${users.debateCredits} - ${creditCost}`,
          deliberationCount: sql`${users.deliberationCount} + 1`,
          updatedAt: new Date()
        }).where(
          sql`${users.id} = ${userId} AND ${users.debateCredits} >= ${creditCost}`
        ).returning({ debateCredits: users.debateCredits });

        if (!deductResult) {
          return { success: false as const };
        }

        const [conversation] = await tx.insert(conversations).values({
          title,
          models: effectiveModels || null,
          chairmanModel: effectiveChairman || null,
          userId: userId || null,
        }).returning();

        await tx.update(conversations).set({ reservedCredits: creditCost }).where(eq(conversations.id, conversation.id));
        await tx.update(conversations).set({ estimatedCredits: creditCost }).where(eq(conversations.id, conversation.id));

        await tx.insert(creditTransactions).values({
          userId,
          type: "deduction",
          amount: -creditCost,
          balanceAfter: deductResult.debateCredits,
          description: `Charged for debate #${conversation.id}: "${title}" [${effectiveModels.join(", ")}] (${creditCost} credits)`,
          conversationId: conversation.id,
        });

        const [userMessage] = await tx.insert(messages).values({
          conversationId: conversation.id,
          role: "user",
          content: prompt,
          attachments: attachments || null,
          status: "processing"
        }).returning();

        return { success: true as const, conversation, userMessage, deductResult };
      });

      if (!txResult.success) {
        return res.status(403).json({ 
          message: `This debate costs ${creditCost} credit${creditCost > 1 ? 's' : ''} but you only have ${user.debateCredits}. Purchase more to continue.`,
          code: "PAYWALL",
          creditCost,
          reserveAmount: creditCost,
          debateCredits: user.debateCredits
        });
      }

      const { conversation, userMessage } = txResult;
      
      processCouncilMessage(conversation.id, userMessage.id, prompt, undefined, attachments, effectiveModels, effectiveChairman, creditCost, userId);
      
      res.status(201).json(conversation);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  app.post(api.conversations.addMessage.path, conversationLimiter, isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (userId && !(await checkPerUserLimit(userId, 5, 60_000, "conversations.addMessage"))) {
        securityLog.rateLimitHit({ route: "conversations.addMessage", userId });
        return res.status(429).json({ message: "You're sending messages too quickly. Please wait a moment." });
      }

      const conversationId = Number(req.params.id);
      const { prompt, attachments, expectedCost } = api.conversations.addMessage.input.parse(req.body);

      if (attachments && attachments.length > 30) {
        return res.status(400).json({ message: "Too many attachments. Maximum is 30." });
      }
      if (attachments) {
        const totalSize = attachments.reduce((sum, a) => sum + (a.size || 0), 0);
        if (totalSize > 50 * 1024 * 1024) {
          return res.status(400).json({ message: "Total attachment size exceeds the 50MB limit." });
        }
      }

      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      
      const conversation = await storage.getConversation(conversationId);
      if (!conversation) {
        return res.status(404).json({ message: "Conversation not found" });
      }
      if (conversation.userId !== userId) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const user = await storage.getUserById(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      const effectiveModels = conversation.models && conversation.models.length === 3
        ? conversation.models
        : DEFAULT_COUNCIL_MODELS;
      const effectiveChairman = conversation.chairmanModel || DEFAULT_CHAIRMAN_MODEL;

      const clientAttachmentTokens = typeof req.body.attachmentTokens === 'number' ? Math.max(0, Math.round(req.body.attachmentTokens)) : 0;
      const serverAttachmentTokens = estimateAttachmentTokensFromMetadata(attachments || []);
      const attachmentTokens = Math.max(clientAttachmentTokens, serverAttachmentTokens);

      const messageCount = conversation.messages.length;
      let context: string;
      let priorContextTokens = 0;

      if (messageCount >= 4 && conversation.contextSummary) {
        context = conversation.contextSummary;
        priorContextTokens = Math.ceil(context.length / 4);
      } else {
        context = conversation.messages
          .map(m => `${m.role === 'user' ? 'User' : 'Chairman'}: ${m.content}`)
          .join("\n\n");
        priorContextTokens = Math.ceil(context.length / 4);
      }

      const creditCost = getDebateCreditCost(effectiveModels, effectiveChairman, attachmentTokens, priorContextTokens);

      if (expectedCost && creditCost > expectedCost * 1.2) {
        console.log(`[COST_MISMATCH] Debate #${conversationId}: client expected ${expectedCost}, server calculated ${creditCost}`);
        return res.status(409).json({
          message: `The cost for this reply has changed from ${expectedCost} to ${creditCost} credits due to conversation context growth. Please review and try again.`,
          code: "COST_MISMATCH",
          creditCost,
          actualCost: creditCost,
          expectedCost,
        });
      }

      const reserveAmount = creditCost;

      const txResult = await db.transaction(async (tx) => {
        const [deductResult] = await tx.update(users).set({
          debateCredits: sql`${users.debateCredits} - ${creditCost}`,
          deliberationCount: sql`${users.deliberationCount} + 1`,
          updatedAt: new Date()
        }).where(
          sql`${users.id} = ${userId} AND ${users.debateCredits} >= ${creditCost}`
        ).returning({ debateCredits: users.debateCredits });

        if (!deductResult) {
          return { success: false as const };
        }

        await tx.insert(creditTransactions).values({
          userId,
          type: "deduction",
          amount: -creditCost,
          balanceAfter: deductResult.debateCredits,
          description: `Charged for reply in debate #${conversationId} (${creditCost} credits)`,
          conversationId,
        });

        await tx.update(conversations).set({ status: "processing" }).where(eq(conversations.id, conversationId));

        const [userMessage] = await tx.insert(messages).values({
          conversationId,
          role: "user",
          content: prompt,
          attachments: attachments || null,
          status: "processing"
        }).returning();

        await tx.update(conversations).set({ reservedCredits: creditCost }).where(eq(conversations.id, conversationId));
        await tx.update(conversations).set({ estimatedCredits: creditCost }).where(eq(conversations.id, conversationId));

        return { success: true as const, userMessage };
      });

      if (!txResult.success) {
        return res.status(403).json({
          message: `This reply costs ${creditCost} credit${creditCost !== 1 ? 's' : ''} but you only have ${user.debateCredits}. Purchase more to continue.`,
          code: "PAYWALL",
          creditCost,
          reserveAmount: creditCost,
          debateCredits: user.debateCredits
        });
      }

      const { userMessage } = txResult;
      processCouncilMessage(conversationId, userMessage.id, prompt, context, attachments, effectiveModels, effectiveChairman, creditCost, userId);

      res.status(201).json(userMessage);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  // === Stripe Checkout Routes ===
  
  app.post("/api/stripe/create-checkout", stripeLimiter, isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      
      const user = await storage.getUserById(userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      
      const { packSize, referral: rawReferral } = req.body || {};
      const referral = rawReferral && typeof rawReferral === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(rawReferral) ? rawReferral : undefined;
      const pack = getCreditPackBySize(Number(packSize));
      
      if (!pack) {
        return res.status(400).json({ message: "Invalid pack size. Choose 100, 325, or 900." });
      }
      
      const stripe = await getUncachableStripeClient();
      
      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email || undefined,
          metadata: { userId },
        });
        customerId = customer.id;
        await storage.updateUserSubscription(userId, user.subscriptionStatus, customerId);
      }
      
      let priceId: string | undefined;
      
      const priceResult = await db.execute(
        sql`SELECT p.id FROM stripe.prices p JOIN stripe.products pr ON p.product = pr.id WHERE p.active = true AND pr.name = ${pack.name} ORDER BY p.created DESC LIMIT 1`
      );
      
      if (priceResult.rows.length > 0) {
        priceId = priceResult.rows[0].id as string;
      } else {
        const products = await stripe.products.list({ active: true, limit: 100 });
        const matchingProduct = products.data.find(p => p.name === pack.name);
        if (matchingProduct) {
          const prices = await stripe.prices.list({ product: matchingProduct.id, active: true, limit: 10 });
          if (prices.data.length > 0) {
            priceId = prices.data[0].id;
          }
        }
      }
      
      if (!priceId) {
        console.log(`[STRIPE] Product "${pack.name}" not found, auto-creating...`);
        const product = await stripe.products.create({
          name: pack.name,
          description: pack.description,
          metadata: pack.metadata,
        });
        const price = await stripe.prices.create({
          product: product.id,
          unit_amount: pack.unitAmount,
          currency: 'usd',
        });
        priceId = price.id;
        console.log(`[STRIPE] Created ${pack.name}: product=${product.id}, price=${priceId} ($${pack.unitAmount / 100})`);
      }
      
      const baseUrl = getBaseUrl(req);
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        mode: 'payment',
        metadata: {
          userId,
          credits: String(packSize),
          ...(referral ? { referral_code: String(referral) } : {}),
        },
        success_url: `${baseUrl}/?checkout=success&credits=${packSize}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/?checkout=cancel`,
      });
      
      res.json({ url: session.url });
    } catch (error: any) {
      console.error("Stripe checkout error:", error?.message || error);
      res.status(500).json({ message: "Failed to create checkout session" });
    }
  });
  
  app.post("/api/stripe/create-portal", sensitiveStripeLimiter, isAuthenticated, requireRecentAuth, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      
      const user = await storage.getUserById(userId);
      if (!user?.stripeCustomerId) {
        return res.status(400).json({ message: "No billing account found" });
      }
      
      const stripe = await getUncachableStripeClient();
      const session = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: `${getBaseUrl(req)}/`,
      });
      
      res.json({ url: session.url });
    } catch (error: any) {
      console.error("Stripe portal error:", error?.message || error);
      res.status(500).json({ message: "Failed to create portal session" });
    }
  });

  app.get("/api/stripe/payment-method", isAuthenticated, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const user = await storage.getUserById(userId);
      if (!user?.stripeCustomerId) {
        return res.json(null);
      }

      const stripe = await getUncachableStripeClient();
      const paymentMethods = await stripe.paymentMethods.list({
        customer: user.stripeCustomerId,
        type: "card",
        limit: 1,
      });

      if (paymentMethods.data.length === 0) {
        return res.json(null);
      }

      const pm = paymentMethods.data[0];
      res.json({
        brand: pm.card?.brand || "unknown",
        last4: pm.card?.last4 || "0000",
        expMonth: pm.card?.exp_month || 0,
        expYear: pm.card?.exp_year || 0,
      });
    } catch (error: any) {
      console.error("Payment method error:", error?.message || error);
      res.status(500).json({ message: "Failed to fetch payment method" });
    }
  });

  app.get("/api/stripe/invoices", isAuthenticated, async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const user = await storage.getUserById(userId);
      if (!user?.stripeCustomerId) {
        return res.json([]);
      }

      const stripe = await getUncachableStripeClient();

      const charges = await stripe.charges.list({
        customer: user.stripeCustomerId,
        limit: 20,
      });

      const invoiceItems = charges.data
        .filter((charge) => charge.status === "succeeded")
        .map((charge) => ({
          id: charge.id,
          description: charge.description || "Credit Purchase",
          amount: charge.amount,
          currency: charge.currency,
          date: charge.created,
          status: charge.status,
          pdfUrl: null as string | null,
          receiptUrl: charge.receipt_url || null,
        }));

      for (const item of invoiceItems) {
        const charge = charges.data.find((c) => c.id === item.id);
        if (charge && "invoice" in charge && charge.invoice) {
          try {
            const invoiceRef = charge.invoice;
            const invoiceId = typeof invoiceRef === "string" ? invoiceRef : (invoiceRef && typeof invoiceRef === "object" && "id" in invoiceRef ? (invoiceRef as { id: string }).id : null);
            if (invoiceId) {
              const inv = await stripe.invoices.retrieve(invoiceId);
              item.pdfUrl = inv.invoice_pdf || null;
            }
          } catch {
          }
        }
      }

      res.json(invoiceItems);
    } catch (error: any) {
      console.error("Invoices error:", error?.message || error);
      res.status(500).json({ message: "Failed to fetch invoices" });
    }
  });

  app.post("/api/stripe/setup-payment", sensitiveStripeLimiter, isAuthenticated, requireRecentAuth, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const user = await storage.getUserById(userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      const stripe = await getUncachableStripeClient();

      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email || undefined,
          metadata: { userId },
        });
        customerId = customer.id;
        await storage.updateUserSubscription(userId, user.subscriptionStatus || "free", customerId);
      }

      const baseUrl = getBaseUrl(req);
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "setup",
        payment_method_types: ["card"],
        success_url: `${baseUrl}/profile?setup=success`,
        cancel_url: `${baseUrl}/profile?setup=cancel`,
      });

      res.json({ url: session.url });
    } catch (error: any) {
      console.error("Setup payment error:", error?.message || error);
      res.status(500).json({ message: "Failed to create setup session" });
    }
  });
  
  app.post("/api/stripe/recover-credits", sensitiveStripeLimiter, isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      if (!(await checkPerUserLimit(userId, 3, 60_000, "stripe.recover-credits"))) {
        securityLog.rateLimitHit({ route: "stripe.recover-credits", userId });
        return res.status(429).json({ message: "Too many recovery requests. Please wait." });
      }

      const stripe = await getUncachableStripeClient();
      const user = await storage.getUserById(userId);
      if (!user?.stripeCustomerId) {
        return res.json({ recovered: 0, debateCredits: user?.debateCredits || 0 });
      }

      const sessions = await stripe.checkout.sessions.list({
        customer: user.stripeCustomerId,
        limit: 10,
      });

      let totalRecovered = 0;
      for (const session of sessions.data) {
        if (
          session.payment_status === 'paid' &&
          session.metadata?.userId === userId &&
          session.metadata?.credits
        ) {
          const alreadyLogged = await storage.isStripeSessionProcessed(session.id);
          if (alreadyLogged) continue;

          const credits = parseInt(session.metadata.credits, 10);
          if (credits && [100, 325, 900, 150, 370, 870, 10, 30, 50].includes(credits)) {
            await storage.logCreditTransaction({
              userId,
              type: "recovery",
              amount: credits,
              balanceAfter: 0,
              description: `Recovery of ${credits}-credit pack from session ${session.id}`,
              stripeSessionId: session.id,
            });
            totalRecovered += credits;
            console.log(`[RECOVERY] Added ${credits} credits to user ${userId} via session ${session.id}`);

            try {
              const amountPaid = (session.amount_total || 0) / 100;
              if (amountPaid > 0) {
                await storage.incrementUserRevenue(userId, amountPaid);
                console.log(`[REVENUE] Tracked $${amountPaid.toFixed(2)} revenue for recovered session ${session.id}`);
              }
            } catch (revErr: any) {
              console.error(`[REVENUE] Error tracking revenue for recovery session ${session.id}:`, revErr.message);
            }
          }
        }
      }

      if (totalRecovered > 0) {
        await db.update(users).set({
          creditsPurchasedAt: new Date(),
          creditsExpiryWarned: false,
          creditsExpiryFinalWarned: false,
        }).where(sql`id = ${userId}`);
      }

      const updatedUser = await storage.getUserById(userId);
      res.json({ recovered: totalRecovered, debateCredits: updatedUser?.debateCredits || 0 });
    } catch (error: any) {
      console.error("Credit recovery error:", error?.message || error);
      res.status(500).json({ message: "Failed to recover credits" });
    }
  });

  app.post("/api/stripe/sync-credits", sensitiveStripeLimiter, isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      if (!(await checkPerUserLimit(userId, 3, 60_000, "stripe.sync-credits"))) {
        securityLog.rateLimitHit({ route: "stripe.sync-credits", userId });
        return res.status(429).json({ message: "Too many sync requests. Please wait." });
      }
      
      const { sessionId } = req.body || {};
      if (!sessionId || typeof sessionId !== 'string') {
        return res.status(400).json({ message: "Missing checkout session ID" });
      }
      
      const alreadyProcessed = await storage.isStripeSessionProcessed(sessionId);
      if (alreadyProcessed) {
        const user = await storage.getUserById(userId);
        return res.json({ debateCredits: user?.debateCredits || 0, alreadyProcessed: true });
      }
      
      const stripe = await getUncachableStripeClient();
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      
      if (session.payment_status !== 'paid') {
        return res.status(400).json({ message: "Payment not completed" });
      }
      
      if (session.metadata?.userId !== userId) {
        return res.status(403).json({ message: "Session does not belong to this user" });
      }
      
      const credits = parseInt(session.metadata?.credits || '0', 10);
      if (!credits || ![100, 325, 900, 150, 370, 870, 10, 30, 50].includes(credits)) {
        return res.status(400).json({ message: "Invalid credits in session" });
      }
      
      const inserted = await storage.logCreditTransaction({
        userId,
        type: "purchase",
        amount: credits,
        balanceAfter: 0,
        description: `Purchased ${credits}-credit pack`,
        stripeSessionId: sessionId,
      });

      if (inserted) {
        await db.update(users).set({
          creditsPurchasedAt: new Date(),
          creditsExpiryWarned: false,
          creditsExpiryFinalWarned: false,
        }).where(sql`id = ${userId}`);
        console.log(`[CREDITS] Added ${credits} credits to user ${userId} via session ${sessionId}`);

        try {
          const amountPaid = (session.amount_total || 0) / 100;
          if (amountPaid > 0) {
            await storage.incrementUserRevenue(userId, amountPaid);
            console.log(`[REVENUE] Tracked $${amountPaid.toFixed(2)} revenue for user ${userId}`);
          }
        } catch (revErr: any) {
          console.error(`[REVENUE] Error tracking revenue for user ${userId}:`, revErr.message);
        }
      }

      const user = await storage.getUserById(userId);
      res.json({ debateCredits: user?.debateCredits || 0, alreadyProcessed: !inserted });
    } catch (error: any) {
      console.error("Sync credits error:", error?.message || error);
      res.status(500).json({ message: "Failed to sync credits" });
    }
  });

  app.post("/api/stripe/cancel-subscription", isAuthenticated, requireRecentAuth, async (req, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      
      const user = await storage.getUserById(userId);
      if (!user?.stripeSubscriptionId) {
        return res.status(400).json({ message: "No active subscription to cancel" });
      }
      
      securityLog.billingAnomaly({ action: "cancel_subscription", userId, detail: `subscriptionId=${user.stripeSubscriptionId}` });
      
      const stripe = await getUncachableStripeClient();
      await stripe.subscriptions.update(user.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });
      
      res.json({ message: "Subscription will cancel at end of billing period" });
    } catch (error: any) {
      console.error("Cancel subscription error:", error?.message || error);
      res.status(500).json({ message: "Failed to cancel subscription" });
    }
  });

  app.post("/api/support", supportLimiter, isAuthenticated, async (req, res) => {
    try {
      const schema = z.object({
        email: z.string().email("Invalid email address"),
        message: z.string().min(1, "Message is required").max(5000, "Message is too long"),
        imageUrls: z.array(z.string().regex(/^\/uploads\/[a-f0-9-]+\.\w+$/i, "Invalid image URL")).max(5).optional(),
      });
      const { email, message, imageUrls } = schema.parse(req.body);

      const baseUrl = process.env.REPLIT_DEV_DOMAIN
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : process.env.REPL_SLUG
          ? `https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co`
          : `${req.protocol}://${req.headers.host}`;

      const fullImageUrls = imageUrls?.map(url => {
        if (url.startsWith('/')) {
          return `${baseUrl}${url}`;
        }
        return url;
      });

      await storage.createSupportMessage({
        email,
        message,
        imageUrls: fullImageUrls || [],
      });

      const sent = await sendSupportMessage(email, message, fullImageUrls);
      if (!sent) {
        return res.status(500).json({ message: "Failed to send message. Please try again." });
      }
      res.json({ message: "Message sent successfully" });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0]?.message || "Invalid input" });
      }
      console.error("Support message error:", error);
      res.status(500).json({ message: "Failed to send message. Please try again." });
    }
  });

  app.get("/api/admin/support-messages", isAuthenticated, async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ message: "Forbidden: admin access required" });
    }
    const userId = getUserId(req);
    if (userId) securityLog.adminAccess({ route: "/api/admin/support-messages", userId });
    try {
      const messages = await storage.getSupportMessages();
      res.json(messages);
    } catch (error) {
      console.error("Failed to fetch support messages:", error);
      res.status(500).json({ message: "Failed to fetch support messages" });
    }
  });

  app.get("/api/admin/analytics", isAuthenticated, async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ message: "Forbidden: admin access required" });
    }
    const userId = getUserId(req);
    if (userId) securityLog.adminAccess({ route: "/api/admin/analytics", userId });
    try {
      const analytics = await storage.getPlatformAnalytics();
      res.json(analytics);
    } catch (error) {
      console.error("Failed to fetch analytics:", error);
      res.status(500).json({ message: "Failed to fetch analytics" });
    }
  });

  app.post("/api/admin/analytics/refresh", isAuthenticated, async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ message: "Forbidden: admin access required" });
    }
    const userId = getUserId(req);
    if (userId) securityLog.adminAccess({ route: "/api/admin/analytics/refresh", userId });
    try {
      await storage.backfillAnalytics();
      const analytics = await storage.getPlatformAnalytics();
      res.json({ message: "Analytics refreshed successfully", analytics });
    } catch (error) {
      console.error("Failed to refresh analytics:", error);
      res.status(500).json({ message: "Failed to refresh analytics" });
    }
  });

  return httpServer;
}
