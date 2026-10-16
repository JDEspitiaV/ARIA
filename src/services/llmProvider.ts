/**
 * LLM Provider Layer
 * Implements an OpenAI-compatible interface for DeepSeek and TokenHarbour proxies.
 * Reads configuration strictly from process.env (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, LLM_FALLBACK_MODEL).
 * Never reads keys from firebase-applet-config.json or import.meta.env.
 */

import OpenAI from 'openai';

export interface ChatMessageParam {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamChatParams {
  system?: string;
  messages: ChatMessageParam[];
  tools?: any[];
  signal?: AbortSignal;
  onChunk?: (textChunk: string) => void;
  preferredModel?: string;
}

export interface StreamResult {
  text: string;
  functionCalls?: Array<{
    name: string;
    arguments: any;
    args: any;
  }>;
  modelUsed: string;
}

export interface GenerateJsonParams {
  system?: string;
  user: string;
  signal?: AbortSignal;
  model?: string;
}

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    throw new Error('FATAL: LLM_API_KEY environment variable is missing.');
  }
  let rawBase = (process.env.LLM_BASE_URL || 'https://api.deepseek.com').trim().replace(/\/+$/, '');
  if (rawBase.includes('tokenharbor') && !rawBase.endsWith('/v1')) {
    rawBase = `${rawBase}/v1`;
  }
  return new OpenAI({
    apiKey,
    baseURL: rawBase
  });
}

/**
 * Streams chat completion with 8s first-chunk timeout, client abort propagation,
 * one retry on 429/5xx, and optional fallback model via LLM_FALLBACK_MODEL.
 */
export async function streamChat({
  system,
  messages,
  tools,
  signal,
  onChunk,
  preferredModel
}: StreamChatParams): Promise<StreamResult> {
  const client = getOpenAIClient();
  const primaryModel = preferredModel || process.env.LLM_MODEL || 'deepseek-chat';
  let fallbackModel = process.env.LLM_FALLBACK_MODEL;
  if (!fallbackModel || fallbackModel === primaryModel) {
    if (primaryModel === 'deepseek-v4.1-flash:free') {
      fallbackModel = 'deepseek-v4-flash:free';
    }
  }

  const models = [primaryModel];
  if (fallbackModel && fallbackModel !== primaryModel) {
    models.push(fallbackModel);
  }

  // Format tools to OpenAI specification
  const formattedTools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined = tools?.map(t => {
    if (t.type === 'function') return t;
    return {
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    };
  });

  const fullMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  if (system) {
    fullMessages.push({ role: 'system', content: system });
  }
  for (const m of messages) {
    fullMessages.push({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content || ' '
    });
  }

  let lastError: any = null;

  for (const model of models) {
    if (signal?.aborted) {
      throw new Error('Client aborted request');
    }

    const maxAttempts = 2; // 1 attempt + 1 retry on 429/5xx
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (signal?.aborted) {
        throw new Error('Client aborted request');
      }

      let yieldedAnyChunk = false;
      let fullText = '';
      const accumulatedToolCalls: Record<number, { name: string; arguments: string }> = {};
      const start = Date.now();

      const controller = new AbortController();
      let timedOut = false;
      const firstChunkTimeoutMs = 8000; // 8-second hard timeout for first chunk

      let timeoutId: NodeJS.Timeout | null = setTimeout(() => {
        if (!yieldedAnyChunk) {
          timedOut = true;
          console.warn(`[LLMProvider] Hard timeout of ${firstChunkTimeoutMs}ms exceeded waiting for first chunk on model '${model}'. Aborting...`);
          try {
            controller.abort(new Error(`Timeout of ${firstChunkTimeoutMs}ms exceeded waiting for first chunk on model '${model}'`));
          } catch {}
        }
      }, firstChunkTimeoutMs);

      const onClientAbort = () => {
        try {
          controller.abort(new Error('Client aborted request'));
        } catch {}
      };

      if (signal) {
        signal.addEventListener('abort', onClientAbort, { once: true });
      }

      try {
        const stream = await client.chat.completions.create(
          {
            model,
            messages: fullMessages,
            temperature: 0.2,
            stream: true,
            ...(formattedTools && formattedTools.length > 0 ? { tools: formattedTools } : {})
          },
          {
            signal: controller.signal
          }
        );

        for await (const chunk of stream) {
          if (signal?.aborted) {
            controller.abort();
            throw new Error('Client aborted request');
          }

          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;

          if (delta.content) {
            if (!yieldedAnyChunk) {
              yieldedAnyChunk = true;
              if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
              }
            }
            fullText += delta.content;
            if (onChunk) {
              onChunk(delta.content);
            }
          }

          if (delta.tool_calls && delta.tool_calls.length > 0) {
            if (!yieldedAnyChunk) {
              yieldedAnyChunk = true;
              if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
              }
            }
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!accumulatedToolCalls[idx]) {
                accumulatedToolCalls[idx] = {
                  name: tc.function?.name || '',
                  arguments: tc.function?.arguments || ''
                };
              } else {
                if (tc.function?.name) accumulatedToolCalls[idx].name = tc.function.name;
                if (tc.function?.arguments) accumulatedToolCalls[idx].arguments += tc.function.arguments;
              }
            }
          }
        }

        if (timedOut || controller.signal.aborted) {
          throw new Error(`Timeout of ${firstChunkTimeoutMs}ms exceeded waiting for first chunk on model '${model}'`);
        }
        if (!yieldedAnyChunk) {
          throw new Error(`Empty stream received from model '${model}' (0 chunks yielded).`);
        }

        const parsedFunctionCalls: Array<{ name: string; arguments: any; args: any }> = [];
        for (const idx of Object.keys(accumulatedToolCalls).map(Number).sort((a, b) => a - b)) {
          const rawCall = accumulatedToolCalls[idx];
          let parsedArgs = {};
          try {
            parsedArgs = JSON.parse(rawCall.arguments || '{}');
          } catch (e) {
            console.warn(`[LLMProvider] Failed parsing tool call arguments JSON for ${rawCall.name}:`, rawCall.arguments);
          }
          parsedFunctionCalls.push({
            name: rawCall.name,
            arguments: parsedArgs,
            args: parsedArgs
          });
        }

        console.log(`[LLMProvider] Stream finished successfully on model '${model}' in ${Date.now() - start}ms (Text: ${fullText.length} chars, Tools: ${parsedFunctionCalls.length})`);

        return {
          text: fullText,
          functionCalls: parsedFunctionCalls.length > 0 ? parsedFunctionCalls : undefined,
          modelUsed: model
        };
      } catch (err: any) {
        lastError = err;
        const errMsg = err?.message || String(err);
        const isClientAbort = signal?.aborted || errMsg.includes('Client aborted');
        if (isClientAbort) {
          throw err;
        }

        const isTimeoutOrAbort = timedOut || controller.signal.aborted || err?.name === 'AbortError' || errMsg.includes('Timeout') || errMsg.includes('aborted');
        const status = err?.status || err?.statusCode;
        const isRetriable = isTimeoutOrAbort || status === 429 || (status >= 500 && status < 600) || errMsg.includes('429') || errMsg.includes('500') || errMsg.includes('503');

        console.warn(`[LLMProvider] ${isTimeoutOrAbort ? 'TIMEOUT/ABORT' : 'Error'} on model '${model}' (attempt ${attempt + 1}/${maxAttempts}, yielded: ${yieldedAnyChunk}): ${errMsg}`);

        // If chunks were already yielded to client, return accumulated text
        if (yieldedAnyChunk) {
          console.warn(`[LLMProvider] Stream interrupted after partial delivery on '${model}'. Finalizing with accumulated output.`);
          return {
            text: fullText,
            functionCalls: undefined,
            modelUsed: model
          };
        }

        if (attempt < maxAttempts - 1 && isRetriable) {
          await new Promise((r) => setTimeout(r, 500));
        } else {
          console.warn(`[LLMProvider] Moving to next fallback model if available...`);
          break; // Move to next fallback model
        }
      } finally {
        if (signal) {
          signal.removeEventListener('abort', onClientAbort);
        }
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      }
    }
  }

  throw lastError || new Error('All LLM model streaming requests failed after resilience attempts.');
}

