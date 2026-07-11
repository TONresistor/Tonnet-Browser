import { readdir, stat } from 'node:fs/promises'

const budgets = [
  { file: 'out/preload/index.js', maxBytes: 16 * 1024, owner: 'preload bridge' },
  { file: 'out/main/index.js', maxBytes: 600 * 1024, owner: 'main process' },
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

try {
  const assets = 'out/renderer/assets'
  const candidates = (await readdir(assets)).filter((name) => /^index-.*\.js$/.test(name))
  const sizes = await Promise.all(
    candidates.map(async (name) => ({ name, bytes: (await stat(`${assets}/${name}`)).size }))
  )
  const initial = sizes.sort((left, right) => right.bytes - left.bytes)[0]
  const baselineBytes = 931_979
  const maxBytes = Math.ceil(baselineBytes * 1.1)
  if (!initial) {
    console.error('Bundle budget failed: renderer initial bundle was not found; run npm run build first.')
    failed = true
  } else if (initial.bytes > maxBytes) {
    console.error(
      `Bundle budget exceeded for renderer initial bundle: ${(initial.bytes / 1024).toFixed(2)} KiB > ${(maxBytes / 1024).toFixed(2)} KiB (${initial.name})`
    )
    failed = true
  } else {
    console.log(
      `Bundle budget passed for renderer initial bundle: ${(initial.bytes / 1024).toFixed(2)} KiB <= ${(maxBytes / 1024).toFixed(2)} KiB (${initial.name})`
    )
  }
} catch {
  console.error('Bundle budget failed: out/renderer/assets does not exist; run npm run build first.')
  failed = true
}

if (failed) process.exitCode = 1
