import { execFile } from 'child_process';
import { GIT_TIMEOUT_MS } from '../shared/constants.js';

function git(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

// ── Diff types ──────────────────────────────────────────────────

export interface DiffFileChange {
  file: string;
  additions: number;
  deletions: number;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  oldFile?: string; // for renames
}

export interface DiffResult {
  files: DiffFileChange[];
  patch: string; // full unified diff
  baseRef: string;
}

export interface FileDiff {
  file: string;
  original: string;
  modified: string;
}

// ── Operations ──────────────────────────────────────────────────

export async function getCurrentBranch(repoPath: string): Promise<string> {
  const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath);
  return branch.trim();
}

export async function getHeadCommit(repoPath: string): Promise<string> {
  const commit = await git(['rev-parse', 'HEAD'], repoPath);
  return commit.trim();
}

export async function getDiffSummary(repoPath: string, baseRef?: string): Promise<DiffResult> {
  // If no base ref, diff against HEAD (working tree changes)
  // If base ref provided, diff baseRef..HEAD
  const baseArgs = baseRef
    ? ['diff', '--numstat', baseRef]
    : ['diff', '--numstat', 'HEAD'];

  const nameStatusArgs = baseRef
    ? ['diff', '--name-status', baseRef]
    : ['diff', '--name-status', 'HEAD'];

  const patchArgs = baseRef
    ? ['diff', baseRef]
    : ['diff', 'HEAD'];

  const [numstat, nameStatus, patch] = await Promise.all([
    git(baseArgs, repoPath).catch(() => ''),
    git(nameStatusArgs, repoPath).catch(() => ''),
    git(patchArgs, repoPath).catch(() => ''),
  ]);

  const statusMap = new Map<string, string>();
  for (const line of nameStatus.trim().split('\n')) {
    if (!line) continue;
    const parts = line.split('\t');
    const status = parts[0]![0]; // A, M, D, R
    const file = parts.length === 3 ? parts[2]! : parts[1]!; // renames have old\tnew
    const oldFile = parts.length === 3 ? parts[1] : undefined;
    statusMap.set(file, `${status}|${oldFile ?? ''}`);
  }

  const files: DiffFileChange[] = [];
  for (const line of numstat.trim().split('\n')) {
    if (!line) continue;
    const [add, del, file] = line.split('\t');
    if (!file) continue;

    const statusEntry = statusMap.get(file) ?? 'M|';
    const [statusChar, oldFile] = statusEntry.split('|');

    let status: DiffFileChange['status'] = 'modified';
    if (statusChar === 'A') status = 'added';
    else if (statusChar === 'D') status = 'deleted';
    else if (statusChar === 'R') status = 'renamed';

    files.push({
      file,
      additions: add === '-' ? 0 : parseInt(add!, 10),
      deletions: del === '-' ? 0 : parseInt(del!, 10),
      status,
      oldFile: oldFile || undefined,
    });
  }

  return {
    files,
    patch,
    baseRef: baseRef ?? 'HEAD',
  };
}

export async function getFileDiff(repoPath: string, filePath: string, baseRef?: string): Promise<FileDiff> {
  // Get original content from base ref
  const ref = baseRef ?? 'HEAD';
  const original = await git(['show', `${ref}:${filePath}`], repoPath).catch(() => '');

  // Get current content from working tree
  const { readFile } = await import('fs/promises');
  const { join } = await import('path');
  const modified = await readFile(join(repoPath, filePath), 'utf-8').catch(() => '');

  return { file: filePath, original, modified };
}

export async function stageFile(repoPath: string, filePath: string): Promise<void> {
  await git(['add', filePath], repoPath);
}

export async function unstageFile(repoPath: string, filePath: string): Promise<void> {
  await git(['reset', 'HEAD', filePath], repoPath);
}

export async function revertFile(repoPath: string, filePath: string, baseRef?: string): Promise<void> {
  const ref = baseRef ?? 'HEAD';
  await git(['checkout', ref, '--', filePath], repoPath);
}

export async function getStatus(repoPath: string): Promise<string> {
  return git(['status', '--porcelain'], repoPath);
}

// ── Branch operations ──────────────────────────────────────────

export interface BranchInfo {
  name: string;
  isCurrent: boolean;
  lastCommitDate: string; // ISO date string
  lastCommitMessage: string;
}

export async function listBranches(repoPath: string): Promise<BranchInfo[]> {
  // format: refname, HEAD indicator, committer date ISO, subject
  const output = await git(
    ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)\t%(HEAD)\t%(committerdate:iso-strict)\t%(subject)', 'refs/heads/'],
    repoPath,
  );

  const branches: BranchInfo[] = [];
  for (const line of output.trim().split('\n')) {
    if (!line) continue;
    const [name, head, date, ...msgParts] = line.split('\t');
    if (!name) continue;
    branches.push({
      name,
      isCurrent: head === '*',
      lastCommitDate: date ?? '',
      lastCommitMessage: msgParts.join('\t'),
    });
  }
  return branches;
}

export async function checkoutBranch(repoPath: string, branchName: string): Promise<void> {
  await git(['checkout', branchName], repoPath);
}

export async function createBranch(repoPath: string, branchName: string, startPoint?: string): Promise<void> {
  const args = ['checkout', '-b', branchName];
  if (startPoint) args.push(startPoint);
  await git(args, repoPath);
}

export async function readPlanFile(repoPath: string): Promise<string | null> {
  const { readFile } = await import('fs/promises');
  const { join } = await import('path');
  try {
    return await readFile(join(repoPath, '.trellis-plan.md'), 'utf-8');
  } catch {
    return null;
  }
}
