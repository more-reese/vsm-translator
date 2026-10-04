import esbuild from 'esbuild';
import { build as viteBuild } from 'vite';
import { mainConfig, preloadConfig, root } from './esbuild.config.mjs';

await Promise.all([esbuild.build(mainConfig), esbuild.build(preloadConfig)]);
await viteBuild({ configFile: `${root}/vite.config.ts` });

console.log('\nBuilt. Renderer → dist/, Electron → dist-electron/.');
console.log('Package a .app with: npm run package\n');
