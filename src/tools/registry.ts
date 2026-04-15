import type { Tool } from './types.js';
import type { ToolDefinition } from '../shared/types.js';
import { readFileTool } from './read-file.js';
import { writeFileTool } from './write-file.js';
import { editFileTool } from './edit-file.js';
import { bashTool } from './bash.js';
import { listFilesTool } from './list-files.js';

const allTools: Tool[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  bashTool,
  listFilesTool,
];

const toolMap = new Map<string, Tool>(allTools.map((t) => [t.definition.name, t]));

export function getTool(name: string): Tool | undefined {
  return toolMap.get(name);
}

export function getToolDefinitions(): ToolDefinition[] {
  return allTools.map((t) => t.definition);
}
