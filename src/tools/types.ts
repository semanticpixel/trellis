import type { ToolDefinition, ToolResult, ToolContext } from '../shared/types.js';

export interface Tool {
  definition: ToolDefinition;
  execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}
