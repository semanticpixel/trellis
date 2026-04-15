import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import type { Tool } from './types.js';
import { validatePath } from './validate-path.js';

export const editFileTool: Tool = {
  definition: {
    name: 'edit_file',
    description: 'Replace an exact string occurrence in a file. The old_string must match exactly (including whitespace and indentation). The path is relative to the workspace directory.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to the workspace directory',
        },
        old_string: {
          type: 'string',
          description: 'The exact string to find and replace',
        },
        new_string: {
          type: 'string',
          description: 'The replacement string',
        },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },

  async execute(input, context) {
    const relPath = input.path as string;
    const oldString = input.old_string as string;
    const newString = input.new_string as string;
    const absPath = resolve(context.workspacePath, relPath);

    const pathError = validatePath(absPath, context.workspacePath);
    if (pathError) {
      return { output: pathError, isError: true };
    }

    try {
      const content = await readFile(absPath, 'utf-8');
      const index = content.indexOf(oldString);
      if (index === -1) {
        return { output: `old_string not found in ${relPath}`, isError: true };
      }

      // Check for multiple occurrences
      const secondIndex = content.indexOf(oldString, index + 1);
      if (secondIndex !== -1) {
        return { output: `old_string matches multiple locations in ${relPath}. Provide more context to make it unique.`, isError: true };
      }

      const updated = content.slice(0, index) + newString + content.slice(index + oldString.length);
      await writeFile(absPath, updated, 'utf-8');
      return { output: `Edited ${relPath}`, isError: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: `Failed to edit file: ${message}`, isError: true };
    }
  },
};
