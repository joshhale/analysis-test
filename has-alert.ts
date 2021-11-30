import {compose, fromEvent} from '../subscription'
import {disableTaskList, enableTaskList} from '../behaviors/task-list'

import TaskListsElement from '@github/task-lists-element'
import {announce} from '../aria-live'
import {observe} from 'selector-observer'
import {toggleToast} from '../toast'

export enum ModifierKeys {
  NONE = '',
  ALT = 'alt',
  META = 'meta'
}

let modifierKey = ModifierKeys.NONE
const isMac = navigator.userAgent.match(/Macintosh/)

const abortControllers = new WeakMap()

observe('.js-convert-task-to-issue-enabled .comment-body', {
  add(el) {
    const taskItems = getTaskListItems(el)
    decorateItems(el, taskItems)

    const abortController = new AbortController()
    abortControllers.set(el, abortController)
    addModifierKeyEventListener(el, abortController.signal)
  },
  remove(el) {
    const controller = abortControllers.get(el)
    if (controller) {
      controller.abort()
    }
  }
})

observe('.enabled.task-list-item', {
  subscribe: el => compose(fromEvent(el, 'mouseenter', onMouseenter), fromEvent(el, 'mouseleave', onMouseleave))
})

observe('.js-convert-to-issue-button', {
  subscribe: el => compose(fromEvent(el, 'click', onConvertToIssueButtonClicked))
})

// These observers on the checkbox and link add the background styling
// when focusing on any of the task item's elements that are focusable when keyboard tabbing.
observe('.js-convert-task-to-issue-enabled .task-list-item-checkbox', {
  subscribe: el => compose(fromEvent(el, 'focus', onChildElementFocus), fromEvent(el, 'blur', onChildElementBlur))
})

observe('.js-convert-task-to-issue-enabled .js-issue-link', {
  subscribe: el => compose(fromEvent(el, 'focus', onChildElementFocus), fromEvent(el, 'blur', onChildElementBlur))
})

// In Firefox, when using the keyboard navigation only,
// the click event doesn't register if a modifier key is also pressed.
// So we assign the modifier key to a variable and check that variable on a click event.
// Related bug report: https://bugzilla.mozilla.org/show_bug.cgi?id=764822
function addModifierKeyEventListener(el: Element, signal: AbortSignal) {
  const commentBody = el as HTMLElement
  const buttons = Array.from(commentBody.querySelectorAll('button.convert-to-issue-button'))

  window.addEventListener(
    'keydown',
    (event: KeyboardEvent) => {
      if (!isModifierKeyPressed(event)) return

      modifierKey = ModifierKeys.META
      if (event.altKey) {
        modifierKey = ModifierKeys.ALT
      }

      updateTooltips(buttons as HTMLButtonElement[])
    },
    {signal}
  )

  window.addEventListener(
    'keyup',
    () => {
      resetModifierKey()
      updateTooltips(buttons as HTMLButtonElement[])
    },
    {signal}
  )
}

function updateTooltips(buttons: HTMLButtonElement[]) {
  const container = document.querySelector('.js-convert-task-to-issue-enabled') as TaskListsElement
  if (!container) return

  const dataElement = container.querySelector<HTMLDivElement>('.js-convert-task-to-issue-data')!
  const convertInlineTooltip = dataElement.getAttribute('data-tooltip-label-inline')!
  const convertOpenNewTabTooltip = dataElement.getAttribute('data-tooltip-label-open')!
  const convertOpenSameTabTooltip = dataElement.getAttribute('data-tooltip-label-open-same-tab')!

  for (const button of buttons) {
    if (modifierKey === ModifierKeys.ALT) {
      button.setAttribute('aria-label', convertOpenSameTabTooltip)
    } else if (modifierKey === ModifierKeys.META) {
      button.setAttribute('aria-label', convertOpenNewTabTooltip)
    } else {
      button.setAttribute('aria-label', convertInlineTooltip)
    }
  }
}

function getTaskListItems(parent: Element): Element[] {
  return Array.from(parent.querySelectorAll('ul.contains-task-list > li'))
}

// testing purposes
export function setModifierKey(key: ModifierKeys) {
  modifierKey = key
}

export function onConvertToIssueButtonClicked(event: Event) {
  const target = event.currentTarget as HTMLButtonElement
  const li = target.closest<HTMLLIElement>('li.plain-task-item')
  if (!li) return
  if (li.classList.contains('is-loading')) return

  const container = document.querySelector('.js-convert-task-to-issue-enabled') as TaskListsElement
  if (container) {
    container.disabled = true
  }
  const itemTitle = li.getAttribute('data-title')!
  const itemPosition = li.getAttribute('data-position')!

  if (modifierKey !== ModifierKeys.NONE) {
    handleOpenNewIssueLink(event as KeyboardEvent, container, itemTitle, itemPosition)
    return
  }
  disableTaskList(container)
  markItemAsLoading(li)

  const titleField = document.getElementById('js-inline-convert-to-issue-title') as HTMLInputElement
  const positionField = document.getElementById('js-inline-convert-to-issue-position') as HTMLInputElement
  titleField.value = itemTitle
  positionField.value = itemPosition

  const form = document.querySelector<HTMLFormElement>('.js-inline-convert-to-issue-form')
  if (form && form instanceof HTMLFormElement) {
    submitConvertToIssueForm(form, container, li)
  }
}

