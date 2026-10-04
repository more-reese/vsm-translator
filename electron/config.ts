import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface AppConfig {
  apiKey: string;
  model: string;
  /** Which translation adapter to use: 'builtin' | 'anthropic' | 'ollama'. */
  provider: string;
  ollamaEndpoint: string;
  ollamaModel: string;
  projectsDir: string;
}

export const DEFAULT_MODEL = 'claude-opus-5';
export const DEFAULT_OLLAMA_ENDPOINT = 'http://localhost:11434';

export const AVAILABLE_MODELS = [
  { id: 'claude-opus-5', label: 'Claude Opus 5 — most capable (default)' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 — faster, cheaper' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — fastest' },
];

function configDir(): string {
  return path.join(os.homedir(), '.vsm-translator');
}

export function configPath(): string {
  return path.join(configDir(), 'config.json');
}

function defaultProjectsDir(): string {
  return path.join(configDir(), 'projects');
}

export function loadConfig(): AppConfig {
  let stored: Partial<AppConfig> = {};
  try {
    stored = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    // No config yet — first run.
  }

  // Env var wins so you can launch with a throwaway key without editing config.
  const apiKey = process.env.ANTHROPIC_API_KEY || stored.apiKey || '';

  return {
    apiKey,
    model: stored.model || DEFAULT_MODEL,
    // With no explicit choice, pick something that actually works: the offline
    // translator needs nothing, so the app is never dead on arrival.
    provider: stored.provider || (apiKey ? 'anthropic' : 'builtin'),
    ollamaEndpoint: stored.ollamaEndpoint || DEFAULT_OLLAMA_ENDPOINT,
    ollamaModel: stored.ollamaModel || '',
    projectsDir: stored.projectsDir || defaultProjectsDir(),
  };
}

/** What the renderer is allowed to see: never the key itself, just whether we have one. */
export interface PublicConfig {
  hasKey: boolean;
  keySource: 'env' | 'config' | 'none';
  keyHint: string;
  model: string;
  provider: string;
  ollamaEndpoint: string;
  ollamaModel: string;
  projectsDir: string;
  configPath: string;
}

export function publicConfig(): PublicConfig {
  const cfg = loadConfig();
  const fromEnv = Boolean(process.env.ANTHROPIC_API_KEY);
  return {
    hasKey: Boolean(cfg.apiKey),
    keySource: cfg.apiKey ? (fromEnv ? 'env' : 'config') : 'none',
    keyHint: cfg.apiKey ? `…${cfg.apiKey.slice(-6)}` : '',
    model: cfg.model,
    provider: cfg.provider,
    ollamaEndpoint: cfg.ollamaEndpoint,
    ollamaModel: cfg.ollamaModel,
    projectsDir: cfg.projectsDir,
    configPath: configPath(),
  };
}

export function saveConfig(patch: Partial<AppConfig>): PublicConfig {
  fs.mkdirSync(configDir(), { recursive: true });
  let stored: Partial<AppConfig> = {};
  try {
    stored = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    /* first write */
  }
  const next = { ...stored, ...patch };
  // An empty string means "clear the stored key".
  if (patch.apiKey === '') delete next.apiKey;
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  return publicConfig();
}

export function ensureDirs(): void {
  const cfg = loadConfig();
  fs.mkdirSync(cfg.projectsDir, { recursive: true });
}

export function projectsDir(): string {
  return loadConfig().projectsDir;
}

export function appVersion(): string {
  try {
    return app.getVersion();
  } catch {
    return '0.1.0';
  }
}
