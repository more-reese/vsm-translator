import { app, BrowserWindow, ipcMain, Menu, shell, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { AVAILABLE_MODELS, ensureDirs, loadConfig, publicConfig, saveConfig } from './config';
import * as storage from './storage';
import { getProvider, listProviders, OllamaTranslator } from './translator';
import type {
  MergeProcessInput,
  ProcessToTextInput,
  Project,
  TextToProcessInput,
  TextToVsmInput,
  VsmToTextInput,
} from '../src/model/types';

const DEV_URL = process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;

function iconPath(): string | undefined {
  const p = path.join(app.getAppPath(), 'build', 'icon.png');
  return fs.existsSync(p) ? p : undefined;
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1040,
    minHeight: 640,
    title: 'VSM Translator',
    backgroundColor: '#eef0f5',
    titleBarStyle: 'hiddenInset',
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (DEV_URL) {
    void mainWindow.loadURL(DEV_URL);
  } else {
    void mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  }

  // Anything that wants a browser gets the real browser, not an app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function send(channel: string): void {
  BrowserWindow.getFocusedWindow()?.webContents.send(channel);
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              {
                label: 'Settings…',
                accelerator: 'CmdOrCtrl+,',
                click: () => send('menu:settings'),
              },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Project…', accelerator: 'CmdOrCtrl+N', click: () => send('menu:new-project') },
        { type: 'separator' },
        {
          label: 'Reveal Projects Folder',
          click: () => void shell.openPath(loadConfig().projectsDir),
        },
        ...(isMac ? [] : ([{ type: 'separator' as const }, { role: 'quit' as const }] as const)),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Process',
      submenu: [
        { label: 'Commit', accelerator: 'CmdOrCtrl+Return', click: () => send('menu:commit') },
        { type: 'separator' },
        {
          label: 'Step Back a Commit',
          accelerator: 'CmdOrCtrl+Alt+Left',
          click: () => send('menu:history-back'),
        },
        {
          label: 'Step Forward a Commit',
          accelerator: 'CmdOrCtrl+Alt+Right',
          click: () => send('menu:history-forward'),
        },
        { type: 'separator' },
        {
          label: 'Toggle Process / VSM',
          accelerator: 'CmdOrCtrl+Alt+M',
          click: () => send('menu:toggle-mode'),
        },
        {
          label: 'Go Up a Level',
          accelerator: 'CmdOrCtrl+Up',
          click: () => send('menu:go-up'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

/** Wrap a handler so renderer-side callers get {ok,…} instead of an opaque throw. */
function handle<T>(channel: string, fn: (...args: any[]) => Promise<T> | T): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true as const, value: await fn(...args) };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

function registerIpc(): void {
  handle('config:get', () => ({
    ...publicConfig(),
    models: AVAILABLE_MODELS,
    providers: listProviders(),
  }));
  handle('config:save', (patch) => ({
    ...saveConfig(patch),
    models: AVAILABLE_MODELS,
    providers: listProviders(),
  }));
  handle('config:test', () => getProvider(loadConfig().provider).test());
  handle('config:reveal', () => shell.openPath(loadConfig().projectsDir));
  handle('config:ollamaModels', () => new OllamaTranslator().listModels());

  handle('projects:list', () => storage.listProjects());
  handle('projects:read', (id: string) => storage.readProject(id));
  handle('projects:write', (project: Project) => storage.writeProject(project));
  handle('projects:delete', async (id: string) => {
    const project = storage.readProject(id);
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Delete', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: `Delete "${project?.name ?? id}"?`,
      detail: 'The project file and its whole commit history are removed from disk.',
    });
    if (response !== 0) return false;
    storage.deleteProject(id);
    return true;
  });

  const provider = () => getProvider(loadConfig().provider);
  handle('translate:textToProcess', (i: TextToProcessInput) => provider().textToProcess(i));
  handle('translate:processToText', (i: ProcessToTextInput) => provider().processToText(i));
  handle('translate:textToVsm', (i: TextToVsmInput) => provider().textToVsm(i));
  handle('translate:vsmToText', (i: VsmToTextInput) => provider().vsmToText(i));
  handle('translate:merge', (i: MergeProcessInput) => provider().mergeProcess(i));
}

// ---------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(() => {
    ensureDirs();
    registerIpc();
    buildMenu();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
