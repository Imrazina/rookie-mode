import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const judgeEnvPath = resolve('.env.judge')
const requiredVariables = [
  'AZURE_SPEECH_KEY',
  'AZURE_SPEECH_REGION',
  'AZURE_FOUNDRY_ENDPOINT',
  'AZURE_FOUNDRY_API_KEY',
  'AZURE_CONTEXT_MODEL',
  'AZURE_RACE_BRIEF_MODEL',
  'DEMO_VIDEO_URL'
]

if (!existsSync(judgeEnvPath)) {
  console.error('Missing .env.judge. Copy .env.example to .env.judge and add the temporary judge credentials.')
  process.exit(1)
}

const configured = new Map()
for (const line of readFileSync(judgeEnvPath, 'utf8').split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
  if (!match) continue
  configured.set(match[1], match[2].replace(/^(['"])(.*)\1$/, '$2').trim())
}

const missing = requiredVariables.filter((name) => !configured.get(name))
if (missing.length > 0) {
  console.error(`Judge configuration is missing: ${missing.join(', ')}`)
  process.exit(1)
}

try {
  const demoUrl = new URL(configured.get('DEMO_VIDEO_URL'))
  if (demoUrl.protocol !== 'https:' && demoUrl.protocol !== 'http:') throw new Error('unsupported protocol')
} catch {
  console.error('DEMO_VIDEO_URL in .env.judge must be a valid HTTP or HTTPS URL.')
  process.exit(1)
}

console.log('Judge configuration is present. Values were not printed.')
