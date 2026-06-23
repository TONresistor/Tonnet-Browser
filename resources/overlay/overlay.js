const root = document.getElementById('root')
let selectedIndex = -1
let currentItems = []

function renderSuggestions(items) {
  currentItems = items
  selectedIndex = -1
  root.innerHTML = ''

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const el = document.createElement('div')
    el.className = 'suggestion-item'
    el.dataset.index = i

    const row = document.createElement('div')
    row.className = 'suggestion-row'

    const title = document.createElement('span')
    title.className = 'suggestion-title'
    title.textContent = item.title || item.url

    const visits = document.createElement('span')
    visits.className = 'suggestion-visits'
    visits.textContent = item.visitCount > 1 ? `${item.visitCount}x` : ''

    row.appendChild(title)
    row.appendChild(visits)

    const url = document.createElement('div')
    url.className = 'suggestion-url'
    url.textContent = item.url

    el.appendChild(row)
    el.appendChild(url)

    el.addEventListener('click', () => {
      window.overlayBridge.sendAction('select', { id: item.id, url: item.url, index: i })
    })

    root.appendChild(el)
  }
}

function renderMenu(items) {
  currentItems = items
  selectedIndex = -1
  root.innerHTML = ''

  for (let i = 0; i < items.length; i++) {
    const item = items[i]

    if (item.separator) {
      const sep = document.createElement('div')
      sep.className = 'menu-separator'
      root.appendChild(sep)
      continue
    }

    const el = document.createElement('div')
    el.className = 'menu-item' + (item.disabled ? ' disabled' : '') + (item.destructive ? ' destructive' : '')
    el.dataset.index = i

    if (item.icon) {
      const icon = document.createElement('span')
      icon.className = 'menu-icon'
      icon.textContent = item.icon
      el.appendChild(icon)
    }

    const label = document.createElement('span')
    label.textContent = item.label
    el.appendChild(label)

    el.addEventListener('click', () => {
      if (!item.disabled) {
        window.overlayBridge.sendAction(item.id, item.data || {})
      }
    })

    root.appendChild(el)
  }
}

function renderForm(content) {
  currentItems = []
  selectedIndex = -1
  root.innerHTML = ''

  const container = document.createElement('div')
  container.className = 'form-container'

  const title = document.createElement('div')
  title.className = 'form-title'
  title.textContent = content.title || ''
  container.appendChild(title)

  const inputs = {}

  for (const field of (content.fields || [])) {
    const fieldEl = document.createElement('div')
    fieldEl.className = 'form-field'

    const label = document.createElement('label')
    label.className = 'form-label'
    label.textContent = field.label || ''
    fieldEl.appendChild(label)

    if (field.readonly) {
      const text = document.createElement('div')
      text.className = 'form-input form-readonly'
      text.textContent = field.value || ''
      fieldEl.appendChild(text)
    } else {
      const input = document.createElement('input')
      input.className = 'form-input'
      input.value = field.value || ''
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          collectAndSend('save')
        } else if (e.key === 'Escape') {
          e.preventDefault()
          window.overlayBridge.sendAction('dismiss', {})
        }
      })
      fieldEl.appendChild(input)
      inputs[field.id] = input
    }

    container.appendChild(fieldEl)
  }

  function collectAndSend(actionId) {
    const values = {}
    for (const [id, input] of Object.entries(inputs)) {
      values[id] = input.value
    }
    window.overlayBridge.sendAction(actionId, values)
  }

  const actionsRow = document.createElement('div')
  actionsRow.className = 'form-actions'

  for (const action of (content.actions || [])) {
    const btn = document.createElement('button')
    btn.className = 'form-btn ' + (action.primary ? 'form-btn-primary' : 'form-btn-secondary')
    btn.textContent = action.label || action.id
    btn.addEventListener('click', () => {
      if (action.id === 'dismiss') {
        window.overlayBridge.sendAction('dismiss', {})
      } else {
        collectAndSend(action.id)
      }
    })
    actionsRow.appendChild(btn)
  }

  container.appendChild(actionsRow)
  root.appendChild(container)

  const firstInput = container.querySelector('.form-input')
  if (firstInput) firstInput.focus()
}

