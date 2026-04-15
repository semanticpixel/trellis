import { realpathSync } from 'fs';
import { resolve } from 'path';

/**
 * Validates that a path is within the workspace directory.
 * Returns an error message if invalid, or null if valid.
 */
export function validatePath(absPath: string, workspacePath: string): string | null {
  // Normalize the path
  const normalizedPath = resolve(absPath);
  const normalizedWorkspace = resolve(workspacePath);

  // Check the path is within workspace
  if (!normalizedPath.startsWith(normalizedWorkspace + '/') && normalizedPath !== normalizedWorkspace) {
    return `Path is outside workspace: ${normalizedPath}`;
  }

  // Try to resolve symlinks to prevent traversal
  try {
    const realPath = realpathSync(normalizedPath);
    if (!realPath.startsWith(normalizedWorkspace + '/') && realPath !== normalizedWorkspace) {
      return `Path resolves outside workspace (symlink traversal): ${realPath}`;
    }
  } catch {
    // File may not exist yet (write_file) — the prefix check is sufficient
  }

  return null;
}
