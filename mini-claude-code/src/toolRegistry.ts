import type { ToolDefinition } from './types.js'
import { bashTool } from './tools/bash.js'
import { grepFilesTool } from './tools/grepFiles.js'
import { listFilesTool } from './tools/listFiles.js'
import { readFileTool } from './tools/readFile.js'
import { writeFileTool } from './tools/writeFile.js'

export function getTools(): ToolDefinition[] {
  return [
    bashTool,
    readFileTool,
    listFilesTool,
    grepFilesTool,
    writeFileTool,
  ]
}
