const DEBUG_FLAG = 'MINI_CLAUDE_CODE_DEBUG'

function maskSecret(value: string): string {
  if (value.length <= 8) {
    return '[redacted]'
  }

  return `${value.slice(0, 4)}...[redacted]...${value.slice(-4)}`
}

export function redactSecrets(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(item => redactSecrets(item))
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase()
    if (
      normalizedKey.includes('token') ||
      normalizedKey.includes('authorization') ||
      normalizedKey.includes('api_key') ||
      normalizedKey.includes('apikey')
    ) {
      result[key] =
        typeof entry === 'string' ? maskSecret(entry) : '[redacted]'
      continue
    }

    result[key] = redactSecrets(entry)
  }
  return result
}

export function isDebugEnabled(): boolean {
  return process.env[DEBUG_FLAG] === '1'
}

export function debugLog(scope: string, payload: unknown): void {
  if (!isDebugEnabled()) {
    return
  }

  const safePayload = redactSecrets(payload)
  const timestamp = new Date().toISOString()
  const formatted =
    typeof safePayload === 'string'
      ? safePayload
      : JSON.stringify(safePayload, null, 2)

  process.stderr.write(`[debug][${timestamp}][${scope}] ${formatted}\n`)
}
