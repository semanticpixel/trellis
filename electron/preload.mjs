import { contextBridge, ipcRenderer } from 'electron';

// Minimal preload — expose only what the renderer needs via IPC
contextBridge.exposeInMainWorld('api', {
  // API key management via safeStorage
  keys: {
    store: (name, value) => ipcRenderer.invoke('keys:store', name, value),
    retrieve: (name) => ipcRenderer.invoke('keys:retrieve', name),
    delete: (name) => ipcRenderer.invoke('keys:delete', name),
    has: (name) => ipcRenderer.invoke('keys:has', name),
  },

  // Native dialogs
  dialog: {
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  },

  // Platform info
  platform: process.platform,
});
