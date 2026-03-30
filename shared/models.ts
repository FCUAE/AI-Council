export type Capability = "reasoning" | "coding" | "writing" | "vision" | "fast";
export type Role = "coding" | "marketing" | "logic" | "data" | "quick";

export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  specialty: string;
  cost: 1 | 2 | 3 | 4;
  vision: boolean;
  capabilities: Capability[];
  badge: string;
  apiCostInput: number;
  apiCostOutput: number;
  contextWindow: number;
  isReasoningModel: boolean;
  reasoningTokenMultiplier: number;
}

export const ROLE_LABELS: Record<Role, string> = {
  coding: "Dev & Coding",
  marketing: "Marketing & Content",
  logic: "Logic & Strategy",
  data: "Data & Analysis",
  quick: "Quick Answers"
};

export interface RoleBadge {
  label: string;
  isChampion: boolean;
  isNotRecommended?: boolean;
}

type ChampionMatrix = Record<Role, Record<string, RoleBadge>>;

export const CHAMPION_MATRIX: ChampionMatrix = {
  coding: {
    "openai/gpt-5.4": { label: "Frontier All-Rounder", isChampion: false },
    "openai/gpt-5.4-pro": { label: "Top Tier Coder", isChampion: true },
    "anthropic/claude-opus-4.6": { label: "#1 Best for Code", isChampion: true },
    "anthropic/claude-opus-4.5": { label: "#1 Best for Code", isChampion: true },
    "anthropic/claude-opus-4.1": { label: "Top Tier Coder", isChampion: true },
    "anthropic/claude-opus-4": { label: "Top Tier Coder", isChampion: false },
    "anthropic/claude-sonnet-4.6": { label: "Best for Code", isChampion: true },
    "anthropic/claude-sonnet-4.5": { label: "Best for Code", isChampion: true },
    "anthropic/claude-sonnet-4": { label: "Best for Code", isChampion: true },
    "anthropic/claude-3.5-sonnet": { label: "Best for Code", isChampion: false },
    "openai/o3": { label: "Best for Architecture", isChampion: false },
    "openai/o1": { label: "Best for Architecture", isChampion: false },
    "openai/o4-mini": { label: "Smart & Fast", isChampion: false },
    "openai/o3-mini": { label: "Best for Architecture", isChampion: false },
    "openai/gpt-5.2": { label: "Reliable All-Rounder", isChampion: false },
    "openai/gpt-4o": { label: "Reliable All-Rounder", isChampion: false },
    "google/gemini-3.1-pro-preview": { label: "Good for Huge Codebases", isChampion: false },
    "google/gemini-3-pro-preview": { label: "Good for Huge Codebases", isChampion: false },
    "google/gemini-2.5-pro": { label: "Good for Huge Codebases", isChampion: false },
    "perplexity/sonar-reasoning-pro": { label: "Not Recommended", isChampion: false, isNotRecommended: true },
    "perplexity/sonar-pro-search": { label: "Not Recommended", isChampion: false, isNotRecommended: true },
    "perplexity/sonar-pro": { label: "Not Recommended", isChampion: false, isNotRecommended: true },
    "perplexity/sonar-deep-research": { label: "Not Recommended", isChampion: false, isNotRecommended: true },
    "perplexity/sonar": { label: "Not Recommended", isChampion: false, isNotRecommended: true },
    "anthropic/claude-3.5-haiku": { label: "Good for Scripts", isChampion: false },
    "openai/gpt-4o-mini": { label: "Good for Scripts", isChampion: false },
    "moonshotai/kimi-k2.5": { label: "Strong Value Coder", isChampion: false },
    "moonshotai/kimi-k2": { label: "Strong Value Coder", isChampion: false },
    "deepseek/deepseek-v3.2": { label: "Value Pick for Code", isChampion: false },
    "deepseek/deepseek-chat": { label: "Value Pick for Code", isChampion: false },
    "x-ai/grok-4": { label: "Strong Coder", isChampion: false },
  },
  marketing: {
    "openai/gpt-5.4": { label: "Best for Social Media", isChampion: true },
    "openai/gpt-5.4-pro": { label: "Overkill / Expensive", isChampion: false, isNotRecommended: true },
    "anthropic/claude-sonnet-4.6": { label: "Most Human-Like", isChampion: true },
    "anthropic/claude-sonnet-4.5": { label: "Most Human-Like", isChampion: true },
    "anthropic/claude-sonnet-4": { label: "Most Human-Like", isChampion: true },
    "anthropic/claude-3.5-sonnet": { label: "Most Human-Like", isChampion: true },
    "anthropic/claude-opus-4.6": { label: "Top Quality Writing", isChampion: false },
    "anthropic/claude-opus-4.5": { label: "Top Quality Writing", isChampion: false },
    "anthropic/claude-opus-4.1": { label: "Overkill / Expensive", isChampion: false, isNotRecommended: true },
    "anthropic/claude-opus-4": { label: "Overkill / Expensive", isChampion: false, isNotRecommended: true },
    "openai/gpt-5.2": { label: "Best for Social Media", isChampion: true },
    "openai/gpt-4o": { label: "Best for Social Media", isChampion: true },
    "google/gemini-3.1-pro-preview": { label: "Best for Long Articles", isChampion: false },
    "google/gemini-3-pro-preview": { label: "Best for Long Articles", isChampion: false },
    "google/gemini-2.5-pro": { label: "Best for Long Articles", isChampion: false },
    "perplexity/sonar-pro-search": { label: "Good for Research Copy", isChampion: false },
    "perplexity/sonar-pro": { label: "Good for Research Copy", isChampion: false },
    "perplexity/sonar": { label: "Fast Research Draft", isChampion: false },
    "x-ai/grok-4": { label: "Creative Storyteller", isChampion: false },
    "openai/o3": { label: "Not Recommended", isChampion: false, isNotRecommended: true },
    "openai/o1": { label: "Not Recommended", isChampion: false, isNotRecommended: true },
    "openai/o4-mini": { label: "Not Recommended", isChampion: false, isNotRecommended: true },
    "openai/o3-mini": { label: "Not Recommended", isChampion: false, isNotRecommended: true },
    "deepseek/deepseek-r1": { label: "Not Recommended", isChampion: false, isNotRecommended: true },
    "perplexity/sonar-reasoning-pro": { label: "Not Recommended", isChampion: false, isNotRecommended: true },
    "perplexity/sonar-deep-research": { label: "Not Recommended", isChampion: false, isNotRecommended: true },
    "moonshotai/kimi-k2.5": { label: "Not Recommended", isChampion: false, isNotRecommended: true },
    "moonshotai/kimi-k2": { label: "Not Recommended", isChampion: false, isNotRecommended: true },
  },
  logic: {
    "openai/gpt-5.4": { label: "Strong Reasoning", isChampion: false },
    "openai/gpt-5.4-pro": { label: "#1 Deep Thinker", isChampion: true },
    "openai/o3": { label: "#1 Deep Thinker", isChampion: true },
    "openai/o1": { label: "#1 Deep Thinker", isChampion: true },
    "openai/gpt-5.2-pro": { label: "#1 Deep Thinker", isChampion: true },
    "anthropic/claude-opus-4.6": { label: "Top Tier Reasoning", isChampion: true },
    "anthropic/claude-opus-4.5": { label: "Top Tier Reasoning", isChampion: true },
    "anthropic/claude-opus-4.1": { label: "Strong Reasoning", isChampion: false },
    "anthropic/claude-opus-4": { label: "Strong Reasoning", isChampion: false },
    "openai/o4-mini": { label: "Fast Reasoning", isChampion: false },
    "openai/o3-mini": { label: "Smart & Fast", isChampion: false },
    "deepseek/deepseek-r1": { label: "Deep Reasoning", isChampion: false },
    "moonshotai/kimi-k2.5": { label: "Strong Reasoning", isChampion: false },
    "moonshotai/kimi-k2": { label: "Strong Reasoning", isChampion: false },
    "anthropic/claude-sonnet-4.6": { label: "Strong Logic", isChampion: false },
    "anthropic/claude-sonnet-4.5": { label: "Strong Logic", isChampion: false },
    "anthropic/claude-sonnet-4": { label: "Strong Logic", isChampion: false },
    "anthropic/claude-3.5-sonnet": { label: "Strong Logic", isChampion: false },
    "openai/gpt-5.2": { label: "Good General Logic", isChampion: false },
    "openai/gpt-4o": { label: "Good General Logic", isChampion: false },
    "google/gemini-3.1-pro-preview": { label: "Best for Legal Docs", isChampion: false },
    "google/gemini-3-pro-preview": { label: "Best for Legal Docs", isChampion: false },
    "google/gemini-2.5-pro": { label: "Best for Legal Docs", isChampion: false },
    "perplexity/sonar-reasoning-pro": { label: "Reasoning + Search", isChampion: false },
    "perplexity/sonar-deep-research": { label: "Deep Research", isChampion: false },
    "perplexity/sonar-pro-search": { label: "Search-Augmented", isChampion: false },
    "perplexity/sonar-pro": { label: "Search-Augmented", isChampion: false },
    "perplexity/sonar": { label: "Fast Search", isChampion: false },
    "x-ai/grok-4": { label: "Strong Reasoning", isChampion: false },
  },
  data: {
    "openai/gpt-5.4": { label: "#1 for Vision/Charts", isChampion: true },
    "openai/gpt-5.4-pro": { label: "Top Tier Analysis", isChampion: true },
    "openai/gpt-5.2": { label: "#1 for Vision/Charts", isChampion: true },
    "openai/gpt-4o": { label: "#1 for Vision/Charts", isChampion: true },
    "google/gemini-3.1-pro-preview": { label: "#1 for Big Data", isChampion: true },
    "google/gemini-3-pro-preview": { label: "#1 for Big Data", isChampion: true },
    "google/gemini-2.5-pro": { label: "#1 for Big Data", isChampion: true },
    "anthropic/claude-opus-4.6": { label: "Strong Analysis", isChampion: false },
    "anthropic/claude-opus-4.5": { label: "Strong Analysis", isChampion: false },
    "anthropic/claude-sonnet-4.6": { label: "Strong Graph Reading", isChampion: false },
    "anthropic/claude-sonnet-4.5": { label: "Strong Graph Reading", isChampion: false },
    "anthropic/claude-sonnet-4": { label: "Strong Graph Reading", isChampion: false },
    "anthropic/claude-3.5-sonnet": { label: "Strong Graph Reading", isChampion: false },
    "openai/o3": { label: "Vision + Reasoning", isChampion: false },
    "openai/o4-mini": { label: "Fast Vision Analysis", isChampion: false },
    "moonshotai/kimi-k2.5": { label: "Multimodal Analysis", isChampion: false },
    "meta-llama/llama-4-maverick": { label: "Great for Vision", isChampion: false },
    "x-ai/grok-4": { label: "Multimodal Analysis", isChampion: false },
    "anthropic/claude-opus-4.1": { label: "No Vision Focus", isChampion: false, isNotRecommended: true },
    "anthropic/claude-opus-4": { label: "No Vision Focus", isChampion: false, isNotRecommended: true },
    "openai/o1": { label: "No Vision Support", isChampion: false, isNotRecommended: true },
    "openai/o3-mini": { label: "No Vision Support", isChampion: false, isNotRecommended: true },
    "moonshotai/kimi-k2": { label: "No Vision Support", isChampion: false, isNotRecommended: true },
    "deepseek/deepseek-r1": { label: "No Vision Support", isChampion: false, isNotRecommended: true },
    "deepseek/deepseek-v3.2": { label: "No Vision Support", isChampion: false, isNotRecommended: true },
    "deepseek/deepseek-chat": { label: "No Vision Support", isChampion: false, isNotRecommended: true },
    "perplexity/sonar-reasoning-pro": { label: "No Data Focus", isChampion: false, isNotRecommended: true },
    "perplexity/sonar-pro-search": { label: "No Data Focus", isChampion: false, isNotRecommended: true },
    "perplexity/sonar-pro": { label: "No Data Focus", isChampion: false, isNotRecommended: true },
    "perplexity/sonar-deep-research": { label: "No Data Focus", isChampion: false, isNotRecommended: true },
    "perplexity/sonar": { label: "No Data Focus", isChampion: false, isNotRecommended: true },
  },
  quick: {
    "openai/gpt-4o-mini": { label: "Fastest & Cheapest", isChampion: true },
    "openai/o4-mini": { label: "Smart & Fast", isChampion: true },
    "anthropic/claude-3.5-haiku": { label: "Smartest Fast Model", isChampion: true },
    "google/gemini-2.5-flash": { label: "High Volume Pro", isChampion: false },
    "google/gemini-2.5-flash-lite": { label: "Ultra Fast", isChampion: false },
    "google/gemini-3-flash-preview": { label: "Fast & Capable", isChampion: false },
    "x-ai/grok-4-fast": { label: "Fast Response", isChampion: false },
    "perplexity/sonar": { label: "Fast Search", isChampion: false },
    "moonshotai/kimi-k2.5": { label: "Value + Vision", isChampion: false },
    "moonshotai/kimi-k2": { label: "Value Speed", isChampion: false },
    "meta-llama/llama-3.2-11b-vision-instruct": { label: "Light & Fast", isChampion: false },
    "meta-llama/llama-3.3-70b-instruct": { label: "Value Speed", isChampion: false },
    "openai/gpt-5.4": { label: "Overkill / Expensive", isChampion: false, isNotRecommended: true },
    "openai/gpt-5.4-pro": { label: "Overkill / Expensive", isChampion: false, isNotRecommended: true },
    "openai/gpt-5.2": { label: "Overkill / Expensive", isChampion: false, isNotRecommended: true },
    "openai/gpt-4o": { label: "Overkill / Expensive", isChampion: false, isNotRecommended: true },
    "anthropic/claude-opus-4.6": { label: "Overkill / Expensive", isChampion: false, isNotRecommended: true },
    "anthropic/claude-opus-4.5": { label: "Overkill / Expensive", isChampion: false, isNotRecommended: true },
    "anthropic/claude-opus-4.1": { label: "Overkill / Expensive", isChampion: false, isNotRecommended: true },
    "anthropic/claude-opus-4": { label: "Overkill / Expensive", isChampion: false, isNotRecommended: true },
    "anthropic/claude-sonnet-4.6": { label: "Overkill / Expensive", isChampion: false, isNotRecommended: true },
    "anthropic/claude-sonnet-4.5": { label: "Overkill / Expensive", isChampion: false, isNotRecommended: true },
    "anthropic/claude-sonnet-4": { label: "Overkill / Expensive", isChampion: false, isNotRecommended: true },
    "anthropic/claude-3.5-sonnet": { label: "Overkill / Expensive", isChampion: false, isNotRecommended: true },
    "google/gemini-3.1-pro-preview": { label: "Overkill / Expensive", isChampion: false, isNotRecommended: true },
    "openai/o3": { label: "Overkill / Slow", isChampion: false, isNotRecommended: true },
    "openai/o1": { label: "Overkill / Slow", isChampion: false, isNotRecommended: true },
    "perplexity/sonar-reasoning-pro": { label: "Overkill / Slow", isChampion: false, isNotRecommended: true },
    "perplexity/sonar-pro-search": { label: "Overkill / Expensive", isChampion: false, isNotRecommended: true },
    "perplexity/sonar-pro": { label: "Overkill / Expensive", isChampion: false, isNotRecommended: true },
    "perplexity/sonar-deep-research": { label: "Overkill / Slow", isChampion: false, isNotRecommended: true },
  },
};

