#!/usr/bin/env bun
import React from 'react'
import { render } from 'ink'
import { createAnthropicClient } from './anthropic.js'
import { getConfig } from './config.js'
import { App } from './app.js'

function main() {
  const config = getConfig()
  const client = createAnthropicClient(config)

  render(
    <App
      client={client}
      model={config.model}
      maxIterations={config.maxIterations}
      workdir={config.workdir}
    />,
  )
}

main()
