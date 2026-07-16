#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const rendererRoot = path.join(root, 'src/renderer/src')
const tokenContractPath = path.join(root, 'src/shared/theme-tokens.ts')

const rules = {
  'fixed-tailwind-palette':
    /\b(?:text|bg|border|ring|fill|stroke)-(?:white|black|gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d+)?(?:\/\d+)?\b/g,
  'raw-color': /#[0-9a-f]{3,8}\b|rgba?\s*\(/gi,
  'color-filter': /\b(?:brightness|invert)-\d+\b|filter\s*:\s*['"`][^'"`]*(?:brightness|invert)\s*\(/gi,
}

const exceptions = [
  {
    path: 'src/renderer/src/styles/globals.css',
    rules: ['raw-color'],
    reason: 'Canonical built-in token values and derived material primitives are defined here.',
  },
  {
    path: 'src/renderer/src/lib/theme-utils.ts',
    rules: ['raw-color'],
    reason: 'Runtime conversion and derived-material generation must emit concrete CSS color values.',
  },
  {
    path: 'src/renderer/src/features/messenger/components/chat/util.ts',
    rules: ['raw-color'],
    reason: 'Deterministic identity-avatar colors are data visualization colors, not application chrome.',
  },
  {
    path: 'src/renderer/src/features/wallet/components/ReceivePanel.tsx',
    rules: ['raw-color'],
    reason: 'QR modules require fixed black and white for scanner interoperability.',
  },
  {
    path: 'src/renderer/src/features/cocoon/components/wizard/Step3Fund.tsx',
    rules: ['raw-color'],
    reason: 'QR modules require fixed black and white for scanner interoperability.',
  },
  ...[
    'anon-avatar.svg',
    'appearance.svg',
    'bookmark.svg',
    'dns.svg',
    'history.svg',
    'messenger-device.svg',
    'messenger-reset.svg',
    'messenger.svg',
    'settings.svg',
    'storage.svg',
    'ton.svg',
    'wallet.svg',
  ].map((file) => ({
    path: `src/renderer/src/assets/${file}`,
    rules: ['raw-color'],
    reason: 'Fixed source paint is used only as an AppIcon mask or an internal-page favicon.',
  })),
]

const normalize = (value) => value.split(path.sep).join('/')
const relative = (value) => normalize(path.relative(root, value))
const extensionPattern = /\.(?:ts|tsx|css|svg)$/

function isProductionRendererFile(file) {
  return (
    extensionPattern.test(file) &&
    !file.includes(`${path.sep}__tests__${path.sep}`) &&
    !/\.test\.(?:ts|tsx)$/.test(file)
  )
}

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(file, files)
    else if (isProductionRendererFile(file)) files.push(file)
  }
  return files
}

function stripCommentsPreservingLines(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/.*$/gm, (comment) => comment.replace(/[^\n]/g, ' '))
}

function lineFor(source, index) {
  return source.slice(0, index).split('\n').length
}

const exceptionMap = new Map()
for (const exception of exceptions) {
  if (!exception.reason.trim()) throw new Error(`Theme-token exception ${exception.path} requires a reason.`)
  const file = path.join(root, exception.path)
  if (!fs.existsSync(file)) throw new Error(`Theme-token exception points to missing file: ${exception.path}`)
  exceptionMap.set(exception.path, new Set(exception.rules))
}

const files = walk(rendererRoot)
const errors = []
const usedExceptions = new Set()

for (const file of files) {
  const fileName = relative(file)
  const source = fs.readFileSync(file, 'utf8')
  const searchable = stripCommentsPreservingLines(source)

  for (const [ruleName, pattern] of Object.entries(rules)) {
    pattern.lastIndex = 0
    const matches = [...searchable.matchAll(pattern)]
    if (matches.length === 0) continue

    if (exceptionMap.get(fileName)?.has(ruleName)) {
      usedExceptions.add(`${fileName}:${ruleName}`)
      continue
    }

    for (const match of matches) {
      errors.push(`${ruleName}: ${fileName}:${lineFor(searchable, match.index)} (${match[0]})`)
    }
  }
}

for (const exception of exceptions) {
  for (const ruleName of exception.rules) {
    const key = `${exception.path}:${ruleName}`
    if (!usedExceptions.has(key)) errors.push(`obsolete-exception: ${key}`)
  }
}

const tokenContract = fs.readFileSync(tokenContractPath, 'utf8')
const cssTokenNames = [...tokenContract.matchAll(/^\s*[a-zA-Z][a-zA-Z0-9]*:\s*'--([a-z0-9-]+)'/gm)].map(
  (match) => match[1]
)
const consumerSource = files
  .filter((file) => {
    const fileName = relative(file)
    return (
      fileName !== 'src/renderer/src/styles/globals.css' &&
      fileName !== 'src/renderer/src/lib/theme-utils.ts' &&
      !fileName.startsWith('src/renderer/src/features/themes/') &&
      !fileName.startsWith('src/renderer/src/assets/')
    )
  })
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n')

for (const token of cssTokenNames) {
  const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const utility = new RegExp(`\\b(?:text|bg|border|ring|fill|stroke)-${escapedToken}(?:\\/\\d+)?(?![a-z0-9-])`)
  const cssVariable = new RegExp(`var\\(--${escapedToken}\\)`)
  if (!utility.test(consumerSource) && !cssVariable.test(consumerSource)) {
    errors.push(`missing-runtime-consumer: --${token}`)
  }
}

if (errors.length > 0) {
  console.error(`Theme-token check failed (${errors.length} issue${errors.length === 1 ? '' : 's'}):`)
  for (const error of errors) console.error(`\n- ${error}`)
  process.exit(1)
}

console.log(
  `Theme-token check passed: ${files.length} production renderer files, ` +
    `${cssTokenNames.length} runtime-covered theme tokens, ${Object.keys(rules).length} enforced rules, ` +
    `${usedExceptions.size} documented exceptions.`
)