export function getRoleBadge(modelId: string, role: Role | null): RoleBadge | null {
  if (!role) return null;
  return CHAMPION_MATRIX[role]?.[modelId] || null;
}

export const AVAILABLE_MODELS: ModelConfig[] = [
  // OpenAI - GPT-5.4 Series (Latest)
  {
    id: "openai/gpt-5.4",
    name: "GPT-5.4",
    provider: "OpenAI",
    specialty: "Unified Codex + GPT, 1M context",
    cost: 3,
    vision: true,
    capabilities: ["reasoning", "coding", "writing", "vision"],
    badge: "Recommended",
    apiCostInput: 2.5,
    apiCostOutput: 15,
    contextWindow: 1000000,
    isReasoningModel: false,
    reasoningTokenMultiplier: 1
  },
  {
    id: "openai/gpt-5.4-pro",
    name: "GPT-5.4 Pro",
    provider: "OpenAI",
    specialty: "Highest capability, adaptive reasoning",
    cost: 4,
    vision: true,
    capabilities: ["reasoning", "coding", "writing", "vision"],
    badge: "Deep Thinker",
    apiCostInput: 30,
    apiCostOutput: 180,
    contextWindow: 1000000,
    isReasoningModel: true,
    reasoningTokenMultiplier: 1
  },
  // OpenAI - GPT-5.2 Series
  {
    id: "openai/gpt-5.2",
    name: "GPT-5.2",
    provider: "OpenAI",
    specialty: "Latest frontier, 400K context",
    cost: 3,
    vision: true,
    capabilities: ["reasoning", "coding", "writing", "vision"],
    badge: "Recommended",
    apiCostInput: 1.75,
    apiCostOutput: 14,
    contextWindow: 500000,
    isReasoningModel: false,
    reasoningTokenMultiplier: 1
  },
  {
    id: "openai/gpt-5.2-pro",
    name: "GPT-5.2 Pro",
    provider: "OpenAI",
    specialty: "Most advanced, agentic",
    cost: 4,
    vision: true,
    capabilities: ["reasoning", "coding", "writing", "vision"],
    badge: "Deep Thinker",
    apiCostInput: 21,
    apiCostOutput: 168,
    contextWindow: 500000,
    isReasoningModel: true,
    reasoningTokenMultiplier: 1
  },
  {
    id: "openai/gpt-5.2-chat",
    name: "GPT-5.2 Chat",
    provider: "OpenAI",
    specialty: "Fast, conversational",
    cost: 2,
    vision: true,
    capabilities: ["fast", "writing", "vision"],
    badge: "Fast",
    apiCostInput: 1.75,
    apiCostOutput: 14,
    contextWindow: 500000,
    isReasoningModel: false,
    reasoningTokenMultiplier: 1
  },
  // OpenAI - GPT-4o (still widely used)
  {
    id: "openai/gpt-4o",
    name: "GPT-4o",
    provider: "OpenAI",
    specialty: "Reliable, vision",
    cost: 2,
    vision: true,
    capabilities: ["coding", "writing", "vision"],
    badge: "Recommended",
    apiCostInput: 2.5,
    apiCostOutput: 10,
    contextWindow: 128000,
    isReasoningModel: false,
    reasoningTokenMultiplier: 1
  },
  {
    id: "openai/gpt-4o-mini",
    name: "GPT-4o Mini",
    provider: "OpenAI",
    specialty: "Fast, affordable",
    cost: 1,
    vision: true,
    capabilities: ["fast", "vision"],
    badge: "Quick Draft",
    apiCostInput: 0.15,
    apiCostOutput: 0.6,
    contextWindow: 128000,
    isReasoningModel: false,
    reasoningTokenMultiplier: 1
  },
  {
    id: "openai/o3",
    name: "o3",
    provider: "OpenAI",
    specialty: "Flagship reasoning, vision",
    cost: 4,
    vision: true,
    capabilities: ["reasoning", "coding", "vision"],
    badge: "Deep Thinker",
    apiCostInput: 2,
    apiCostOutput: 8,
    contextWindow: 200000,
    isReasoningModel: true,
    reasoningTokenMultiplier: 3.5
  },
  {
    id: "openai/o4-mini",
    name: "o4-mini",
    provider: "OpenAI",
    specialty: "Fast reasoning, multimodal",
    cost: 1,
    vision: true,
    capabilities: ["reasoning", "coding", "fast", "vision"],
    badge: "Fast",
    apiCostInput: 1.1,
    apiCostOutput: 4.4,
    contextWindow: 200000,
    isReasoningModel: true,
    reasoningTokenMultiplier: 2
  },
  {
    id: "openai/o3-mini",
    name: "o3-mini",
    provider: "OpenAI",
    specialty: "STEM reasoning",
    cost: 2,
    vision: false,
    capabilities: ["reasoning", "coding"],
    badge: "Deep Thinker",
    apiCostInput: 1.1,
    apiCostOutput: 4.4,
    contextWindow: 200000,
    isReasoningModel: true,
    reasoningTokenMultiplier: 2
  },
  {
    id: "openai/o1",
    name: "o1",
    provider: "OpenAI",
    specialty: "Advanced reasoning, 200K context",
    cost: 4,
    vision: true,
    capabilities: ["reasoning", "coding"],
    badge: "Deep Thinker",
    apiCostInput: 15,
    apiCostOutput: 60,
    contextWindow: 200000,
    isReasoningModel: true,
    reasoningTokenMultiplier: 3
  },
  // Anthropic - Opus Series
  {
    id: "anthropic/claude-opus-4.6",
    name: "Claude Opus 4.6",
    provider: "Anthropic",
    specialty: "Strongest for code & agents",
    cost: 4,
    vision: true,
    capabilities: ["coding", "reasoning", "writing", "vision"],
    badge: "Deep Thinker",
    apiCostInput: 5,
    apiCostOutput: 25,
    contextWindow: 200000,
    isReasoningModel: false,
    reasoningTokenMultiplier: 1
  },
  {
    id: "anthropic/claude-opus-4.5",
    name: "Claude Opus 4.5",
    provider: "Anthropic",
    specialty: "Frontier reasoning, agents",
    cost: 4,
    vision: true,
    capabilities: ["reasoning", "coding", "writing", "vision"],
    badge: "Deep Thinker",
    apiCostInput: 5,
    apiCostOutput: 25,
    contextWindow: 200000,
    isReasoningModel: false,
    reasoningTokenMultiplier: 1
  },
  {
    id: "anthropic/claude-opus-4.1",
    name: "Claude Opus 4.1",
    provider: "Anthropic",
    specialty: "Multi-file refactoring, 200K",
    cost: 4,
    vision: true,
    capabilities: ["coding", "reasoning", "vision"],
    badge: "Deep Thinker",
    apiCostInput: 15,
    apiCostOutput: 75,
    contextWindow: 200000,
    isReasoningModel: false,
    reasoningTokenMultiplier: 1
  },
  {
    id: "anthropic/claude-opus-4",
    name: "Claude Opus 4",
    provider: "Anthropic",
    specialty: "Long-running agentic tasks",
    cost: 4,
    vision: true,
    capabilities: ["coding", "reasoning", "vision"],
    badge: "Deep Thinker",
    apiCostInput: 15,
    apiCostOutput: 75,
    contextWindow: 200000,
    isReasoningModel: false,
    reasoningTokenMultiplier: 1
  },
  // Anthropic - Sonnet Series
  {
    id: "anthropic/claude-sonnet-4.6",
    name: "Claude Sonnet 4.6",
    provider: "Anthropic",
    specialty: "Latest Sonnet, 1M context",
    cost: 3,
    vision: true,
    capabilities: ["coding", "writing", "reasoning", "vision"],
    badge: "Recommended",
    apiCostInput: 3,
    apiCostOutput: 15,
    contextWindow: 1000000,
    isReasoningModel: false,
    reasoningTokenMultiplier: 1
  },
  {
    id: "anthropic/claude-sonnet-4.5",
    name: "Claude Sonnet 4.5",
    provider: "Anthropic",
    specialty: "Best for coding, agentic",
    cost: 3,
    vision: true,
    capabilities: ["coding", "writing", "reasoning", "vision"],
    badge: "Recommended",
    apiCostInput: 3,
    apiCostOutput: 15,
    contextWindow: 200000,
    isReasoningModel: false,
    reasoningTokenMultiplier: 1
  },
  {
    id: "anthropic/claude-sonnet-4",
    name: "Claude Sonnet 4",
    provider: "Anthropic",
    specialty: "Latest, 1M context, vision",
    cost: 3,
    vision: true,
    capabilities: ["coding", "writing", "reasoning", "vision"],
    badge: "Recommended",
    apiCostInput: 3,
    apiCostOutput: 15,
    contextWindow: 200000,
    isReasoningModel: false,
    reasoningTokenMultiplier: 1
  },
  {
    id: "anthropic/claude-3.5-sonnet",
    name: "Claude 3.5 Sonnet",
    provider: "Anthropic",
    specialty: "Balanced, vision",
    cost: 2,
    vision: true,
    capabilities: ["coding", "writing", "reasoning", "vision"],
    badge: "Recommended",
    apiCostInput: 6,
    apiCostOutput: 30,
    contextWindow: 200000,
    isReasoningModel: false,
    reasoningTokenMultiplier: 1
  },
  {
    id: "anthropic/claude-3.5-haiku",
    name: "Claude 3.5 Haiku",
    provider: "Anthropic",
    specialty: "Fast, vision",
    cost: 1,
    vision: true,
    capabilities: ["fast", "vision"],
    badge: "Quick Draft",
    apiCostInput: 0.8,
    apiCostOutput: 4,
    contextWindow: 200000,
    isReasoningModel: false,
    reasoningTokenMultiplier: 1
  },
  // xAI
  {
    id: "x-ai/grok-4",
    name: "Grok 4",
    provider: "xAI",
    specialty: "Latest reasoning, multimodal",
    cost: 3,
    vision: true,
    capabilities: ["reasoning", "coding", "writing", "vision"],
    badge: "Recommended",
    apiCostInput: 3,
    apiCostOutput: 15,
    contextWindow: 131072,
    isReasoningModel: false,
    reasoningTokenMultiplier: 1
  },
  {
    id: "x-ai/grok-4-fast",
    name: "Grok 4 Fast",
    provider: "xAI",
    specialty: "Fast, 2M context",
    cost: 1,
    vision: true,
    capabilities: ["fast", "vision"],
    badge: "Quick Draft",
    apiCostInput: 0.2,
    apiCostOutput: 0.5,
    contextWindow: 131072,
    isReasoningModel: false,
    reasoningTokenMultiplier: 1
  },
  {
    id: "x-ai/grok-3",
    name: "Grok 3",
    provider: "xAI",
    specialty: "Enterprise, reasoning",
    cost: 2,
    vision: false,
    capabilities: ["reasoning", "coding"],
    badge: "Recommended",
    apiCostInput: 3,
    apiCostOutput: 15,
    contextWindow: 131072,
    isReasoningModel: false,
    reasoningTokenMultiplier: 1
  },
  {
    id: "x-ai/grok-3-mini",
    name: "Grok 3 Mini",
    provider: "xAI",
    specialty: "Fast reasoning, 131K context",
    cost: 1,
    vision: false,
    capabilities: ["reasoning", "fast"],
    badge: "Fast",
    apiCostInput: 0.3,
    apiCostOutput: 0.5,
    contextWindow: 131072,
    isReasoningModel: false,
    reasoningTokenMultiplier: 1
  },
  // Meta
  {
    id: "meta-llama/llama-4-maverick",
    name: "Llama 4 Maverick",
    provider: "Meta",
    specialty: "Vision, 1M context, MoE",
    cost: 1,
    vision: true,
    capabilities: ["vision", "reasoning", "coding"],
    badge: "Best for Vision",
    apiCostInput: 0.15,
    apiCostOutput: 0.6,
    contextWindow: 128000,
    isReasoningModel: false,
    reasoningTokenMultiplier: 1
  },
  {
    id: "meta-llama/llama-3.2-11b-vision-instruct",
    name: "Llama 3.2 11B Vision",
    provider: "Meta",
    specialty: "Light vision, fast",
    cost: 1,
    vision: true,
    capabilities: ["fast", "vision"],
    badge: "Quick Draft",
    apiCostInput: 0.049,
    apiCostOutput: 0.049,
    contextWindow: 128000,
    isReasoningModel: false,
    reasoningTokenMultiplier: 1
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct",
    name: "Llama 3.3 70B",
    provider: "Meta",
    specialty: "Open source, value",
    cost: 1,
    vision: false,
    capabilities: ["fast", "coding"],
    badge: "Quick Draft",
    apiCostInput: 0.1,
    apiCostOutput: 0.32,
    contextWindow: 128000,
    isReasoningModel: false,
    reasoningTokenMultiplier: 1
  },
  // Google
  {
    id: "google/gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro",
    provider: "Google",
    specialty: "Latest flagship, 1M context",
    cost: 3,
    vision: true,
    capabilities: ["reasoning", "coding", "writing", "vision"],
    badge: "Best for Long Files",
    apiCostInput: 2,
    apiCostOutput: 12,
    contextWindow: 1000000,
    isReasoningModel: false,
    reasoningTokenMultiplier: 1
  },
  {
    id: "google/gemini-3-pro-preview",
    name: "Gemini 3 Pro",
    provider: "Google",
    specialty: "Flagship, 1M context, reasoning",
    cost: 3,
    vision: true,
    capabilities: ["reasoning", "coding", "writing", "vision"],
    badge: "Best for Long Files",
    apiCostInput: 2,
    apiCostOutput: 12,
    contextWindow: 1000000,
    isReasoningModel: false,
    reasoningTokenMultiplier: 1
  },
  {
    id: "google/gemini-3-flash-preview",
    name: "Gemini 3 Flash",
    provider: "Google",
    specialty: "Fast agentic, 1M context",
    cost: 2,
    vision: true,
    capabilities: ["fast", "coding", "vision"],
    badge: "Fast",
    apiCostInput: 0.5,
    apiCostOutput: 3,
    contextWindow: 1000000,
    isReasoningModel: false,
    reasoningTokenMultiplier: 1
  },
  {
    id: "google/gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "Google",
    specialty: "Multimodal, reasoning",
    cost: 2,
    vision: true,
    capabilities: ["reasoning", "coding", "writing", "vision"],
    badge: "Best for Long Files",
    apiCostInput: 1.25,
    apiCostOutput: 10,
    contextWindow: 1000000,
    isReasoningModel: false,
    reasoningTokenMultiplier: 1
  },
  {
    id: "google/gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "Google",
    specialty: "Fast, efficient",
    cost: 1,
    vision: true,
    capabilities: ["fast", "vision"],
    badge: "Quick Draft",
    apiCostInput: 0.3,
    apiCostOutput: 2.5,
    contextWindow: 1000000,
    isReasoningModel: false,
    reasoningTokenMultiplier: 1
  },
  {
    id: "google/gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash Lite",
    provider: "Google",
    specialty: "Ultra low latency",
    cost: 1,
    vision: true,
    capabilities: ["fast"],
    badge: "Quick Draft",
    apiCostInput: 0.1,
    apiCostOutput: 0.4,
    contextWindow: 1000000,
    isReasoningModel: false,
    reasoningTokenMultiplier: 1
  },
    // Perplexity
  {
    id: "perplexity/sonar-pro-search",
    name: "Sonar Pro Search",
    provider: "Perplexity",
    specialty: "Real-time web search, citations",
    cost: 2,
    vision: true,
    capabilities: ["reasoning", "writing", "vision"],
    badge: "Best for Research",
    apiCostInput: 3,
    apiCostOutput: 15,
    contextWindow: 200000,
    isReasoningModel: false,
    reasoningTokenMultiplier: 1
  },
  {
    id: "perplexity/sonar-reasoning-pro",
    name: "Sonar Reasoning Pro",
    provider: "Perplexity",
    specialty: "Deep reasoning + web search",
    cost: 2,
    vision: true,
    capabilities: ["reasoning", "vision"],
    badge: "Best for Research",
    apiCostInput: 2,
    apiCostOutput: 8,
    contextWindow: 128000,
    isReasoningModel: true,
    reasoningTokenMultiplier: 2
  },
  {
    id: "perplexity/sonar-pro",
    name: "Sonar Pro",
    provider: "Perplexity",
    specialty: "Advanced search, 200K context",
    cost: 2,
    vision: true,
    capabilities: ["reasoning", "writing", "vision"],
    badge: "Best for Research",
    apiCostInput: 3,
    apiCostOutput: 15,
    contextWindow: 200000,
    isReasoningModel: false,
    reasoningTokenMultiplier: 1
  },
  {
    id: "perplexity/sonar-deep-research",
    name: "Sonar Deep Research",
    provider: "Perplexity",
    specialty: "Multi-step deep research",
    cost: 2,
    vision: false,
    capabilities: ["reasoning"],
    badge: "Best for Research",
    apiCostInput: 2,
    apiCostOutput: 8,
    contextWindow: 128000,
    isReasoningModel: true,
    reasoningTokenMultiplier: 2
  },
  {
    id: "perplexity/sonar",
    name: "Sonar",
    provider: "Perplexity",
    specialty: "Fast web search, affordable",
    cost: 1,
    vision: true,
    capabilities: ["fast", "vision"],
    badge: "Value Pick",
    apiCostInput: 1,
    apiCostOutput: 1,
    contextWindow: 127072,
    isReasoningModel: false,
    reasoningTokenMultiplier: 1
  },
  // DeepSeek
  {
    id: "deepseek/deepseek-v3.2",
    name: "DeepSeek V3.2",
    provider: "DeepSeek",
    specialty: "Latest, complex Q&A",
    cost: 1,
    vision: false,
    capabilities: ["reasoning", "coding"],
    badge: "Value Pick",
    apiCostInput: 0.26,
    apiCostOutput: 0.38,
    contextWindow: 128000,
    isReasoningModel: false,
    reasoningTokenMultiplier: 1
  },
  {
    id: "deepseek/deepseek-r1",
    name: "DeepSeek R1",
    provider: "DeepSeek",
    specialty: "Reasoning, open",
    cost: 1,
    vision: false,
    capabilities: ["reasoning"],
    badge: "Deep Thinker",
    apiCostInput: 0.7,
    apiCostOutput: 2.5,
    contextWindow: 128000,
    isReasoningModel: true,
    reasoningTokenMultiplier: 2.5
  },
  {
    id: "deepseek/deepseek-chat",
    name: "DeepSeek V3",
    provider: "DeepSeek",
    specialty: "Coding, value",
    cost: 1,
    vision: false,
    capabilities: ["coding", "fast"],
    badge: "Value Pick",
    apiCostInput: 0.32,
    apiCostOutput: 0.89,
    contextWindow: 128000,
    isReasoningModel: false,
    reasoningTokenMultiplier: 1
  },
  // Moonshot AI - Kimi
  {
    id: "moonshotai/kimi-k2.5",
    name: "Kimi K2.5",
    provider: "Moonshot",
    specialty: "Multimodal, vision, 262K context",
    cost: 1,
    vision: true,
    capabilities: ["reasoning", "coding", "vision"],
    badge: "Value Pick",
    apiCostInput: 0.45,
    apiCostOutput: 2.2,
    contextWindow: 128000,
    isReasoningModel: false,
    reasoningTokenMultiplier: 1
  },
  {
    id: "moonshotai/kimi-k2",
    name: "Kimi K2",
    provider: "Moonshot",
    specialty: "Coding powerhouse, 128K",
    cost: 1,
    vision: false,
    capabilities: ["reasoning", "coding"],
    badge: "Value Pick",
    apiCostInput: 0.55,
    apiCostOutput: 2.2,
    contextWindow: 128000,
    isReasoningModel: false,
    reasoningTokenMultiplier: 1
  }
];

