import { useCallback, useEffect, useState } from 'react';
import { api, unwrap } from '../lib/api';
import type { PublicConfig } from '../types/globals';

export function SettingsDialog({
  onClose,
  onProviderChange,
}: {
  onClose(): void;
  onProviderChange?(config: PublicConfig): void;
}) {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [key, setKey] = useState('');
  const [ollamaModels, setOllamaModels] = useState<string[] | null>(null);
  const [status, setStatus] = useState<{ tone: 'ok' | 'bad' | 'info'; message: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  const active = config?.providers.find((p) => p.id === config.provider);

  const refreshOllama = useCallback(async () => {
    try {
      setOllamaModels(await unwrap(api.config.ollamaModels()));
    } catch {
      // Ollama simply isn't running; the Test button explains it properly.
      setOllamaModels([]);
    }
  }, []);

  useEffect(() => {
    void unwrap(api.config.get())
      .then((loaded) => {
        setConfig(loaded);
        if (loaded.provider === 'ollama') void refreshOllama();
      })
      .catch(() => setConfig(null));
  }, [refreshOllama]);

  async function save(patch: Parameters<typeof api.config.save>[0]) {
    setBusy(true);
    try {
      const next = await unwrap(api.config.save(patch));
      setConfig(next);
      onProviderChange?.(next);
      setStatus({ tone: 'info', message: 'Saved.' });
      if (patch.provider === 'ollama') void refreshOllama();
    } catch (error) {
      setStatus({ tone: 'bad', message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setStatus({ tone: 'info', message: 'Checking…' });
    try {
      const result = await unwrap(api.config.test());
      setStatus({ tone: result.ok ? 'ok' : 'bad', message: result.message });
    } catch (error) {
      setStatus({ tone: 'bad', message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>Settings</h2>
        </header>

        <div className="modal-body">
          <div className="field">
            <span>Translator</span>
            <div className="provider-list">
              {(config?.providers ?? []).map((provider) => (
                <label
                  key={provider.id}
                  className={`provider ${config?.provider === provider.id ? 'is-chosen' : ''}`}
                >
                  <input
                    type="radio"
                    name="provider"
                    checked={config?.provider === provider.id}
                    disabled={busy}
                    onChange={() => void save({ provider: provider.id })}
                  />
                  <span className="provider-name">
                    {provider.label}
                    {provider.offline && <span className="badge badge-offline">offline</span>}
                    {!provider.ready && <span className="badge badge-todo">needs setup</span>}
                  </span>
                  <span className="provider-blurb">{provider.blurb}</span>
                </label>
              ))}
            </div>
            <small className="muted">
              The built-in translator needs nothing at all, so the app always works — no key, no
              network, no model download. Switch to Claude or a local model when you want looser
              prose understood.
            </small>
          </div>

          {config?.provider === 'anthropic' && (
            <>
              <label className="field">
                <span>Anthropic API key</span>
                <div className="field-row">
                  <input
                    type="password"
                    placeholder={config?.hasKey ? `stored ${config.keyHint}` : 'sk-ant-…'}
                    value={key}
                    onChange={(event) => setKey(event.target.value)}
                    disabled={config?.keySource === 'env'}
                  />
                  <button
                    type="button"
                    className="btn"
                    disabled={busy || !key || config?.keySource === 'env'}
                    onClick={() => {
                      void save({ apiKey: key.trim() }).then(() => setKey(''));
                    }}
                  >
                    Save
                  </button>
                </div>
                <small className="muted">
                  {config?.keySource === 'env' ? (
                    <>
                      Using <code>ANTHROPIC_API_KEY</code> from the environment — it overrides
                      anything stored here.
                    </>
                  ) : (
                    <>
                      Stored in <code>{config?.configPath}</code>, owner-only. Never sent anywhere
                      except the Anthropic API.
                    </>
                  )}
                </small>
              </label>

              <label className="field">
                <span>Model</span>
                <select
                  value={config?.model ?? ''}
                  disabled={busy}
                  onChange={(event) => void save({ model: event.target.value })}
                >
                  {(config?.models ?? []).map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          {config?.provider === 'ollama' && (
            <>
              <label className="field">
                <span>Ollama endpoint</span>
                <div className="field-row">
                  <input
                    value={config.ollamaEndpoint}
                    disabled={busy}
                    onChange={(event) =>
                      setConfig({ ...config, ollamaEndpoint: event.target.value })
                    }
                    onBlur={(event) => void save({ ollamaEndpoint: event.target.value.trim() })}
                  />
                  <button type="button" className="btn" disabled={busy} onClick={() => void refreshOllama()}>
                    Refresh
                  </button>
                </div>
              </label>

              <label className="field">
                <span>Local model</span>
                <select
                  value={config.ollamaModel}
                  disabled={busy}
                  onChange={(event) => void save({ ollamaModel: event.target.value })}
                >
                  <option value="">— pick a model —</option>
                  {(ollamaModels ?? []).map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                  {config.ollamaModel && !(ollamaModels ?? []).includes(config.ollamaModel) && (
                    <option value={config.ollamaModel}>{config.ollamaModel} (not installed)</option>
                  )}
                </select>
                <small className="muted">
                  {ollamaModels === null
                    ? 'Looking for Ollama…'
                    : ollamaModels.length
                      ? 'Bigger models follow the JSON structure far more reliably than small ones.'
                      : 'No models found. Start Ollama and pull one, e.g. ollama pull qwen2.5:14b'}
                </small>
              </label>
            </>
          )}

          <div className="field-row">
            <button type="button" className="btn" disabled={busy} onClick={test}>
              Test {active?.label ?? 'translator'}
            </button>
          </div>

          <div className="field">
            <span>Projects folder</span>
            <div className="field-row">
              <code className="path">{config?.projectsDir}</code>
              <button type="button" className="btn" onClick={() => void api.config.reveal()}>
                Reveal
              </button>
            </div>
            <small className="muted">
              One pretty-printed JSON file per project — readable, diffable, and safe to put in git.
            </small>
          </div>

          {status && <p className={`status status-${status.tone}`}>{status.message}</p>}
        </div>

        <footer className="modal-footer">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
