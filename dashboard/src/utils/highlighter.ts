import type { Highlighter, ThemedToken } from 'shiki';

const LANGS = [
  'typescript', 'tsx', 'javascript', 'jsx', 'json', 'css', 'html', 'markdown',
  'python', 'rust', 'go', 'java', 'yaml', 'toml', 'sql', 'shell',
] as const;
export type ShikiLang = typeof LANGS[number] | 'plaintext';

const THEME = 'github-dark';

let highlighterPromise: Promise<Highlighter> | null = null;

function loadHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then((m) =>
      m.createHighlighter({ themes: [THEME], langs: [...LANGS] }),
    );
  }
  return highlighterPromise;
}

export function languageFromFile(file: string): ShikiLang {
  const ext = file.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, ShikiLang> = {
    ts: 'typescript', tsx: 'tsx',
    js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript',
    json: 'json', css: 'css', scss: 'css',
    html: 'html', htm: 'html',
    md: 'markdown', markdown: 'markdown',
    py: 'python', rs: 'rust', go: 'go', java: 'java',
    yaml: 'yaml', yml: 'yaml', toml: 'toml',
    sql: 'sql', sh: 'shell', bash: 'shell', zsh: 'shell',
  };
  return map[ext] ?? 'plaintext';
}

export function languageFromMarkdownClass(className: string | undefined): ShikiLang {
  if (!className) return 'plaintext';
  const match = className.match(/language-([\w-]+)/);
  if (!match) return 'plaintext';
  const lang = match[1]!.toLowerCase();
  if ((LANGS as readonly string[]).includes(lang)) return lang as ShikiLang;
  // Common aliases
  if (lang === 'ts') return 'typescript';
  if (lang === 'js') return 'javascript';
  if (lang === 'sh' || lang === 'bash' || lang === 'zsh') return 'shell';
  if (lang === 'yml') return 'yaml';
  if (lang === 'py') return 'python';
  return 'plaintext';
}

export interface HighlightResult {
  /** Per-line tokens. Empty array if highlighting failed. */
  lines: ThemedToken[][];
  /** Background color recommended by the theme. */
  bg: string;
  /** Foreground color recommended by the theme. */
  fg: string;
}

export async function highlightCode(code: string, lang: ShikiLang): Promise<HighlightResult> {
  try {
    const h = await loadHighlighter();
    const out = h.codeToTokens(code, { lang, theme: THEME });
    return { lines: out.tokens, bg: out.bg ?? 'transparent', fg: out.fg ?? 'inherit' };
  } catch {
    // Unknown language or shiki failure: render plain.
    const lines = code.split('\n').map((line) => [{ content: line, color: undefined } as ThemedToken]);
    return { lines, bg: 'transparent', fg: 'inherit' };
  }
}
