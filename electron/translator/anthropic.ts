import Anthropic from '@anthropic-ai/sdk';
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
  textToProcessUserMessage,
  textToVsmUserMessage,
  toProcessEdges,
  toProcessNodes,
  toVsm,
  stripFence,
  VSM_SCHEMA,
  vsmToTextUserMessage,
  ZMerge,
  ZProcess,
  ZVsm,
} from './shape';
import type { z } from 'zod';

/**
 * Structured output via a forced tool call rather than a response-format helper:
 * supported by every SDK generation, so this keeps working across SDK upgrades.
 */
export class AnthropicTranslator implements TranslationProvider {
  readonly id = 'anthropic';
  readonly label = 'Anthropic API (Claude)';
  readonly blurb = 'Best quality, understands loose prose. Needs an API key and a network connection.';
  readonly offline = false;
  readonly needsApiKey = true;
  readonly supportsInstructions = true;

  private client(): Anthropic {
    const { apiKey } = loadConfig();
    if (!apiKey) {
      throw new Error(
        'No Anthropic API key. Add one in Settings, switch to the built-in offline translator, or launch with ANTHROPIC_API_KEY set.',
      );
    }
    return new Anthropic({ apiKey, maxRetries: 2 });
  }

  isConfigured(): boolean {
    return Boolean(loadConfig().apiKey);
  }

  async test(): Promise<{ ok: boolean; message: string }> {
    try {
      const { model } = loadConfig();
      await this.client().messages.create({
        model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
      });
      return { ok: true, message: `Key works — ${model} responded.` };
    } catch (error) {
      return { ok: false, message: describeError(error) };
    }
  }

  private async structured<T extends z.ZodTypeAny>(
    schema: T,
    toolName: string,
    toolDescription: string,
    inputSchema: Record<string, unknown>,
    system: string,
    user: string,
  ): Promise<z.infer<T>> {
    const { model } = loadConfig();
    let response: Anthropic.Message;
    try {
      response = await this.client().messages.create({
        model,
        max_tokens: 16000,
        system,
        tools: [
          {
            name: toolName,
            description: toolDescription,
            input_schema: inputSchema as Anthropic.Tool.InputSchema,
          },
        ],
        tool_choice: { type: 'tool', name: toolName },
        messages: [{ role: 'user', content: user }],
      });
    } catch (error) {
      throw new Error(describeError(error));
    }

    if (response.stop_reason === 'max_tokens') {
      throw new Error(
        'The translation was cut off because the process is very large. Try splitting it into sub-processes.',
      );
    }

    const call = response.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === 'tool_use' && block.name === toolName,
    );
    if (!call) {
      throw new Error('The translator did not return a structured result. Try committing again.');
    }

    const parsed = schema.safeParse(call.input);
    if (!parsed.success) throw new Error(describeParseFailure(parsed.error));
    return parsed.data;
  }

  private async plainText(system: string, user: string): Promise<string> {
    const { model } = loadConfig();
    try {
      const response = await this.client().messages.create({
        model,
        max_tokens: 16000,
        system,
        messages: [{ role: 'user', content: user }],
      });
      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim();
      if (!text) throw new Error('The translator returned an empty description.');
      return stripFence(text).trim();
    } catch (error) {
      throw new Error(describeError(error));
    }
  }

  async textToProcess(input: TextToProcessInput): Promise<ProcessTranslation> {
    const count = lineCountOf(input.text);
    const result = await this.structured(
      ZProcess,
      'emit_process',
      'Emit the BPMN process model implied by the text.',
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
    return this.plainText(processToTextSystem(), processToTextUserMessage(input));
  }

  async textToVsm(input: TextToVsmInput): Promise<VsmTranslation> {
    const result = await this.structured(
      ZVsm,
      'emit_vsm',
      'Emit the Viable System Model implied by the text.',
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
    return this.plainText(vsmToTextSystem(), vsmToTextUserMessage(input));
  }

  async mergeProcess(input: MergeProcessInput): Promise<MergedProcess> {
    const count = lineCountOf(input.editedText);
    const result = await this.structured(
      ZMerge,
      'emit_merge',
      'Emit the merged process model and the merged description together.',
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

function describeError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return 'The Anthropic API key was rejected. Check it in Settings.';
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return 'That API key does not have access to this model. Pick another model in Settings.';
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'Rate limited by the Anthropic API. Wait a moment and commit again.';
  }
  if (error instanceof Anthropic.NotFoundError) {
    return 'That model id was not found. Pick another model in Settings.';
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return 'Could not reach the Anthropic API. Check your network, or switch to the built-in offline translator in Settings.';
  }
  if (error instanceof Anthropic.APIError) {
    return `Anthropic API error${error.status ? ` ${error.status}` : ''}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}
