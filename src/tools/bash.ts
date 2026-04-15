import { execFile } from 'child_process';
import type { Tool } from './types.js';
import { BASH_TIMEOUT_MS } from '../shared/constants.js';

export const bashTool: Tool = {
  definition: {
    name: 'bash',
    description: 'Execute a shell command. The command runs in the workspace directory. Timeout is 2 minutes.',
    input_schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute',
        },
      },
      required: ['command'],
    },
  },

  async execute(input, context) {
    const command = input.command as string;

    return new Promise((resolve) => {
      execFile(
        '/bin/bash',
        ['-c', command],
        {
          cwd: context.workspacePath,
          timeout: BASH_TIMEOUT_MS,
          maxBuffer: 1024 * 1024, // 1MB
          env: { ...process.env, HOME: process.env.HOME },
        },
        (error, stdout, stderr) => {
          if (error) {
            const output = [
              stdout ? `stdout:\n${stdout}` : '',
              stderr ? `stderr:\n${stderr}` : '',
              `exit code: ${error.code ?? 1}`,
            ]
              .filter(Boolean)
              .join('\n');
            resolve({ output: output || error.message, isError: true });
            return;
          }

          const output = [
            stdout ? stdout : '',
            stderr ? `stderr:\n${stderr}` : '',
          ]
            .filter(Boolean)
            .join('\n');

          resolve({ output: output || '(no output)', isError: false });
        },
      );
    });
  },
};
