import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * The Electron main process is bundled to CommonJS. Only `electron` itself stays
 * external — everything else (including the Anthropic SDK, which is ESM-first)
 * gets inlined, which sidesteps require/ESM interop entirely.
 */
export const mainConfig = {
  entryPoints: [path.join(root, 'electron/main.ts')],
  outfile: path.join(root, 'dist-electron/main.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: true,
  external: ['electron'],
  logLevel: 'info',
};

export const preloadConfig = {
  ...mainConfig,
  entryPoints: [path.join(root, 'electron/preload.ts')],
  outfile: path.join(root, 'dist-electron/preload.cjs'),
};

export { root };
