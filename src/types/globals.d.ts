import type {
  MergedProcess,
  MergeProcessInput,
  ProcessToTextInput,
  ProcessTranslation,
  Project,
  ProjectSummary,
  TextToProcessInput,
  TextToVsmInput,
  VsmToTextInput,
  VsmTranslation,
} from '../model/types';

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export interface ProviderInfo {
  id: string;
  label: string;
  blurb: string;
  offline: boolean;
  needsApiKey: boolean;
  supportsInstructions: boolean;
  ready: boolean;
}

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
  models: { id: string; label: string }[];
  providers: ProviderInfo[];
}

declare global {
  interface Window {
    api: {
      config: {
        get(): Promise<Result<PublicConfig>>;
        save(
          patch: Partial<{
            apiKey: string;
            model: string;
            provider: string;
            ollamaEndpoint: string;
            ollamaModel: string;
          }>,
        ): Promise<Result<PublicConfig>>;
        test(): Promise<Result<{ ok: boolean; message: string }>>;
        reveal(): Promise<Result<string>>;
        ollamaModels(): Promise<Result<string[]>>;
      };
      projects: {
        list(): Promise<Result<ProjectSummary[]>>;
        read(id: string): Promise<Result<Project | null>>;
        write(project: Project): Promise<Result<Project>>;
        remove(id: string): Promise<Result<boolean>>;
      };
      translate: {
        textToProcess(input: TextToProcessInput): Promise<Result<ProcessTranslation>>;
        processToText(input: ProcessToTextInput): Promise<Result<string>>;
        textToVsm(input: TextToVsmInput): Promise<Result<VsmTranslation>>;
        vsmToText(input: VsmToTextInput): Promise<Result<string>>;
        merge(input: MergeProcessInput): Promise<Result<MergedProcess>>;
      };
      onMenu(handler: (command: string) => void): () => void;
    };
  }
}

declare module 'bpmn-js/lib/util/ModelUtil' {
  export function is(element: unknown, type: string): boolean;
  export function getBusinessObject(element: unknown): any;
}

declare module 'diagram-js/lib/features/palette/PaletteProvider';
declare module 'diagram-js/lib/features/context-pad/ContextPadProvider';

export {};
