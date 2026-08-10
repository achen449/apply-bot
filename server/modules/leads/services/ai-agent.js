function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function asPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function normalizeToolDefinitions(tools = []) {
  return tools.map((tool) => {
    if (tool?.type === 'function' && tool.function?.name) {
      return tool
    }

    if (tool?.name) {
      return {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description || '',
          parameters: tool.parameters || { type: 'object', properties: {} }
        }
      }
    }

    return tool
  })
}

function normalizeToolExecutors(tools = []) {
  const executors = new Map()

  for (const tool of tools) {
    const name = tool?.function?.name || tool?.name
    const execute = tool?.execute || tool?.run || tool?.handler

    if (name && typeof execute === 'function') {
      executors.set(name, execute)
    }
  }

  return executors
}

async function readResponseText(response) {
  const responseText = await response.text().catch(() => '')

  if (!responseText) {
    return ''
  }

  try {
    const parsed = JSON.parse(responseText)
    return typeof parsed === 'string' ? parsed : JSON.stringify(parsed)
  } catch {
    return responseText
  }
}

function parseJsonObject(text) {
  if (!hasText(text)) {
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function buildToolMessage(callId, content) {
  return {
    role: 'tool',
    tool_call_id: callId,
    content: typeof content === 'string' ? content : JSON.stringify(content)
  }
}

function buildToolError(code, message, details = {}) {
  return {
    ok: false,
    error: {
      code,
      message,
      ...details
    }
  }
}

function attachExecutionContext(error, { toolCalls, iterations, messages }) {
  if (!error || typeof error !== 'object') {
    return error
  }

  error.toolCalls = toolCalls
  error.iterations = iterations
  error.messages = messages
  return error
}

function buildDeadlineError(phase, remainingMs) {
  const error = new Error(`AI task deadline reached during ${phase}.`)
  error.code = 'ai_request_timeout'
  error.phase = phase
  error.remainingMs = Math.max(remainingMs, 0)
  return error
}

async function executeWithTimeout(executor, argumentsObject, timeoutMs, toolName) {
  let timeout
  const timeoutPromise = new Promise((resolve) => {
    timeout = setTimeout(() => {
      resolve(buildToolError('tool_timeout', `Tool ${toolName || 'unknown'} timed out after ${timeoutMs}ms.`))
    }, timeoutMs)
  })

  try {
    return await Promise.race([
      Promise.resolve().then(() => executor(argumentsObject)),
      timeoutPromise
    ])
  } finally {
    clearTimeout(timeout)
  }
}

function readToolCalls(message) {
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    return message.tool_calls
  }

  if (message.function_call?.name) {
    return [{
      id: `function_call_${message.function_call.name}`,
      type: 'function',
      function: message.function_call
    }]
  }

  return []
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 60000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...options,
      signal: options.signal || controller.signal
    })
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(`AI request timed out after ${timeoutMs}ms`)
      timeoutError.code = 'ai_request_timeout'
      throw timeoutError
    }

    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function buildFinalResult({ content, toolCalls, iterations, messages }) {
  const finalText = content || ''

  return {
    finalText,
    parsedJson: parseJsonObject(finalText),
    toolCalls,
    iterations,
    messages,
    result: finalText
  }
}

export class AIAgent {
  constructor(config) {
    const { apiHost, apiKey, model } = config || {}

    if (!hasText(apiHost) || !hasText(apiKey) || !hasText(model)) {
      throw new Error('AI agent configuration requires apiHost, apiKey, and model.')
    }

    this.config = {
      apiHost: apiHost.trim().replace(/\/$/, ''),
      apiKey: apiKey.trim(),
      model: model.trim(),
      reasoningEffort: hasText(config.reasoningEffort) ? config.reasoningEffort.trim() : '',
      timeoutMs: asPositiveInteger(config.timeoutMs, 60000),
      maxTokens: asPositiveInteger(config.maxTokens, 4000)
    }
  }

