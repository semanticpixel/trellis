import { readFile, stat } from 'fs/promises';
import { resolve } from 'path';
import type { Tool } from './types.js';
import { MAX_FILE_SIZE_BYTES } from '../shared/constants.js';
import { validatePath } from './validate-path.js';

export const readFileTool: Tool = {
  definition: {
    name: 'read_file',
    description: 'Read the contents of a file. The path is relative to the workspace directory.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to the workspace directory',
        },
      },
      required: ['path'],
    },
  },

  async execute(input, context) {
    const relPath = input.path as string;
    const absPath = resolve(context.workspacePath, relPath);

    const pathError = validatePath(absPath, context.workspacePath);
    if (pathError) {
      return { output: pathError, isError: true };
    }

    try {
      const stats = await stat(absPath);
      if (!stats.isFile()) {
        return { output: `Not a file: ${relPath}`, isError: true };
      }
      if (stats.size > MAX_FILE_SIZE_BYTES) {
        return { output: `File too large: ${stats.size} bytes (limit: ${MAX_FILE_SIZE_BYTES})`, isError: true };
      }
      const content = await readFile(absPath, 'utf-8');
      return { output: content, isError: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: `Failed to read file: ${message}`, isError: true };
    }
  },
};
