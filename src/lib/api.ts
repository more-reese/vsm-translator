import { createBrowserBridge } from './browserBridge';

/**
 * Thin unwrapping layer over the platform bridge. The Electron preload returns
 * {ok, value|error}; everything in the UI would rather have a value or a throw.
 *
 * In a plain browser tab there is no preload, so a localStorage-backed bridge
 * stands in — same surface, same shapes, offline translator only.
 */

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export async function unwrap<T>(promise: Promise<Result<T>>): Promise<T> {
  const result = await promise;
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

export const isElectron = typeof window !== 'undefined' && Boolean(window.api);

export const api: typeof window.api = isElectron ? window.api : createBrowserBridge();
