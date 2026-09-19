export type AzureFoundryChatMessage = {
  role: 'system' | 'user'
  content: string
}

export type AzureFoundryChatCompletion = {
  content: string
  finishReason: string | null
}

type AzureFoundryChatResponse = {
  choices?: Array<{
    finish_reason?: string | null
    message?: { content?: string | null }
  }>
}

function chatCompletionsUrl(endpoint: string): string {
  const url = new URL(endpoint)
  if (url.protocol !== 'https:') throw new Error('Azure Foundry endpoint must use HTTPS')
  const path = url.pathname.replace(/\/+$/, '')
  if (path.endsWith('/chat/completions')) url.pathname = path
  else if (path.endsWith('/openai/v1')) url.pathname = `${path}/chat/completions`
  else url.pathname = `${path}/openai/v1/chat/completions`
  url.hash = ''
  return url.toString()
}

function sanitizedErrorBody(body: string, apiKey: string): string {
  let detail = body
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: unknown }
      message?: unknown
      detail?: unknown
    }
    const candidate = parsed.error?.message ?? parsed.message ?? parsed.detail
    if (typeof candidate === 'string') detail = candidate
    else if (candidate) detail = JSON.stringify(candidate)
  } catch {
    // Keep the plain-text response body.
  }
  const sanitized = detail
    .replaceAll(apiKey, '[redacted]')
    .replace(/(api[-_ ]?key|authorization)\s*[:=]\s*["']?[^"',\s}]+/gi, '$1=[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
  return sanitized ? sanitized.slice(0, 400) : 'empty response body'
}

export class AzureFoundryChatClient {
  private readonly requestUrl: string

  constructor(endpoint: string, private readonly apiKey: string) {
    this.requestUrl = chatCompletionsUrl(endpoint)
  }

  sanitizeLog(value: string): string {
    return value
      .replaceAll(this.apiKey, '[redacted]')
      .replace(/(?:Bearer\s+)[A-Za-z0-9._~+/-]+/gi, 'Bearer [redacted]')
      .replace(
        /((?:api[-_ ]?key|authorization|secret|password|token)\\?"?\s*[:=]\s*\\?")[^"\\]+/gi,
        '$1[redacted]'
      )
  }

  async complete(
    model: string,
    messages: AzureFoundryChatMessage[],
    maxTokens: number,
    temperature: number,
    signal: AbortSignal
  ): Promise<AzureFoundryChatCompletion> {
    const response = await fetch(this.requestUrl, {
      method: 'POST',
      headers: { 'api-key': this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
        stream: false
      }),
      signal
    })
    if (!response.ok) {
      const detail = sanitizedErrorBody(await response.text(), this.apiKey)
      throw new Error(`Azure Foundry HTTP ${response.status}: ${detail}`)
    }
    const payload = await response.json() as AzureFoundryChatResponse
    const choice = payload.choices?.[0]
    if (typeof choice?.message?.content !== 'string') {
      throw new Error('Azure Foundry response did not contain text')
    }
    return { content: choice.message.content, finishReason: choice.finish_reason ?? null }
  }
}
