// Canonical TypeScript interfaces for Trellis
// All modules import types from here — do NOT define local types that duplicate these.

// ── Database Entities ──────────────────────────────────────────

export interface Workspace {
  id: string;
  name: string;
  path: string;
  color: string;
  sort_order: number;
  created_at: string;
}

export interface Repo {
  id: string;
  workspace_id: string;
  name: string;
  path: string;
  current_branch: string | null;
  default_branch: string;
  remote_url: string | null;
  created_at: string;
}

export interface Thread {
  id: string;
  workspace_id: string;
  repo_id: string | null; // null = workspace-level thread
  title: string;
  provider: ProviderType;
  model: string;
  system_prompt: string | null;
  status: ThreadStatus;
  base_commit: string | null;
  created_at: string;
  updated_at: string;
}

export type ThreadStatus = 'idle' | 'running' | 'awaiting-approval' | 'done' | 'error';

export interface Message {
  id: number;
  thread_id: string;
  role: MessageRole;
  content: string;
  tool_name: string | null;
  tool_use_id: string | null;
  token_count: number | null;
  created_at: string;
}

export type MessageRole = 'user' | 'assistant' | 'tool';

export interface Annotation {
  id: string;
  thread_id: string;
  target_type: AnnotationTargetType;
  target_ref: string; // "file/path:lineNumber" or "stepId"
  annotation_type: AnnotationType;
  text: string;
  replacement: string | null;
  resolved: number; // 0 or 1
  created_at: string;
}

export type AnnotationTargetType = 'diff_line' | 'plan_step';
export type AnnotationType = 'comment' | 'question' | 'delete' | 'replace';

export interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  base_url: string | null;
  default_model: string | null;
  created_at: string;
}

export type ProviderType = 'anthropic' | 'openai' | 'ollama' | 'custom';

// ── WebSocket Envelope ─────────────────────────────────────────

export interface WSMessage {
  threadId: string;
  type: WSEventType;
  data: unknown;
  timestamp: number;
}

export type WSEventType =
  | 'thread_message'
  | 'thread_stream_start'
  | 'thread_stream_delta'
  | 'thread_stream_end'
  | 'thread_tool_start'
  | 'thread_tool_end'
  | 'thread_status'
  | 'thread_error'
  | 'repo_update'
  | 'workspace_update'
  | 'terminal_output'
  | 'terminal_exit';

// ── Terminal Protocol (client → server) ───────────────────────

export interface TerminalStartMessage {
  type: 'terminal_start';
  workspaceId: string;
  cwd: string; // repo path or workspace path
  cols: number;
  rows: number;
}

export interface TerminalInputMessage {
  type: 'terminal_input';
  workspaceId: string;
  data: string;
}

export interface TerminalResizeMessage {
  type: 'terminal_resize';
  workspaceId: string;
  cols: number;
  rows: number;
}

export type TerminalClientMessage =
  | TerminalStartMessage
  | TerminalInputMessage
  | TerminalResizeMessage;

// ── LLM Types ──────────────────────────────────────────────────

export interface LLMMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolUseId?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>; // JSON Schema
}

export interface StreamRequest {
  messages: LLMMessage[];
  tools: ToolDefinition[];
  systemPrompt: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  abortSignal?: AbortSignal;
}

export type StreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; id: string; partialInput: string }
  | { type: 'tool_use_end'; id: string; name: string; input: unknown }
  | { type: 'message_end'; usage: UsageData }
  | { type: 'error'; error: Error };

export interface UsageData {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

// ── Tool Types ─────────────────────────────────────────────────

export interface ToolResult {
  output: string;
  isError: boolean;
}

export interface ToolContext {
  workspacePath: string;
  threadId: string;
}

// ── API Request/Response Types ─────────────────────────────────

export interface CreateWorkspaceRequest {
  name: string;
  path: string;
  color?: string;
}

export interface CreateThreadRequest {
  workspace_id: string;
  repo_id?: string;
  title?: string;
  provider?: ProviderType;
  model?: string;
  system_prompt?: string;
}

export interface SendMessageRequest {
  content: string;
}

export interface CreateAnnotationRequest {
  target_type: AnnotationTargetType;
  target_ref: string;
  annotation_type: AnnotationType;
  text: string;
  replacement?: string;
}