export const DEFAULT_COUNCIL_MODELS = [
  "google/gemini-2.5-flash",
  "anthropic/claude-sonnet-4.6",
  "deepseek/deepseek-v3.2"
];

export const FREE_TIER_COUNCIL_MODELS = [
  "google/gemini-2.5-flash",
  "anthropic/claude-3.5-sonnet",
  "deepseek/deepseek-v3.2"
];

export const FREE_TIER_CHAIRMAN_MODEL = "openai/gpt-4o";

export const PREMIUM_MODEL_IDS = new Set([
  "openai/gpt-5.4-pro",
  "openai/o3",
  "openai/o4-mini",
]);

export const MODEL_FALLBACKS: Record<string, string[]> = {
  "openai/gpt-5.4": ["openai/gpt-5.2", "anthropic/claude-sonnet-4.5"],
  "openai/gpt-5.4-pro": ["openai/gpt-5.2-pro", "anthropic/claude-opus-4.6"],
  "openai/gpt-5.2": ["openai/gpt-4o", "anthropic/claude-sonnet-4"],
  "openai/gpt-5.2-pro": ["openai/gpt-5.4-pro", "anthropic/claude-opus-4.5"],
  "openai/gpt-5.2-chat": ["openai/gpt-4o", "anthropic/claude-3.5-sonnet"],
  "openai/gpt-4o": ["openai/gpt-5.2", "anthropic/claude-3.5-sonnet"],
  "openai/gpt-4o-mini": ["anthropic/claude-3.5-haiku", "google/gemini-2.5-flash"],
  "openai/o3": ["openai/o1", "anthropic/claude-opus-4.6"],
  "openai/o4-mini": ["openai/o3-mini", "anthropic/claude-3.5-haiku"],
  "openai/o3-mini": ["openai/o4-mini", "deepseek/deepseek-r1"],
  "openai/o1": ["openai/o3", "anthropic/claude-opus-4.5"],
  "anthropic/claude-opus-4.6": ["anthropic/claude-opus-4.5", "openai/gpt-5.4-pro"],
  "anthropic/claude-opus-4.5": ["anthropic/claude-opus-4.6", "openai/gpt-5.4-pro"],
  "anthropic/claude-opus-4.1": ["anthropic/claude-opus-4", "openai/o3"],
  "anthropic/claude-opus-4": ["anthropic/claude-opus-4.1", "openai/o3"],
  "anthropic/claude-sonnet-4.5": ["anthropic/claude-sonnet-4", "openai/gpt-5.2"],
  "anthropic/claude-sonnet-4": ["anthropic/claude-sonnet-4.5", "openai/gpt-4o"],
  "anthropic/claude-3.5-sonnet": ["anthropic/claude-sonnet-4", "openai/gpt-4o"],
  "anthropic/claude-3.5-haiku": ["openai/gpt-4o-mini", "google/gemini-2.5-flash"],
  "google/gemini-3-pro-preview": ["google/gemini-2.5-pro", "openai/gpt-5.2"],
  "google/gemini-3-flash-preview": ["google/gemini-2.5-flash", "openai/gpt-4o-mini"],
  "google/gemini-2.5-pro": ["google/gemini-3-pro-preview", "anthropic/claude-sonnet-4"],
  "google/gemini-2.5-flash": ["google/gemini-2.5-flash-lite", "openai/gpt-4o-mini"],
  "google/gemini-2.5-flash-lite": ["google/gemini-2.5-flash", "openai/gpt-4o-mini"],
  "x-ai/grok-4": ["x-ai/grok-3", "openai/gpt-5.2"],
  "x-ai/grok-4-fast": ["x-ai/grok-3-mini", "openai/gpt-4o-mini"],
  "x-ai/grok-3": ["x-ai/grok-4", "openai/gpt-4o"],
  "x-ai/grok-3-mini": ["x-ai/grok-4-fast", "openai/gpt-4o-mini"],
  "deepseek/deepseek-v3.2": ["deepseek/deepseek-chat", "openai/gpt-4o-mini"],
  "deepseek/deepseek-r1": ["openai/o3-mini", "openai/o4-mini"],
  "deepseek/deepseek-chat": ["deepseek/deepseek-v3.2", "openai/gpt-4o-mini"],
  "moonshotai/kimi-k2.5": ["moonshotai/kimi-k2", "openai/gpt-4o-mini"],
  "moonshotai/kimi-k2": ["moonshotai/kimi-k2.5", "deepseek/deepseek-v3.2"],
  "meta-llama/llama-4-maverick": ["meta-llama/llama-3.3-70b-instruct", "openai/gpt-4o-mini"],
  "meta-llama/llama-3.2-11b-vision-instruct": ["meta-llama/llama-4-maverick", "openai/gpt-4o-mini"],
  "meta-llama/llama-3.3-70b-instruct": ["meta-llama/llama-4-maverick", "openai/gpt-4o-mini"],
  "perplexity/sonar-pro-search": ["perplexity/sonar-pro", "openai/gpt-4o"],
  "perplexity/sonar-reasoning-pro": ["perplexity/sonar-pro-search", "openai/o3"],
  "perplexity/sonar-pro": ["perplexity/sonar-pro-search", "openai/gpt-4o"],
  "perplexity/sonar-deep-research": ["perplexity/sonar-reasoning-pro", "openai/o3"],
  "perplexity/sonar": ["perplexity/sonar-pro", "openai/gpt-4o-mini"],
  "anthropic/claude-sonnet-4.6": ["anthropic/claude-sonnet-4.5", "openai/gpt-5.4"],
  "google/gemini-3.1-pro-preview": ["google/gemini-3-pro-preview", "openai/gpt-5.2"],
};

