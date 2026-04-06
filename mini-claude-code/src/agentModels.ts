const DEFAULT_FIRST_PARTY_MODELS = {
  sonnet: 'claude-sonnet-4-5',
  haiku: 'claude-haiku-4-5',
  opus: 'claude-opus-4-1',
} as const

type AgentModelAlias = keyof typeof DEFAULT_FIRST_PARTY_MODELS

function isAgentModelAlias(value: string): value is AgentModelAlias {
  return value === 'sonnet' || value === 'haiku' || value === 'opus'
}

function isThirdPartyCompatibleBaseUrl(baseURL: string | undefined): boolean {
  if (!baseURL) {
    return false
  }

  try {
    const url = new URL(baseURL)
    return url.hostname !== 'api.anthropic.com'
  } catch {
    return true
  }
}

function getConfiguredAliasModel(alias: AgentModelAlias): string | undefined {
  switch (alias) {
    case 'sonnet':
      return process.env.ANTHROPIC_DEFAULT_SONNET_MODEL?.trim() || undefined
    case 'haiku':
      return process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL?.trim() || undefined
    case 'opus':
      return process.env.ANTHROPIC_DEFAULT_OPUS_MODEL?.trim() || undefined
  }
}

export function resolveAgentModel(
  agentModel: string | undefined,
  parentModel: string,
): string {
  const normalized = agentModel?.trim().toLowerCase()
  if (!normalized || normalized === 'inherit') {
    return parentModel
  }

  if (!isAgentModelAlias(normalized)) {
    return agentModel!.trim()
  }

  const configuredModel = getConfiguredAliasModel(normalized)
  if (configuredModel) {
    return configuredModel
  }

  if (isThirdPartyCompatibleBaseUrl(process.env.ANTHROPIC_BASE_URL)) {
    // Compatible providers often expose provider-specific model IDs. Without an
    // explicit alias mapping, staying on the parent model is safer than sending
    // a first-party Claude model name that may not exist upstream.
    return parentModel
  }

  return DEFAULT_FIRST_PARTY_MODELS[normalized]
}