function renderApproval(content) {
  currentItems = []
  selectedIndex = -1
  root.className = 'modal-mode'
  root.innerHTML = ''

  const scrim = document.createElement('div')
  scrim.className = 'tc-scrim'
  scrim.addEventListener('click', () => window.overlayBridge.sendAction('dismiss', {}))

  const card = document.createElement('div')
  card.className = 'tc-card'
  card.addEventListener('click', (e) => e.stopPropagation())

  if (content.icon) {
    const img = document.createElement('img')
    img.className = 'tc-icon'
    img.src = content.icon
    card.appendChild(img)
  } else if (content.iconFallback) {
    const fb = document.createElement('div')
    fb.className = 'tc-icon-fallback'
    fb.textContent = content.iconFallback
    card.appendChild(fb)
  }

  if (content.title) {
    const t = document.createElement('div')
    t.className = 'tc-title'
    t.textContent = content.title
    card.appendChild(t)
  }
  if (content.subtitle) {
    const s = document.createElement('div')
    s.className = 'tc-subtitle'
    s.textContent = content.subtitle
    card.appendChild(s)
  }
  if (content.amount) {
    const a = document.createElement('div')
    a.className = 'tc-amount'
    a.textContent = content.amount
    card.appendChild(a)
  }

  if (content.warning) {
    const w = document.createElement('div')
    w.className = 'tc-warning'
    w.textContent = content.warning
    card.appendChild(w)
  }

  if (Array.isArray(content.rows) && content.rows.length) {
    const rows = document.createElement('div')
    rows.className = 'tc-rows'
    for (const r of content.rows) {
      const row = document.createElement('div')
      row.className = 'tc-row'
      const label = document.createElement('span')
      label.className = 'tc-row-label'
      label.textContent = r.label || ''
      const value = document.createElement('span')
      value.className = 'tc-row-value'
      value.textContent = r.value || ''
      row.appendChild(label)
      row.appendChild(value)
      rows.appendChild(row)
    }
    card.appendChild(rows)
  }

  const actions = document.createElement('div')
  actions.className = 'tc-actions'
  for (const action of (content.actions || [])) {
    const btn = document.createElement('button')
    btn.className = 'tc-btn ' + (action.primary ? 'tc-btn-primary' : 'tc-btn-secondary')
    btn.textContent = action.label || action.id
    btn.addEventListener('click', () => window.overlayBridge.sendAction(action.id, {}))
    actions.appendChild(btn)
  }
  card.appendChild(actions)

  scrim.appendChild(card)
  root.appendChild(scrim)
}

function updateSelection(index) {
  const items = root.querySelectorAll('.suggestion-item, .menu-item:not(.disabled)')
  items.forEach((el) => el.classList.remove('selected'))

  if (index >= 0 && index < items.length) {
    items[index].classList.add('selected')
    items[index].scrollIntoView({ block: 'nearest' })
  }

  selectedIndex = index
}

window.overlayBridge.onContent((content) => {
  if (!content) {
    root.innerHTML = ''
    root.className = ''
    currentItems = []
    selectedIndex = -1
    return
  }

  root.className = ''
  if (content.type === 'suggestions' && content.items) {
    renderSuggestions(content.items)
    if (typeof content.selectedIndex === 'number') {
      updateSelection(content.selectedIndex)
    }
  } else if (content.type === 'menu' && content.items) {
    renderMenu(content.items)
  } else if (content.type === 'form') {
    renderForm(content)
  } else if (content.type === 'approval') {
    renderApproval(content)
  }
})

window.overlayBridge.onTheme((theme) => {
  if (!theme) return
  const rootEl = document.documentElement
  for (const [key, value] of Object.entries(theme)) {
    rootEl.style.setProperty(key, value)
  }
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault()
    window.overlayBridge.sendAction('dismiss', {})
    return
  }

  const selectableItems = root.querySelectorAll('.suggestion-item, .menu-item:not(.disabled)')
  const count = selectableItems.length
  if (count === 0) return

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    updateSelection(selectedIndex < count - 1 ? selectedIndex + 1 : 0)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    updateSelection(selectedIndex > 0 ? selectedIndex - 1 : count - 1)
  } else if (e.key === 'Enter' && selectedIndex >= 0) {
    e.preventDefault()
    selectableItems[selectedIndex].click()
  }
})