export const DEFAULT_CHAIRMAN_MODEL = "openai/gpt-5.2";

export function getModelById(id: string): ModelConfig | undefined {
  return AVAILABLE_MODELS.find(m => m.id === id);
}

export function getCostDisplay(cost: number): string {
  return "$".repeat(cost);
}

export function getCreditTierLabel(cost: number): string {
  if (cost <= 1) return "Low";
  if (cost <= 2) return "Medium";
  if (cost <= 3) return "High";
  return "Very High";
}

export function isVisionCapable(modelId: string): boolean {
  const model = getModelById(modelId);
  return model?.vision ?? false;
}

export function getModelContextWindow(modelId: string): number {
  const model = getModelById(modelId);
  return model?.contextWindow ?? 128000;
}

export const COST_PER_CREDIT = 0.058;
export const FREE_TIER_CREDITS = 30;

export function getUserTier(totalCreditsPurchased: number, currentBalance: number = 0): string {
  const effective = Math.max(totalCreditsPurchased, currentBalance);
  if (effective >= 1000) return 'mastermind';
  if (effective >= 400) return 'strategist';
  if (effective >= 100) return 'explorer';
  if (totalCreditsPurchased > 0) return 'explorer';
  return 'free';
}

export const DELIVERABLE_KEYWORDS = /\b(produce|create|write|build|design|draft|generate|develop|compose|craft|prepare|outline|plan|make|construct|formulate|devise|put together|come up with|give me|provide)\b/i;