  async executeTask({
    systemPrompt,
    userInput,
    messages: inputMessages = [],
    tools = [],
    maxIterations = 10,
    temperature = 0.2,
    reasoningEffort = '',
    deadlineMs = 0,
    timeoutMs = 0,
    maxTokens = 0,
    maxToolCalls = 0,
    toolTimeoutMs = 0
  }) {
    if (!hasText(userInput) && inputMessages.length === 0) {
      throw new Error('userInput or messages are required.')
    }

    const toolDefinitions = normalizeToolDefinitions(tools)
    const toolExecutors = normalizeToolExecutors(tools)
    const messages = [...inputMessages]

    if (messages.length === 0 && hasText(systemPrompt)) {
      messages.push({ role: 'system', content: systemPrompt })
    }

    if (hasText(userInput)) {
      messages.push({ role: 'user', content: userInput })
    }

    const toolCalls = []
    let iterations = 0
    const taskDeadlineMs = asPositiveInteger(deadlineMs, 0)
    const taskDeadlineAt = taskDeadlineMs > 0 ? Date.now() + taskDeadlineMs : 0
    const taskTimeoutMs = asPositiveInteger(timeoutMs, this.config.timeoutMs)
    const taskMaxTokens = asPositiveInteger(maxTokens, this.config.maxTokens)
    const taskReasoningEffort = hasText(reasoningEffort) ? reasoningEffort.trim() : this.config.reasoningEffort
    const taskMaxToolCalls = asPositiveInteger(maxToolCalls, 0)
    const taskToolTimeoutMs = asPositiveInteger(toolTimeoutMs, 0)

    function remainingTaskMs() {
      return taskDeadlineAt > 0 ? taskDeadlineAt - Date.now() : Number.POSITIVE_INFINITY
    }

    function ensureTaskBudget(phase, reserveMs = 500) {
      const remainingMs = remainingTaskMs()

      if (remainingMs <= reserveMs) {
        throw attachExecutionContext(buildDeadlineError(phase, remainingMs), {
          toolCalls,
          iterations,
          messages
        })
      }

      return remainingMs
    }

    while (iterations < maxIterations) {
      iterations += 1

      const remainingBeforeAi = ensureTaskBudget('AI request')
      const effectiveTimeoutMs = Math.min(
        taskTimeoutMs,
        Number.isFinite(remainingBeforeAi) ? Math.max(500, remainingBeforeAi - 250) : taskTimeoutMs
      )

      let response

      try {
        response = await fetchWithTimeout(`${this.config.apiHost}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`
          },
          body: JSON.stringify({
            model: this.config.model,
            messages,
            tools: toolDefinitions.length ? toolDefinitions : undefined,
            tool_choice: toolDefinitions.length ? 'auto' : undefined,
            reasoning_effort: taskReasoningEffort || undefined,
            temperature,
            max_tokens: taskMaxTokens
          })
        }, effectiveTimeoutMs)
      } catch (error) {
        if (!error.code) error.code = 'ai_request_failed'
        throw attachExecutionContext(error, {
          toolCalls,
          iterations,
          messages
        })
      }

      if (!response.ok) {
        const responseText = await readResponseText(response)
        const error = new Error(`AI request failed: ${response.status}${responseText ? `: ${responseText}` : ''}`)
        error.code = 'ai_request_failed'
        throw attachExecutionContext(error, { toolCalls, iterations, messages })
      }

      let data
      try {
        data = await response.json()
      } catch (cause) {
        const error = new Error(`AI response JSON parsing failed: ${cause.message || 'invalid JSON'}`)
        error.code = 'ai_request_failed'
        throw attachExecutionContext(error, { toolCalls, iterations, messages })
      }
      const choice = data?.choices?.[0]
      const message = choice?.message || {}
      const toolCallsFromMessage = readToolCalls(message)

      if (toolCallsFromMessage.length > 0) {
        messages.push({
          role: 'assistant',
          content: message.content || '',
          tool_calls: toolCallsFromMessage
        })

        for (const toolCall of toolCallsFromMessage) {
          const toolName = toolCall?.function?.name || ''
          const callId = toolCall.id || `tool_${toolCalls.length + 1}`
          const executor = toolExecutors.get(toolName)
          const argumentsText = toolCall?.function?.arguments || '{}'
          let parsedArguments = {}
          let toolResult

          try {
            parsedArguments = argumentsText ? JSON.parse(argumentsText) : {}
          } catch (error) {
            toolResult = buildToolError('malformed_tool_arguments', `Tool ${toolName || 'unknown'} received malformed JSON arguments.`, {
              rawArguments: argumentsText,
              parserMessage: error.message
            })
          }

          if (!toolResult) {
            if (typeof executor !== 'function') {
              toolResult = buildToolError('missing_tool_executor', `No executor is registered for tool: ${toolName || 'unknown'}`)
            } else if (taskMaxToolCalls > 0 && toolCalls.length >= taskMaxToolCalls) {
              toolResult = buildToolError('tool_budget_exceeded', `Tool budget exceeded after ${taskMaxToolCalls} calls.`)
            } else {
              try {
                const remainingBeforeTool = ensureTaskBudget(`tool ${toolName || 'unknown'}`)
                const effectiveToolTimeoutMs = taskToolTimeoutMs > 0
                  ? Math.min(taskToolTimeoutMs, Math.max(500, remainingBeforeTool - 250))
                  : Math.max(500, remainingBeforeTool - 250)
                toolResult = taskDeadlineAt > 0 || taskToolTimeoutMs > 0
                  ? await executeWithTimeout(executor, parsedArguments, effectiveToolTimeoutMs, toolName)
                  : await executor(parsedArguments)
              } catch (error) {
                if (error?.code === 'ai_request_timeout') {
                  throw attachExecutionContext(error, {
                    toolCalls,
                    iterations,
                    messages
                  })
                }

                toolResult = buildToolError('tool_execution_failed', error.message || `Tool ${toolName} failed.`)
              }
            }
          }

          toolCalls.push({
            id: callId,
            name: toolName,
            arguments: parsedArguments,
            result: toolResult
          })

          messages.push(buildToolMessage(callId, toolResult))
        }

        continue
      }

      if (hasText(message.content) || choice?.finish_reason === 'stop') {
        return buildFinalResult({
          content: message.content || '',
          toolCalls,
          iterations,
          messages
        })
      }

      const error = new Error('AI response did not return a final answer or tool calls.')
      error.code = 'ai_request_failed'
      throw attachExecutionContext(error, { toolCalls, iterations, messages })
    }

    const error = new Error(`AI agent exceeded maximum iterations: ${maxIterations}`)
    error.code = 'ai_agent_max_iterations'
    throw attachExecutionContext(error, {
      toolCalls,
      iterations,
      messages
    })
  }
}

export function createAIAgent(config) {
  return new AIAgent(config)
}
