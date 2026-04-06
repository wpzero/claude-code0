import { z } from 'zod'
import type { ToolDefinition } from '../types.js'

const schema = z.object({
  prompt: z.string().min(1),
  agent_type: z.string().min(1).optional(),
  allowed_tools: z.array(z.string().min(1)).optional(),
})

export const spawnAgentTool: ToolDefinition = {
  name: 'spawn_agent',
  description:
    'Run a focused subagent and return its final answer. Prefer selecting an agent_type and providing a clear prompt. Available agent types are announced in <system-reminder> messages. allowed_tools is an advanced option for further restricting the tools available to this invocation.',
  inputSchema: schema,
  apiInputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'The task description for the subagent.',
      },
      agent_type: {
        type: 'string',
        description:
          'Optional agent type. Usually provide this to select the subagent role. Available values are announced in <system-reminder> messages.',
      },
      allowed_tools: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Advanced: optional extra tool restriction for this invocation. Usually omit this when using agent_type. spawn_agent is always excluded.',
      },
    },
    required: ['prompt'],
    additionalProperties: false,
  },
  requiresApproval: 'always',
  isReadOnly: false,
  isConcurrencySafe: false,
  async execute(input, context) {
    const {
      prompt,
      agent_type: agentType,
      allowed_tools: allowedTools,
    } = schema.parse(input)

    return {
      content: await context.runSubagent({
        prompt,
        agentType,
        allowedTools,
      }),
    }
  },
}
