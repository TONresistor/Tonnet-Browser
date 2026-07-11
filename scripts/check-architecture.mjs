#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'

const root = process.cwd()
const sourceRoot = path.join(root, 'src')
const configPath = path.join(root, 'architecture.config.json')
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))

const normalize = (value) => value.split(path.sep).join('/')
const relative = (value) => normalize(path.relative(root, value))
const isProductionSource = (file) =>
  /\.(?:ts|tsx)$/.test(file) &&
  !file.endsWith('.d.ts') &&
  !file.includes(`${path.sep}__tests__${path.sep}`) &&
  !/\.test\.(?:ts|tsx)$/.test(file)

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(file, files)
    else if (isProductionSource(file)) files.push(path.resolve(file))
  }
  return files
}

const files = walk(sourceRoot)
const fileSet = new Set(files)

function resolveInternalImport(importer, specifier) {
  let base
  if (specifier.startsWith('@/')) base = path.join(sourceRoot, 'renderer/src', specifier.slice(2))
  else if (specifier.startsWith('@shared/')) base = path.join(sourceRoot, 'shared', specifier.slice(8))
  else if (specifier.startsWith('.')) base = path.resolve(path.dirname(importer), specifier)
  else return null

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ]) {
    const resolved = path.resolve(candidate)
    if (fileSet.has(resolved)) return resolved
  }
  return null
}

function importSpecifiersFor(file) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const imports = []
  source.forEachChild((node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push(node.moduleSpecifier.text)
    }
  })
  return imports
}

const importSpecifiers = new Map(files.map((file) => [file, importSpecifiersFor(file)]))
const graph = new Map(
  files.map((file) => [
    file,
    importSpecifiers
      .get(file)
      .map((specifier) => resolveInternalImport(file, specifier))
      .filter(Boolean),
  ])
)

function stronglyConnectedComponents() {
  let nextIndex = 0
  const indices = new Map()
  const lowLinks = new Map()
  const stack = []
  const onStack = new Set()
  const components = []

  function visit(node) {
    indices.set(node, nextIndex)
    lowLinks.set(node, nextIndex)
    nextIndex += 1
    stack.push(node)
    onStack.add(node)

    for (const dependency of graph.get(node) ?? []) {
      if (!indices.has(dependency)) {
        visit(dependency)
        lowLinks.set(node, Math.min(lowLinks.get(node), lowLinks.get(dependency)))
      } else if (onStack.has(dependency)) {
        lowLinks.set(node, Math.min(lowLinks.get(node), indices.get(dependency)))
      }
    }

    if (lowLinks.get(node) !== indices.get(node)) return
    const component = []
    let member
    do {
      member = stack.pop()
      onStack.delete(member)
      component.push(member)
    } while (member !== node)
    if (component.length > 1) components.push(component)
  }

  for (const file of files) if (!indices.has(file)) visit(file)
  return components
}

const fingerprint = (component) => component.map(relative).sort().join('|')
const cycles = stronglyConnectedComponents()
const actualCycles = new Set(cycles.map(fingerprint))
const allowedCycles = new Set(config.allowedCycles.map((cycle) => [...cycle].sort().join('|')))
const errors = []

const sizeLimit = config.maxProductionFileLines ?? 600
const sizeExceptions = new Map((config.fileSizeExceptions ?? []).map((exception) => [exception.path, exception]))
for (const file of files) {
  const fileName = relative(file)
  const lineCount = fs.readFileSync(file, 'utf8').split(/\r?\n/).length
  const exception = sizeExceptions.get(fileName)
  if (lineCount > sizeLimit && !exception) {
    errors.push(`production-file-size: ${fileName} has ${lineCount} lines (limit ${sizeLimit})`)
  }
  if (exception && (!exception.owner || !exception.reason || !exception.milestone)) {
    errors.push(`file-size-exception-metadata: ${fileName} must declare owner, reason, and milestone`)
  }
}
for (const [fileName] of sizeExceptions) {
  const file = path.join(root, fileName)
  if (!fileSet.has(path.resolve(file))) errors.push(`obsolete file-size exception: ${fileName} does not exist`)
  else if (fs.readFileSync(file, 'utf8').split(/\r?\n/).length <= sizeLimit) {
    errors.push(`obsolete file-size exception: ${fileName} is now within the ${sizeLimit}-line limit`)
  }
}

for (const file of files) {
  const fileName = relative(file)
  for (const rule of config.forbiddenPatterns ?? []) {
    if (!rule.from.some((prefix) => matchesPrefix(fileName, prefix))) continue
    if (new RegExp(rule.pattern, 'm').test(fs.readFileSync(file, 'utf8'))) {
      errors.push(`${rule.id}: ${fileName} matches /${rule.pattern}/`)
    }
  }
}

for (const cycle of [...actualCycles].sort()) {
  if (!allowedCycles.has(cycle)) errors.push(`New import cycle:\n  ${cycle.split('|').join('\n  ')}`)
}
for (const cycle of [...allowedCycles].sort()) {
  if (!actualCycles.has(cycle)) {
    errors.push(`Obsolete cycle exception must be removed:\n  ${cycle.split('|').join('\n  ')}`)
  }
}

function matchesPrefix(file, prefix) {
  return file === prefix || file.startsWith(`${prefix}/`)
}

for (const [source, specifiers] of importSpecifiers) {
  const sourceName = relative(source)
  for (const rule of config.forbiddenImports ?? []) {
    if (!rule.from.some((prefix) => matchesPrefix(sourceName, prefix))) continue
    for (const specifier of specifiers) {
      if (rule.imports.includes(specifier)) errors.push(`${rule.id}: ${sourceName} -> ${specifier}`)
    }
  }
}

for (const [source, dependencies] of graph) {
  const sourceName = relative(source)
  for (const dependency of dependencies) {
    const targetName = relative(dependency)
    for (const rule of config.forbiddenDependencies) {
      if (
        rule.from.some((prefix) => matchesPrefix(sourceName, prefix)) &&
        rule.to.some((prefix) => matchesPrefix(targetName, prefix))
      ) {
        errors.push(`${rule.id}: ${sourceName} -> ${targetName}`)
      }
    }
  }
}

if (errors.length > 0) {
  console.error(`Architecture check failed (${errors.length} issue${errors.length === 1 ? '' : 's'}):`)
  for (const error of errors) console.error(`\n- ${error}`)
  process.exit(1)
}

console.log(
  `Architecture check passed: ${files.length} production files, ` +
    `${[...graph.values()].reduce((total, dependencies) => total + dependencies.length, 0)} internal edges, ` +
    `${cycles.length} temporary cycle exceptions.`
)
