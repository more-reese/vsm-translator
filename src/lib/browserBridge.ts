import { BuiltinTranslator } from '../../electron/translator/builtin';
import type { Project, ProjectSummary } from '../model/types';

/**
 * Browser fallback for the Electron preload bridge.
 *
 * Running the renderer in a plain browser tab makes iterating far quicker than
 * restarting Electron, so `npm run web` serves the same app with this standing in
 * for `window.api`: projects live in localStorage instead of JSON files, and the
 * built-in translator runs directly in the page (it is pure TypeScript with no
 * Node dependencies, which is exactly why it can).
 *
 * Claude and Ollama are not offered here — a browser cannot reach the Anthropic
 * API without tripping CORS, and pretending otherwise would just produce a
 * confusing failure at Commit time.
 */

const STORE_KEY = 'vsm-translator.projects';
const CONFIG_KEY = 'vsm-translator.config';

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): Promise<Result<T>> => Promise.resolve({ ok: true, value });
const fail = (error: unknown): Promise<Result<never>> =>
  Promise.resolve({ ok: false, error: error instanceof Error ? error.message : String(error) });

function readStore(): Record<string, Project> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Record<string, Project>;
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, Project>): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

function readBrowserConfig(): { provider: string } {
  try {
    return { provider: 'builtin', ...JSON.parse(localStorage.getItem(CONFIG_KEY) ?? '{}') };
  } catch {
    return { provider: 'builtin' };
  }
}

const translator = new BuiltinTranslator();

const PROVIDERS = [
  {
    id: 'builtin',
    label: translator.label,
    blurb: translator.blurb,
    offline: true,
    needsApiKey: false,
    supportsInstructions: translator.supportsInstructions,
    ready: true,
  },
];

/** Accelerators the Electron menu would normally provide. */
const SHORTCUTS: { match(event: KeyboardEvent): boolean; command: string }[] = [
  { match: (e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter', command: 'menu:commit' },
  { match: (e) => (e.metaKey || e.ctrlKey) && e.key === ',', command: 'menu:settings' },
  { match: (e) => (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n', command: 'menu:new-project' },
  {
    match: (e) => (e.metaKey || e.ctrlKey) && e.altKey && e.key === 'ArrowLeft',
    command: 'menu:history-back',
  },
  {
    match: (e) => (e.metaKey || e.ctrlKey) && e.altKey && e.key === 'ArrowRight',
    command: 'menu:history-forward',
  },
  {
    match: (e) => (e.metaKey || e.ctrlKey) && e.altKey && e.key.toLowerCase() === 'm',
    command: 'menu:toggle-mode',
  },
  { match: (e) => (e.metaKey || e.ctrlKey) && e.key === 'ArrowUp', command: 'menu:go-up' },
];

export function createBrowserBridge(): typeof window.api {
  return {
    config: {
      get: () =>
        ok({
          hasKey: false,
          keySource: 'none' as const,
          keyHint: '',
          model: '',
          provider: readBrowserConfig().provider,
          ollamaEndpoint: '',
          ollamaModel: '',
          projectsDir: 'browser localStorage',
          configPath: 'browser localStorage',
          models: [],
          providers: PROVIDERS,
        }),
      save: (patch: Record<string, unknown>) => {
        localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...readBrowserConfig(), ...patch }));
        return createBrowserBridge().config.get();
      },
      test: () => translator.test().then(ok),
      reveal: () => ok('browser localStorage'),
      ollamaModels: () => ok<string[]>([]),
    },

    projects: {
      list: () => {
        const summaries: ProjectSummary[] = Object.values(readStore())
          .map((project) => ({ id: project.id, name: project.name, updatedAt: project.updatedAt }))
          .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
        return ok(summaries);
      },
      read: (id: string) => ok(readStore()[id] ?? null),
      write: (project: Project) => {
        const next = { ...project, updatedAt: new Date().toISOString() };
        const store = readStore();
        store[next.id] = next;
        try {
          writeStore(store);
        } catch (error) {
          return fail(
            error instanceof Error && error.name === 'QuotaExceededError'
              ? 'Browser storage is full. Delete a project, or use the Electron app.'
              : error,
          );
        }
        return ok(next);
      },
      remove: (id: string) => {
        const store = readStore();
        const project = store[id];
        if (!project) return ok(false);
        if (!window.confirm(`Delete “${project.name}” and its whole history?`)) return ok(false);
        delete store[id];
        writeStore(store);
        return ok(true);
      },
    },

    translate: {
      textToProcess: (input) => translator.textToProcess(input as never).then(ok).catch(fail),
      processToText: (input) => translator.processToText(input as never).then(ok).catch(fail),
      textToVsm: (input) => translator.textToVsm(input as never).then(ok).catch(fail),
      vsmToText: (input) => translator.vsmToText(input as never).then(ok).catch(fail),
      merge: (input) => translator.mergeProcess(input as never).then(ok).catch(fail),
    },

    onMenu: (handler: (command: string) => void) => {
      const onKeyDown = (event: KeyboardEvent) => {
        const shortcut = SHORTCUTS.find((entry) => entry.match(event));
        if (!shortcut) return;
        event.preventDefault();
        handler(shortcut.command);
      };
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    },
  } as typeof window.api;
}
