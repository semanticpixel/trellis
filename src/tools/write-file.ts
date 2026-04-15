import { writeFile, mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import type { Tool } from './types.js';
import { validatePath } from './validate-path.js';

export const writeFileTool: Tool = {
  definition: {
    name: 'write_file',
    description: 'Write content to a file. Creates the file if it does not exist, or overwrites it if it does. Automatically creates parent directories. The path is relative to the workspace directory.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to the workspace directory',
        },
        content: {
          type: 'string',
          description: 'Content to write to the file',
        },
      },
      required: ['path', 'content'],
    },
  },

  async execute(input, context) {
    const relPath = input.path as string;
    const content = input.content as string;
    const absPath = resolve(context.workspacePath, relPath);

    const pathError = validatePath(absPath, context.workspacePath);
    if (pathError) {
      return { output: pathError, isError: true };
    }

    try {
      await mkdir(dirname(absPath), { recursive: true });
      await writeFile(absPath, content, 'utf-8');
      return { output: `Wrote ${content.length} bytes to ${relPath}`, isError: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: `Failed to write file: ${message}`, isError: true };
    }
  },
};