const BASE_PROMPT_TOKENS = 800;
const SYSTEM_OVERHEAD_TOKENS = 1500;
const STAGE1_OUTPUT_CAP = 2500;
const STAGE2_OUTPUT_CAP = 2048;
const STAGE3_OUTPUT_CAP = 4000;
const STAGE3_DELIVERABLE_OUTPUT_CAP = 8000;
const CHAIRMAN_CONTINUATION_CAP = 4000;
const CHAIRMAN_CONTINUATION_PROBABILITY = 0.4;
const UTIL = 0.85;

export function estimateDebateCost(
  councilModels: string[],
  chairmanModel: string,
  attachmentTokens: number = 0,
  priorContextTokens: number = 0,
  isDeliverable: boolean = false
): number {
  const { standardCost, reasoningCost } = estimateDebateCostWithBufferInfo(
    councilModels, chairmanModel, attachmentTokens, priorContextTokens, isDeliverable
  );
  return standardCost + reasoningCost;
}

function niceRound(n: number): number {
  if (n <= 10) return Math.round(n);
  if (n <= 20) return Math.round(n / 2) * 2;
  if (n <= 50) return Math.round(n / 5) * 5;
  return Math.round(n / 10) * 10;
}

const STANDARD_BUFFER = 0.20;
const REASONING_BUFFER = 0.35;
const TARGET_MARGIN = 0.65;
const WORST_CASE_NET_PER_CREDIT = 0.174;
const COST_PER_CREDIT_BUDGET = 0.058;
export const OVERRUN_CAP_MULTIPLIER = 1.3;

