import type {
  ChatCompletionResponse,
  ChatMessage,
  TaskModelKey,
  TaskModelPolicies,
  ToolDefinition,
} from '../types.js';
import {
  callRoutedModel,
  callVisionProviderModel,
  extractResponseTextContent,
  type RoutedModelContext,
} from './router.js';

export type AuxiliaryTask = TaskModelKey;

export interface AuxiliaryTaskContext extends RoutedModelContext {
  maxTokens?: number;
}

export interface AuxiliaryVisionTaskCallParams {
  task: 'vision';
  taskModels?: TaskModelPolicies;
  fallbackContext: AuxiliaryTaskContext;
  question: string;
  imageDataUrl: string;
  toolName?: string;
  missingContextSource?: 'active request';
}

export interface AuxiliaryTextTaskCallParams {
  task: Exclude<AuxiliaryTask, 'vision'>;
  taskModels?: TaskModelPolicies;
  fallbackContext: AuxiliaryTaskContext;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  toolName?: string;
}

type AuxiliaryTaskCallParams =
  | AuxiliaryVisionTaskCallParams
  | AuxiliaryTextTaskCallParams;

function cloneAuxiliaryTaskContext(
  context: AuxiliaryTaskContext,
): AuxiliaryTaskContext {
  return {
    ...context,
    requestHeaders: context.requestHeaders
      ? { ...context.requestHeaders }
      : undefined,
  };
}

function resolveTaskOverride(
  task: AuxiliaryTask,
  taskModels?: TaskModelPolicies,
) {
  return taskModels?.[task];
}

function buildMissingContextError(params: {
  toolName: string;
  field: 'API key' | 'base URL' | 'model' | 'chatbot_id';
  source?: 'active request';
}): string {
  const source = params.source ? `${params.source} ` : '';
  return `${params.toolName} is not configured: missing ${source}${params.field} context.`;
}

function getAuxiliaryContextError(params: {
  context: AuxiliaryTaskContext;
  toolName: string;
  missingContextSource?: 'active request';
}): string | null {
  const provider = params.context.provider || 'hybridai';
  if (!String(params.context.baseUrl || '').trim()) {
    return buildMissingContextError({
      toolName: params.toolName,
      field: 'base URL',
      source: params.missingContextSource,
    });
  }
  if (!String(params.context.model || '').trim()) {
    return buildMissingContextError({
      toolName: params.toolName,
      field: 'model',
      source: params.missingContextSource,
    });
  }
  if (
    (provider === 'hybridai' ||
      provider === 'openai-codex' ||
      provider === 'openrouter') &&
    !String(params.context.apiKey || '').trim()
  ) {
    return buildMissingContextError({
      toolName: params.toolName,
      field: 'API key',
      source: params.missingContextSource,
    });
  }
  if (
    provider === 'hybridai' &&
    !String(params.context.chatbotId || '').trim()
  ) {
    return buildMissingContextError({
      toolName: params.toolName,
      field: 'chatbot_id',
      source: params.missingContextSource,
    });
  }
  return null;
}

export function resolveAuxiliaryTaskContext(params: {
  task: AuxiliaryTask;
  taskModels?: TaskModelPolicies;
  fallbackContext: AuxiliaryTaskContext;
  toolName?: string;
}): AuxiliaryTaskContext {
  const taskOverride = resolveTaskOverride(params.task, params.taskModels);
  if (taskOverride?.error) {
    throw new Error(
      `${String(params.toolName || params.task).trim() || params.task} is not configured: ${taskOverride.error}`,
    );
  }
  if (!taskOverride) {
    return cloneAuxiliaryTaskContext(params.fallbackContext);
  }
  return {
    provider: taskOverride.provider,
    baseUrl: String(taskOverride.baseUrl || '').trim(),
    apiKey: String(taskOverride.apiKey || '').trim(),
    model: String(taskOverride.model || '').trim(),
    chatbotId: String(taskOverride.chatbotId || '').trim(),
    requestHeaders: taskOverride.requestHeaders
      ? { ...taskOverride.requestHeaders }
      : undefined,
    isLocal: taskOverride.isLocal,
    contextWindow: taskOverride.contextWindow,
    thinkingFormat: taskOverride.thinkingFormat,
    maxTokens: taskOverride.maxTokens,
  };
}

export async function callAuxiliaryModel(
  params: AuxiliaryVisionTaskCallParams,
): Promise<{
  model: string;
  analysis: string;
  response: ChatCompletionResponse;
}>;
export async function callAuxiliaryModel(
  params: AuxiliaryTextTaskCallParams,
): Promise<{
  model: string;
  content: string;
  response: ChatCompletionResponse;
}>;
export async function callAuxiliaryModel(
  params: AuxiliaryTaskCallParams,
): Promise<
  | {
      model: string;
      analysis: string;
      response: ChatCompletionResponse;
    }
  | {
      model: string;
      content: string;
      response: ChatCompletionResponse;
    }
> {
  const toolName = String(params.toolName || params.task).trim() || params.task;
  const context = resolveAuxiliaryTaskContext({
    task: params.task,
    taskModels: params.taskModels,
    fallbackContext: params.fallbackContext,
    toolName,
  });
  const contextError = getAuxiliaryContextError({
    context,
    toolName,
    missingContextSource:
      params.task === 'vision' ? params.missingContextSource : undefined,
  });
  if (contextError) throw new Error(contextError);

  if (params.task !== 'vision') {
    const response = await callRoutedModel({
      provider: context.provider,
      baseUrl: context.baseUrl,
      apiKey: context.apiKey,
      model: context.model,
      chatbotId: context.chatbotId,
      enableRag: false,
      requestHeaders: context.requestHeaders,
      isLocal: context.isLocal,
      contextWindow: context.contextWindow,
      thinkingFormat: context.thinkingFormat,
      messages: params.messages,
      tools: Array.isArray(params.tools) ? params.tools : [],
      maxTokens: context.maxTokens ?? params.maxTokens,
    });
    const content = extractResponseTextContent(
      response.choices[0]?.message?.content,
    );
    if (!content) {
      throw new Error(`${toolName} returned empty content`);
    }
    return {
      model: String(context.model || '').trim(),
      content,
      response,
    };
  }

  return callVisionProviderModel({
    provider: context.provider,
    baseUrl: context.baseUrl,
    apiKey: context.apiKey,
    model: context.model,
    chatbotId: context.chatbotId,
    requestHeaders: context.requestHeaders,
    isLocal: context.isLocal,
    contextWindow: context.contextWindow,
    thinkingFormat: context.thinkingFormat,
    question: params.question,
    imageDataUrl: params.imageDataUrl,
    maxTokens: context.maxTokens,
  });
}
