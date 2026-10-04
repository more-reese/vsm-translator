import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import process from 'node:process';
import esbuild from 'esbuild';
import { createServer } from 'vite';
import electronPath from 'electron';
import { mainConfig, preloadConfig, root } from './esbuild.config.mjs';

/**
 * One command to run the whole app: bundle the Electron main + preload (in watch
 * mode), start the Vite dev server for the renderer, then launch Electron
 * pointed at it. Ctrl-C tears all three down.
 */

let electronProcess = null;
let shuttingDown = false;

async function main() {
  const mainCtx = await esbuild.context({ ...mainConfig, logLevel: 'warning' });
  const preloadCtx = await esbuild.context({ ...preloadConfig, logLevel: 'warning' });
  await Promise.all([mainCtx.rebuild(), preloadCtx.rebuild()]);

  // Sanity-check the bundles before handing them to Electron. A truncated
  // preload does not raise — it just silently fails to expose window.api, and
  // the app comes up as a blank window.
  for (const file of [mainConfig.outfile, preloadConfig.outfile]) {
    const { size } = await stat(file);
    if (size < 512) throw new Error(`${file} looks truncated (${size} bytes). Re-run npm start.`);
  }

  const vite = await createServer({ configFile: `${root}/vite.config.ts` });
  await vite.listen();
  const url = vite.resolvedUrls?.local?.[0];
  if (!url) throw new Error('Vite dev server did not report a local URL.');
  vite.printUrls();

  console.log('\n  Launching VSM Translator…\n');
  electronProcess = spawn(electronPath, ['.'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: url },
  });

  // Watchers start only now. Enabling them earlier triggers a second write of
  // main.cjs/preload.cjs at exactly the moment Electron is reading them, and a
  // half-written preload is indistinguishable from a broken app.
  await Promise.all([mainCtx.watch(), preloadCtx.watch()]);

  electronProcess.on('close', async (code) => {
    if (shuttingDown) return;
    shuttingDown = true;
    await Promise.all([mainCtx.dispose(), preloadCtx.dispose(), vite.close()]);
    process.exit(code ?? 0);
  });

  const stop = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    electronProcess?.kill();
    void Promise.all([mainCtx.dispose(), preloadCtx.dispose(), vite.close()]).then(() =>
      process.exit(0),
    );
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
