/**
 * Minify translation JSON files to reduce bundle size
 * Removes whitespace, indentation, and unnecessary formatting
 */

const fs = require('fs')
const path = require('path')

const LOCALES_DIR = path.join(__dirname, '../src/renderer/src/locales')

function minifyJSON(content) {
  // Parse and re-stringify without formatting
  return JSON.stringify(JSON.parse(content))
}

function processDirectory(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    
    if (entry.isDirectory()) {
      processDirectory(fullPath)
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      try {
        const content = fs.readFileSync(fullPath, 'utf8')
        const minified = minifyJSON(content)
        const originalSize = content.length
        const minifiedSize = minified.length
        const savings = ((1 - minifiedSize / originalSize) * 100).toFixed(1)
        
        fs.writeFileSync(fullPath, minified, 'utf8')
        console.log(`✓ ${entry.name}: ${originalSize} → ${minifiedSize} bytes (${savings}% smaller)`)
      } catch (error) {
        console.error(`✗ Error processing ${entry.name}:`, error.message)
      }
    }
  }
}

console.log('Starting translation minification...\n')
processDirectory(LOCALES_DIR)
console.log('\n✅ Translation minification complete!')