export function computeCreditCharge(
  standardApiCost: number,
  reasoningApiCost: number = 0
): number {
  const bufferedStandard = standardApiCost * (1 + STANDARD_BUFFER);
  const bufferedReasoning = reasoningApiCost * (1 + REASONING_BUFFER);
  const totalBuffered = bufferedStandard + bufferedReasoning;
  return Math.max(2, Math.ceil(totalBuffered / COST_PER_CREDIT_BUDGET));
}

export function estimateDebateCostWithBufferInfo(
  councilModels: string[],
  chairmanModel: string,
  attachmentTokens: number = 0,
  priorContextTokens: number = 0,
  isDeliverable: boolean = false
): { standardCost: number; reasoningCost: number; hasReasoningModels: boolean } {
  const baseInput = BASE_PROMPT_TOKENS + SYSTEM_OVERHEAD_TOKENS + priorContextTokens;
  const councilCount = councilModels.length || 3;
  let standardCost = 0;
  let reasoningCost = 0;

  for (const modelId of councilModels) {
    const model = getModelById(modelId);
    if (!model) continue;

    const s1Input = baseInput + attachmentTokens;
    const s1Output = Math.round(STAGE1_OUTPUT_CAP * UTIL);
    const s1Cost = (s1Input * model.apiCostInput + s1Output * model.apiCostOutput * model.reasoningTokenMultiplier) / 1_000_000;

    const s2Input = baseInput + 2 * s1Output;
    const s2Output = Math.round(STAGE2_OUTPUT_CAP * UTIL);
    const s2Cost = (s2Input * model.apiCostInput + s2Output * model.apiCostOutput * model.reasoningTokenMultiplier) / 1_000_000;

    if (model.isReasoningModel) {
      reasoningCost += s1Cost + s2Cost;
    } else {
      standardCost += s1Cost + s2Cost;
    }
  }

  const chairman = getModelById(chairmanModel);
  if (chairman) {
    const s1Out = Math.round(STAGE1_OUTPUT_CAP * UTIL);
    const s2Out = Math.round(STAGE2_OUTPUT_CAP * UTIL);
    const s3Input = baseInput + councilCount * s1Out + councilCount * s2Out;
    const effectiveS3Cap = isDeliverable ? STAGE3_DELIVERABLE_OUTPUT_CAP : STAGE3_OUTPUT_CAP;
    const s3Output = Math.round(effectiveS3Cap * UTIL);
    const s3Cost = (s3Input * chairman.apiCostInput + s3Output * chairman.apiCostOutput * chairman.reasoningTokenMultiplier) / 1_000_000;

    const contInput = baseInput + Math.round(6000 * 0.75);
    const contOutput = Math.round(CHAIRMAN_CONTINUATION_CAP * UTIL);
    const contCost = ((contInput * chairman.apiCostInput + contOutput * chairman.apiCostOutput * chairman.reasoningTokenMultiplier) / 1_000_000) * CHAIRMAN_CONTINUATION_PROBABILITY;

    const totalChairmanCost = s3Cost + contCost;

    if (chairman.isReasoningModel) {
      reasoningCost += totalChairmanCost;
    } else {
      standardCost += totalChairmanCost;
    }
  }

  return { standardCost, reasoningCost, hasReasoningModels: reasoningCost > 0 };
}

export function getDebateCreditCost(
  councilModels: string[],
  chairmanModel: string,
  attachmentTokens: number = 0,
  priorContextTokens: number = 0,
  isDeliverable: boolean = false
): number {
  const { standardCost, reasoningCost } = estimateDebateCostWithBufferInfo(
    councilModels, chairmanModel, attachmentTokens, priorContextTokens, isDeliverable
  );
  return computeCreditCharge(standardCost, reasoningCost);
}
