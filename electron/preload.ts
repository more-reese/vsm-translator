import { contextBridge, ipcRenderer } from 'electron';

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const invoke = <T>(channel: string, ...args: unknown[]): Promise<Result<T>> =>
  ipcRenderer.invoke(channel, ...args);

const MENU_CHANNELS = [
  'menu:settings',
  'menu:new-project',
  'menu:commit',
  'menu:history-back',
  'menu:history-forward',
  'menu:toggle-mode',
  'menu:go-up',
] as const;

contextBridge.exposeInMainWorld('api', {
  config: {
    get: () => invoke('config:get'),
    save: (patch: unknown) => invoke('config:save', patch),
    test: () => invoke('config:test'),
    reveal: () => invoke('config:reveal'),
    ollamaModels: () => invoke('config:ollamaModels'),
  },
  projects: {
    list: () => invoke('projects:list'),
    read: (id: string) => invoke('projects:read', id),
    write: (project: unknown) => invoke('projects:write', project),
    remove: (id: string) => invoke('projects:delete', id),
  },
  translate: {
    textToProcess: (input: unknown) => invoke('translate:textToProcess', input),
    processToText: (input: unknown) => invoke('translate:processToText', input),
    textToVsm: (input: unknown) => invoke('translate:textToVsm', input),
    vsmToText: (input: unknown) => invoke('translate:vsmToText', input),
    merge: (input: unknown) => invoke('translate:merge', input),
  },
  /** Subscribe to menu commands. Returns an unsubscribe function. */
  onMenu: (handler: (command: string) => void) => {
    const listeners = MENU_CHANNELS.map((channel) => {
      const fn = () => handler(channel);
      ipcRenderer.on(channel, fn);
      return () => ipcRenderer.removeListener(channel, fn);
    });
    return () => listeners.forEach((off) => off());
  },
});
