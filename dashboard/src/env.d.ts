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
    platform: string;
  };
}