/**
 * Non-streaming structured JSON generation using OpenAI-compatible format.
 */
export async function generateJson<T = any>({
  system,
  user,
  signal,
  model: specifiedModel
}: GenerateJsonParams): Promise<T & { text: string }> {
  const client = getOpenAIClient();
  const primaryModel = specifiedModel || process.env.LLM_MODEL || 'deepseek-chat';
  let fallbackModel = process.env.LLM_FALLBACK_MODEL;
  if (!fallbackModel || fallbackModel === primaryModel) {
    if (primaryModel === 'deepseek-v4.1-flash:free') {
      fallbackModel = 'deepseek-v4-flash:free';
    }
  }

  const models = [primaryModel];
  if (fallbackModel && fallbackModel !== primaryModel) {
    models.push(fallbackModel);
  }

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  if (system) {
    messages.push({ role: 'system', content: system });
  }
  messages.push({ role: 'user', content: user });

  let lastError: any = null;

  for (const model of models) {
    const maxAttempts = 2;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (signal?.aborted) {
        throw new Error('Client aborted request');
      }

      const controller = new AbortController();
      let timedOut = false;
      const timeoutMs = 15000;
      const timeoutId = setTimeout(() => {
        timedOut = true;
        try {
          controller.abort(new Error(`Timeout of ${timeoutMs}ms exceeded on model '${model}'`));
        } catch {}
      }, timeoutMs);

      const onClientAbort = () => {
        try {
          controller.abort(new Error('Client aborted request'));
        } catch {}
      };
      if (signal) {
        signal.addEventListener('abort', onClientAbort, { once: true });
      }

      try {
        const completion = await client.chat.completions.create(
          {
            model,
            messages,
            temperature: 0.1,
            response_format: { type: 'json_object' }
          },
          {
            signal: controller.signal
          }
        );

        const rawContent = completion.choices[0]?.message?.content || '';
        let parsed: any = {};
        try {
          parsed = JSON.parse(rawContent);
        } catch {
          const match = rawContent.match(/\{[\s\S]*\}/);
          if (match) {
            try {
              parsed = JSON.parse(match[0]);
            } catch {}
          }
        }

        return {
          ...parsed,
          text: rawContent
        };
      } catch (err: any) {
        lastError = err;
        const errMsg = err?.message || String(err);
        const status = err?.status || err?.statusCode;
        const isRetriable = timedOut || status === 429 || (status >= 500 && status < 600);

        console.warn(`[LLMProvider generateJson] Error on model '${model}' (attempt ${attempt + 1}/${maxAttempts}): ${errMsg}`);

        if (attempt < maxAttempts - 1 && isRetriable && !timedOut) {
          await new Promise((r) => setTimeout(r, 500));
        } else {
          break;
        }
      } finally {
        if (signal) {
          signal.removeEventListener('abort', onClientAbort);
        }
        clearTimeout(timeoutId);
      }
    }
  }

  throw lastError || new Error('All LLM model JSON requests failed.');
}
