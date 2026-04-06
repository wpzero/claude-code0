import { z } from 'zod'
import type { ToolDefinition } from '../types.js'

const schema = z.object({
  prompt: z.string().min(1),
  allowed_tools: z.array(z.string().min(1)).optional(),
})

export const spawnAgentTool: ToolDefinition = {
  name: 'spawn_agent',
  description:
    'Run a focused subagent with an isolated prompt and return its final answer.',
  inputSchema: schema,
  apiInputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'The task description for the subagent.',
      },
      allowed_tools: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional tool whitelist for the subagent. spawn_agent is always excluded.',
      },
    },
    required: ['prompt'],
    additionalProperties: false,
  },
  requiresApproval: 'always',
  isReadOnly: false,
  isConcurrencySafe: false,
  async execute(input, context) {
    const { prompt, allowed_tools: allowedTools } = schema.parse(input)

    return {
      content: await context.runSubagent({
        prompt,
        allowedTools,
      }),
    }
  },
}
