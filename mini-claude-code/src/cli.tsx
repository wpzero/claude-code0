#!/usr/bin/env bun
import React from 'react'
import { render } from 'ink'
import { loadAgents } from './agents.js'
import { createAnthropicClient } from './anthropic.js'
import { getConfig } from './config.js'
import { App } from './app.js'

async function main() {
  const config = getConfig()
  const client = createAnthropicClient(config)
  const { agents } = await loadAgents(config.workdir)

  render(
    <App
      client={client}
      model={config.model}
      maxIterations={config.maxIterations}
      workdir={config.workdir}
      agents={agents}
    />,
  )
}

void main()
