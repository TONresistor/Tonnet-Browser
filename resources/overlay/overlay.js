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
    currentItems = []
    selectedIndex = -1
    return
  }

  if (content.type === 'suggestions' && content.items) {
    renderSuggestions(content.items)
    if (typeof content.selectedIndex === 'number') {
      updateSelection(content.selectedIndex)
    }
  } else if (content.type === 'menu' && content.items) {
    renderMenu(content.items)
  } else if (content.type === 'form') {
    renderForm(content)
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
  } else if (e.key === 'Escape') {
    e.preventDefault()
    window.overlayBridge.sendAction('dismiss', {})
  }
})
