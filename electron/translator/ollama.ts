import { loadConfig } from '../config';
import type {
  MergedProcess,
  MergeProcessInput,
  ProcessToTextInput,
  ProcessTranslation,
  TextToProcessInput,
  TextToVsmInput,
  TranslationProvider,
  VsmToTextInput,
  VsmTranslation,
} from '../../src/model/types';
import {
  mergeSystem,
  processToTextSystem,
  textToProcessSystem,
  textToVsmSystem,
  vsmToTextSystem,
} from './prompts';
import {
  describeParseFailure,
  lineCountOf,
  MERGE_SCHEMA,
  mergeUserMessage,
  processToTextUserMessage,
  PROCESS_SCHEMA,
  pruneProcess,
  stripFence,
  textToProcessUserMessage,
  textToVsmUserMessage,
  toProcessEdges,
  toProcessNodes,
  toVsm,
  VSM_SCHEMA,
  vsmToTextUserMessage,
  ZMerge,
  ZProcess,
  ZVsm,
} from './shape';
import type { z } from 'zod';

/**
 * Local models via Ollama. Same prompts as the Anthropic adapter, different
 * transport — Ollama has no tool-use contract we can rely on across models, so
 * structure comes from passing the JSON Schema as `format` (Ollama ≥ 0.5
 * constrains generation to it) and validating the result the same way.
 *
 * Offline in the sense that matters here: no key, no cloud. It does need Ollama
 * running locally with a model pulled.
 */
export class OllamaTranslator implements TranslationProvider {
  readonly id = 'ollama';
  readonly label = 'Local model (Ollama)';
  readonly blurb = 'No key, nothing leaves your machine. Needs Ollama running with a model pulled.';
  readonly offline = true;
  readonly needsApiKey = false;
  readonly supportsInstructions = true;

  private endpoint(): string {
    return loadConfig().ollamaEndpoint.replace(/\/+$/, '');
  }

  isConfigured(): boolean {
    return Boolean(loadConfig().ollamaModel);
  }

  async test(): Promise<{ ok: boolean; message: string }> {
    const { ollamaModel } = loadConfig();
    try {
      const models = await this.listModels();
      if (!models.length) {
        return {
          ok: false,
          message: `Ollama is running at ${this.endpoint()} but has no models. Pull one first, e.g. "ollama pull qwen2.5:14b".`,
        };
      }
      if (!models.includes(ollamaModel)) {
        return {
          ok: false,
          message: `Ollama has no model called "${ollamaModel}". Available: ${models.join(', ')}.`,
        };
      }
      await this.chat('Reply with the single word: ready', 'You are terse.', undefined);
      return { ok: true, message: `Ready — ${ollamaModel} responded, entirely on this machine.` };
    } catch (error) {
      return { ok: false, message: describeError(error, this.endpoint()) };
    }
  }

  /** Model names available locally, for the Settings dropdown. */
  async listModels(): Promise<string[]> {
    const response = await fetch(`${this.endpoint()}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Ollama replied ${response.status} to /api/tags.`);
    const body = (await response.json()) as { models?: { name: string }[] };
    return (body.models ?? []).map((model) => model.name);
  }

  private async chat(
    user: string,
    system: string,
    format: Record<string, unknown> | undefined,
  ): Promise<string> {
    const { ollamaModel } = loadConfig();
    if (!ollamaModel) {
      throw new Error('No local model selected. Pick one in Settings.');
    }

    const response = await fetch(`${this.endpoint()}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        stream: false,
        // Local models drift badly at high temperature on structured output.
        options: { temperature: 0.1, num_ctx: 16384 },
        ...(format ? { format } : {}),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      // Local generation is slow; a small model on CPU can genuinely take minutes.
      signal: AbortSignal.timeout(600_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Ollama replied ${response.status}. ${detail.slice(0, 300)}`.trim());
    }

    const body = (await response.json()) as { message?: { content?: string } };
    const content = body.message?.content?.trim();
    if (!content) throw new Error('The local model returned an empty response.');
    return content;
  }

  private async structured<T extends z.ZodTypeAny>(
    schema: T,
    jsonSchema: Record<string, unknown>,
    system: string,
    user: string,
  ): Promise<z.infer<T>> {
    let raw: string;
    try {
      raw = await this.chat(user, system, jsonSchema);
    } catch (error) {
      throw new Error(describeError(error, this.endpoint()));
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(stripFence(raw));
    } catch {
      throw new Error(
        'The local model did not return valid JSON. Smaller models often struggle with this — try a larger one, or the built-in translator.',
      );
    }

    const parsed = schema.safeParse(parsedJson);
    if (!parsed.success) throw new Error(describeParseFailure(parsed.error));
    return parsed.data;
  }

  async textToProcess(input: TextToProcessInput): Promise<ProcessTranslation> {
    const count = lineCountOf(input.text);
    const result = await this.structured(
      ZProcess,
      PROCESS_SCHEMA,
      textToProcessSystem(),
      textToProcessUserMessage(input),
    );
    return pruneProcess({
      nodes: toProcessNodes(result.nodes, count),
      edges: toProcessEdges(result.edges, count),
    });
  }

  async processToText(input: ProcessToTextInput): Promise<string> {
    try {
      const text = await this.chat(
        processToTextUserMessage(input),
        processToTextSystem(),
        undefined,
      );
      return stripFence(text).trim();
    } catch (error) {
      throw new Error(describeError(error, this.endpoint()));
    }
  }

  async textToVsm(input: TextToVsmInput): Promise<VsmTranslation> {
    const result = await this.structured(
      ZVsm,
      VSM_SCHEMA,
      textToVsmSystem(),
      textToVsmUserMessage(input),
    );
    return toVsm(
      result,
      lineCountOf(input.text),
      new Set(input.availableDiagrams.map((d) => d.id)),
    );
  }

  async vsmToText(input: VsmToTextInput): Promise<string> {
    try {
      const text = await this.chat(vsmToTextUserMessage(input), vsmToTextSystem(), undefined);
      return stripFence(text).trim();
    } catch (error) {
      throw new Error(describeError(error, this.endpoint()));
    }
  }

  async mergeProcess(input: MergeProcessInput): Promise<MergedProcess> {
    const count = lineCountOf(input.editedText);
    const result = await this.structured(
      ZMerge,
      MERGE_SCHEMA,
      mergeSystem(),
      mergeUserMessage(input),
    );
    const pruned = pruneProcess({
      nodes: toProcessNodes(result.nodes, count),
      edges: toProcessEdges(result.edges, count),
    });
    return { ...pruned, text: stripFence(result.text).trim(), notes: result.notes ?? [] };
  }
}

function describeError(error: unknown, endpoint: string): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return `Ollama at ${endpoint} did not respond in time. A large model on CPU can be very slow — try a smaller one.`;
  }
  if (error instanceof TypeError) {
    // fetch throws TypeError when it cannot connect at all.
    return `Could not reach Ollama at ${endpoint}. Start it with "ollama serve", or switch to the built-in offline translator in Settings.`;
  }
  return error instanceof Error ? error.message : String(error);
}
