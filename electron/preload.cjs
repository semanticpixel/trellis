const { contextBridge, ipcRenderer } = require('electron');

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

  // Editor integration
  editor: {
    openFile: (workspacePath, relPath) => ipcRenderer.invoke('editor:openFile', workspacePath, relPath),
  },

  // Application menu events — fired when the user invokes a menu item or
  // its accelerator. Each subscriber returns an unsubscribe function.
  menu: {
    onToggleTerminal: (cb) => {
      const listener = () => cb();
      ipcRenderer.on('menu:toggle-terminal', listener);
      return () => ipcRenderer.removeListener('menu:toggle-terminal', listener);
    },
    onToggleReview: (cb) => {
      const listener = () => cb();
      ipcRenderer.on('menu:toggle-review', listener);
      return () => ipcRenderer.removeListener('menu:toggle-review', listener);
    },
  },

  // Platform info
  platform: process.platform,
});
