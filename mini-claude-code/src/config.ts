import path from 'node:path'

export type AppConfig = {
  apiKey?: string
  authToken?: string
  baseURL?: string
  anthropicMode?: string
  model: string
  maxIterations: number
  workdir: string
}

const DEFAULT_MODEL = 'claude-sonnet-4-5'
const DEFAULT_MAX_ITERATIONS = 8

export function getConfig(): AppConfig {
  const apiKey = process.env.ANTHROPIC_API_KEY
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN
  const baseURL = process.env.ANTHROPIC_BASE_URL

  if (!apiKey && !authToken) {
    throw new Error(
      'Either ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN is required',
    )
  }

  const maxIterationsRaw = process.env.CLAUDE_CODE_MVP_MAX_ITERATIONS
  const maxIterations = maxIterationsRaw
    ? Number.parseInt(maxIterationsRaw, 10)
    : DEFAULT_MAX_ITERATIONS

  if (!Number.isFinite(maxIterations) || maxIterations < 1) {
    throw new Error('CLAUDE_CODE_MVP_MAX_ITERATIONS must be a positive integer')
  }

  return {
    apiKey,
    authToken,
    baseURL,
    anthropicMode: process.env.ANTHROPIC_MODE,
    model:
      process.env.ANTHROPIC_MODEL ||
      process.env.CLAUDE_CODE_MVP_MODEL ||
      DEFAULT_MODEL,
    maxIterations,
    workdir: path.resolve(
      process.env.CLAUDE_CODE_MVP_WORKDIR || process.cwd(),
    ),
  }
}
