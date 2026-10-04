import type { TranslationProvider } from '../../src/model/types';
import { AnthropicTranslator } from './anthropic';
import { BuiltinTranslator } from './builtin';
import { OllamaTranslator } from './ollama';

/**
 * Provider registry.
 *
 * Everything above this line talks to `TranslationProvider` and nothing else, so
 * adding an adapter is: implement the interface, register it here. The order is
 * the order Settings shows them in — offline-and-zero-setup first, because that
 * is the one guaranteed to work.
 */
const providers = new Map<string, TranslationProvider>();

function register(provider: TranslationProvider): void {
  providers.set(provider.id, provider);
}

register(new BuiltinTranslator());
register(new AnthropicTranslator());
register(new OllamaTranslator());

/** Never throws: an unknown or unusable id falls back to the offline provider. */
export function getProvider(id: string): TranslationProvider {
  return providers.get(id) ?? providers.get('builtin')!;
}

export interface ProviderInfo {
  id: string;
  label: string;
  blurb: string;
  offline: boolean;
  needsApiKey: boolean;
  supportsInstructions: boolean;
  ready: boolean;
}

export function listProviders(): ProviderInfo[] {
  return [...providers.values()].map((provider) => ({
    id: provider.id,
    label: provider.label,
    blurb: provider.blurb,
    offline: provider.offline,
    needsApiKey: provider.needsApiKey,
    supportsInstructions: provider.supportsInstructions,
    ready: provider.isConfigured(),
  }));
}

export { OllamaTranslator };
