import { readdir, stat } from 'fs/promises';
import { resolve, relative } from 'path';
import type { Tool } from './types.js';
import { validatePath } from './validate-path.js';

export const listFilesTool: Tool = {
  definition: {
    name: 'list_files',
    description: 'List files and directories in the workspace. Optionally provide a subdirectory path to list within. Returns paths relative to the workspace.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Subdirectory path relative to workspace (default: root)',
          default: '.',
        },
        recursive: {
          type: 'boolean',
          description: 'List files recursively (default: false, max depth: 3)',
          default: false,
        },
      },
    },
  },

  async execute(input, context) {
    const relPath = (input.path as string) || '.';
    const recursive = (input.recursive as boolean) ?? false;
    const absPath = resolve(context.workspacePath, relPath);

    const pathError = validatePath(absPath, context.workspacePath);
    if (pathError) {
      return { output: pathError, isError: true };
    }

    try {
      const entries = await listDir(absPath, context.workspacePath, recursive, 0);
      if (entries.length === 0) {
        return { output: '(empty directory)', isError: false };
      }
      return { output: entries.join('\n'), isError: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: `Failed to list files: ${message}`, isError: true };
    }
  },
};

const MAX_ENTRIES = 500;
const MAX_DEPTH = 3;

async function listDir(
  dir: string,
  workspacePath: string,
  recursive: boolean,
  depth: number,
): Promise<string[]> {
  const entries: string[] = [];
  const items = await readdir(dir);

  for (const item of items) {
    if (entries.length >= MAX_ENTRIES) {
      entries.push(`... (truncated at ${MAX_ENTRIES} entries)`);
      break;
    }
    if (item.startsWith('.') || item === 'node_modules') continue;

    const fullPath = resolve(dir, item);
    const stats = await stat(fullPath).catch(() => null);
    if (!stats) continue;

    const rel = relative(workspacePath, fullPath);
    if (stats.isDirectory()) {
      entries.push(`${rel}/`);
      if (recursive && depth < MAX_DEPTH) {
        entries.push(...(await listDir(fullPath, workspacePath, true, depth + 1)));
      }
    } else {
      entries.push(rel);
    }
  }

  return entries;
}
