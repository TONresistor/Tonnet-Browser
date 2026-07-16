import { readFile, stat } from 'node:fs/promises'
import { posix } from 'node:path'

const budgets = [
  { file: 'out/preload/index.js', maxBytes: 16 * 1024, owner: 'preload bridge' },
  { file: 'out/main/index.js', maxBytes: 604 * 1024, owner: 'main process' },
]

let failed = false
for (const budget of budgets) {
  let bytes
  try {
    bytes = (await stat(budget.file)).size
  } catch {
    console.error(`Bundle budget failed: ${budget.file} does not exist; run npm run build first.`)
    failed = true
    continue
  }
  const kib = (bytes / 1024).toFixed(2)
  const maxKib = (budget.maxBytes / 1024).toFixed(2)
  if (bytes > budget.maxBytes) {
    console.error(`Bundle budget exceeded for ${budget.owner}: ${kib} KiB > ${maxKib} KiB (${budget.file})`)
    failed = true
  } else {
    console.log(`Bundle budget passed for ${budget.owner}: ${kib} KiB <= ${maxKib} KiB`)
  }
}

const rendererRoot = 'out/renderer'
const rendererColdStartMaxBytes = 2.1 * 1024 * 1024

async function addStaticGraph(file, graph, visited) {
  if (visited.has(file)) return
  visited.add(file)
  graph.add(file)
  const source = await readFile(`${rendererRoot}/${file}`, 'utf8')
  const imports = [
    ...source.matchAll(/\bimport\s*['"]\.\/([^'"?]+\.js)['"]/g),
    ...source.matchAll(/\b(?:import|export)\s*[^('"`]*?\bfrom\s*['"]\.\/([^'"?]+\.js)['"]/g),
  ]
  await Promise.all(imports.map((match) => addStaticGraph(posix.join(posix.dirname(file), match[1]), graph, visited)))
}

try {
  const html = await readFile(`${rendererRoot}/index.html`, 'utf8')
  const files = [...new Set([...html.matchAll(/(?:src|href)="\.\/(assets\/[^"?]+\.js)/g)].map((match) => match[1]))]
  const entry = files.find((file) => /^assets\/index-.*\.js$/.test(file))
  if (!entry) throw new Error('renderer entry was not found')

  const entrySource = await readFile(`${rendererRoot}/${entry}`, 'utf8')
  const landingAsset = entrySource.match(/import\(['"]\.\/(LandingPage-[^'"]+\.js)['"]\)/)?.[1]
  if (!landingAsset) throw new Error('LandingPage cold-start chunk was not found')

  const landingFile = `assets/${landingAsset}`
  const graph = new Set(files)
  const visited = new Set()
  await Promise.all(files.map((file) => addStaticGraph(file, graph, visited)))
  await addStaticGraph(landingFile, graph, visited)

  const landingSource = await readFile(`${rendererRoot}/${landingFile}`, 'utf8')
  const welcomeAsset = landingSource.match(/import\(['"]\.\/(welcome-(?!yellow-)[^'"]+\.js)['"]\)/)?.[1]
  if (!welcomeAsset) throw new Error('default welcome animation chunk was not found')
  await addStaticGraph(`assets/${welcomeAsset}`, graph, visited)

  const coldStartFiles = [...graph]
  const sizes = await Promise.all(coldStartFiles.map(async (file) => (await stat(`${rendererRoot}/${file}`)).size))
  const totalBytes = sizes.reduce((total, bytes) => total + bytes, 0)
  if (coldStartFiles.length === 0) {
    console.error('Bundle budget failed: renderer initial bundle was not found; run npm run build first.')
    failed = true
  } else if (totalBytes > rendererColdStartMaxBytes) {
    console.error(
      `Bundle budget exceeded for renderer cold start: ${(totalBytes / 1024).toFixed(2)} KiB > ${(rendererColdStartMaxBytes / 1024).toFixed(2)} KiB (${coldStartFiles.join(', ')})`
    )
    failed = true
  } else {
    console.log(
      `Bundle budget passed for renderer cold start: ${(totalBytes / 1024).toFixed(2)} KiB <= ${(rendererColdStartMaxBytes / 1024).toFixed(2)} KiB (${coldStartFiles.join(', ')})`
    )
  }
} catch (error) {
  console.error(
    `Bundle budget failed: ${error instanceof Error ? error.message : String(error)}; run npm run build first.`
  )
  failed = true
}

if (failed) process.exitCode = 1
