import assert from 'node:assert/strict'

export interface LivePageSnapshot {
  url: string
  title: string
  text: string
  headings: string[]
  formCount: number
  links: string[]
}

/** Oracles for the real sites used by the packaged test, never an arbitrary nonempty page. */
export function assertLivePage(page: LivePageSnapshot, expectedUrl: string): void {
  assert.equal(page.url, expectedUrl, 'Unexpected page URL')
  const url = new URL(expectedUrl)
  if (url.origin === 'http://manifesto.ton' && url.pathname === '/') {
    assert(page.text.length > 200, 'Manifesto body is incomplete')
    assert(/manifesto/i.test(page.title + page.text), 'Manifesto content missing')
    assert(
      /digital resistance manifesto/i.test(page.title + '\n' + page.headings.join('\n')),
      'Manifesto identity missing'
    )
  } else if (url.origin === 'http://piracy.ton' && url.pathname === '/') {
    assert(page.text.length > 200 && /piracy/i.test(page.title + page.text), 'Piracy homepage content missing')
    assert(page.links.includes('http://piracy.ton/add.html'), 'Piracy navigation link missing')
  } else if (url.origin === 'http://piracy.ton' && url.pathname === '/add.html') {
    assert(page.headings.includes('Add a Bag'), 'Add a Bag heading missing')
    assert(page.formCount > 0, 'Add a Bag form missing')
  } else {
    throw new Error(`No content contract for ${expectedUrl}`)
  }
}

export function assertStorageTable(actual: { columns: string[]; rows: string[][] }): void {
  assert.deepEqual(actual, { columns: ['name', 'value'], rows: [['smoke-route', '42']] }, 'Storage table cells differ')
}