function isModifierKeyPressed(event: KeyboardEvent) {
  return event.altKey || (event.ctrlKey && event.shiftKey) || event.shiftKey || event.metaKey
}
function handleOpenNewIssueLink(
  event: KeyboardEvent,
  container: TaskListsElement,
  itemTitle: string,
  itemPosition: string
) {
  const dataElement = container.querySelector<HTMLDivElement>('.js-convert-task-to-issue-data')!
  const newIssueBaseUrl = dataElement.getAttribute('data-url')!
  const parentIssueNumber = dataElement.getAttribute('data-parent-issue-number')
  const newIssueUrl = `${newIssueBaseUrl}?convert_from_task=true&parent_issue_number=${parentIssueNumber}&title=${encodeURIComponent(
    itemTitle
  )}&position=${itemPosition}`

  if (modifierKey === ModifierKeys.ALT) {
    // open in current tab
    window.open(`${newIssueUrl}&click_type=current_tab`, '_self', 'noopener,noreferrer')
  } else {
    // open in new window or tab, based on user's browser preferences
    window.open(`${newIssueUrl}&click_type=new_tab`, '_blank', 'noopener,noreferrer')
  }
  resetModifierKey()
}

function resetModifierKey() {
  modifierKey = ModifierKeys.NONE
}

function markItemAsLoading(li: HTMLLIElement) {
  li.classList.add('is-loading')
  const itemCheckbox = li.querySelector("input[type='checkbox']")! as HTMLInputElement

  const spinnerDiv = document.querySelector('.js-convert-task-to-issue-spinner')!.cloneNode(true) as HTMLDivElement
  spinnerDiv.removeAttribute('hidden')
  itemCheckbox.parentNode?.insertBefore(spinnerDiv, itemCheckbox.nextSibling)

  const convertButton = li.querySelector('button') as HTMLButtonElement
  convertButton.hidden = true
}

function unmarkItemAsLoading(li: HTMLLIElement | undefined) {
  if (!li) return

  li.classList.remove('is-loading')
  const spinnerDiv = li.querySelector('.loading-spinner') as HTMLDivElement
  li.removeChild(spinnerDiv)
}

export function decorateItems(commentContainer: Element, textTaskItems: Element[]) {
  for (const item of textTaskItems) {
    if (hasConvertButton(item)) {
      return
    }
    const nestedList = item.querySelector('ul, ol')
    if (nestedList) {
      item.classList.add('pb-0')
    }

    item.classList.add('position-relative', 'border-right-0')
    if (hasIssueMentions(item)) continue
    if (hasSecurityAlertMentions(item)) continue

    // If it's an empty list item, don't add any additional classes
    // or a convert to issue button to it to preserve a11y keyboard tabbing order.
    if (!isTaskListItem(item)) continue

    item.classList.add('plain-task-item')
    const convertToIssueButton = createConvertButton()

    let title = ''
    if (nestedList) {
      for (const child of item.childNodes) {
        if (child.nodeType !== Node.TEXT_NODE) {
          continue
        }
        title += child.nodeValue
      }
      item.insertBefore(convertToIssueButton, nestedList)
    } else {
      item.classList.add('pr-6')
      title = textContentWithTitleMarkdown(item)
      item.appendChild(convertToIssueButton)
    }

    const itemTitle = title.trim()
    const itemPosition = position(item).toString()

    item.setAttribute('data-title', itemTitle)
    item.setAttribute('data-position', itemPosition)

    const buttonDescription = document.createElement('span')
    buttonDescription.hidden = true
    buttonDescription.className = 'js-clear'
    item.appendChild(buttonDescription)

    // eslint-disable-next-line i18n-text/no-en
    const modifierKeyDescription = `Press Enter to convert to an issue instantly. Press ${
      isMac ? 'Option' : 'Alt'
    }-Enter to open the create new issue form in the current tab. Press Shift-Enter to open the create new issue form.`
    // eslint-disable-next-line i18n-text/no-en
    buttonDescription.textContent = `Create an issue with the title ${itemTitle}. ${modifierKeyDescription}`
    const itemIdentifier = itemPosition.replace(/,/, '-')
    buttonDescription.id = `button-description-${itemIdentifier}`
    convertToIssueButton.setAttribute('aria-describedby', `button-description-${itemIdentifier}`)
  }
}

