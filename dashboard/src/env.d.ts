/// <reference types="vite/client" />

declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

interface Window {
  api?: {
    keys: {
      store: (name: string, value: string) => Promise<boolean>;
      retrieve: (name: string) => Promise<string | null>;
      delete: (name: string) => Promise<boolean>;
      has: (name: string) => Promise<boolean>;
    };
    dialog: {
      openDirectory: () => Promise<string | null>;
    };
    editor: {
      openFile: (workspacePath: string, relPath: string) => Promise<{ ok: boolean; error?: string }>;
    };
    menu: {
      onToggleTerminal: (cb: () => void) => () => void;
      onToggleReview: (cb: () => void) => () => void;
    };
    platform: string;
  };
}