function createConvertButton() {
  const button = document.querySelector('.js-convert-to-issue-button')?.cloneNode(true) as HTMLButtonElement
  button.removeAttribute('hidden')
  button.addEventListener('focus', onChildElementFocus)
  button.addEventListener('blur', onChildElementBlur)
  return button
}

function hasIssueMentions(element: Element): boolean {
  return (
    element.querySelectorAll(':scope > span > .js-issue-link').length !== 0 ||
    element.querySelectorAll(':scope > p > span > .js-issue-link').length !== 0
  )
}

function hasSecurityAlertMentions(element: Element): boolean {
  return element.querySelectorAll(':scope > span > .js-security-alert-link').length !== 0
}

function hasConvertButton(element: Element): boolean {
  return !!element.querySelector('button.convert-to-issue-button')
}

function isTaskListItem(element: Element): boolean {
  return !!element.classList.contains('task-list-item')
}

// Remove all tags but <code> / </code>, replacing those with backticks and
// escaped HTML with plain, to preserve HTML and `code` markdown in issue titles
function textContentWithTitleMarkdown(item: Element) {
  return item.innerHTML
    .replace(/<(?!\/?code)[^>]+>|\n/g, '')
    .replace(/<\/?code>/g, '`')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#96;/g, '`')
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .trim()
}

function onMouseleave(event: Event) {
  const target = event.target as Element
  if (!target) {
    return
  }
  target.parentElement?.classList.remove('hovered')
  target.classList.remove('hovered')

  const parent = target.parentElement?.closest('.enabled.task-list-item')
  parent?.classList.add('hovered')
}

function onMouseenter(event: Event) {
  const target = event.target as Element
  if (!target) {
    return
  }

  const parent = target.parentElement?.closest('.enabled.task-list-item')
  parent?.classList.remove('hovered')

  target.classList.add('hovered')
}

function onChildElementFocus(event: Event) {
  const target = event.target as Element
  if (!target) {
    return
  }
  const parent = target.parentElement?.closest('.enabled.task-list-item')
  parent?.classList.add('hovered')
}

function onChildElementBlur(event: Event) {
  const target = event.target as Element
  if (!target) {
    return
  }
  const parent = target.parentElement?.closest('.enabled.task-list-item')
  parent?.classList.remove('hovered')
}

async function submitConvertToIssueForm(form: HTMLFormElement, container: TaskListsElement, listItem: HTMLLIElement) {
  let response
  let data

  try {
    response = await fetch(form.action, {
      method: form.method,
      body: new FormData(form),
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest'
      }
    })
    data = await response.json()
  } catch {
    // Ignore network errors
  }
  resetFormFields()

  if (response && !response.ok) {
    if (data) {
      showErrorToast(data)
      enableTaskList(container)
      unmarkItemAsLoading(listItem)
    } else {
      showErrorToast()
    }
  } else {
    if (data) {
      announce(`${data.title} was converted to an issue.`)
    }
  }
}

function showErrorToast(data?: {url: string; url_title: string}) {
  if (data?.url && data?.url_title) {
    const toastTemplate = document.querySelector<HTMLTemplateElement>('.js-convert-to-issue-update-error-toast')!
    const toastContent = toastTemplate.content.firstElementChild as HTMLDivElement
    const toastLink = toastContent.querySelector('a') as HTMLAnchorElement
    toastLink.href = data.url
    toastLink.textContent = data.url_title
    toggleToast(document.querySelector<HTMLElement>('.js-convert-to-issue-update-error-toast')!.innerHTML)
  } else {
    toggleToast(document.querySelector<HTMLElement>('.js-convert-to-issue-save-error-toast')!.innerHTML)
  }
}

function resetFormFields() {
  const titleField = document.getElementById('js-inline-convert-to-issue-title') as HTMLInputElement
  const positionField = document.getElementById('js-inline-convert-to-issue-position') as HTMLInputElement

  titleField.value = ''
  positionField.value = ''
}

// Copied logic from TaskListsElement, refactor tracked in: https://github.com/github/issues/issues/1456
// See: https://github.com/github/task-lists-element/blob/9344569de20fe5b61ed40f91fb96be86f7d8b639/src/task-lists-element.ts#L137
function position(item: Element): [number, number] {
  const list = taskList(item)
  if (!list) throw new Error('.contains-task-list not found')
  const index = item ? Array.from(list.children).indexOf(item) : -1
  return [listIndex(list), index]
}

function taskList(el: Element): Element | null {
  const parent = el.parentElement
  return parent ? parent.closest('.contains-task-list') : null
}

function listIndex(list: Element): number {
  const container = list.closest('task-lists')
  if (!container) throw new Error('parent not found')
  return Array.from(container.querySelectorAll('ol, ul')).indexOf(list)
}
