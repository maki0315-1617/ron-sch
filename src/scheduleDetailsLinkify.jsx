import React from 'react'

/**
 * URL / メール / 電話番号を検出してリンク化する。
 * 地図（Google Maps 等の https URL）も対象。
 */
const DETAIL_LINK_PATTERN =
  /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|maps\.app\.goo\.gl\/[^\s<>"']+|goo\.gl\/maps\/[^\s<>"']+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:\+81|0)\d{1,4}[-.\s()]{0,2}\d{1,4}[-.\s()]{0,2}\d{3,4}[-.\s()]{0,2}\d{3,4}|\b0\d{9,10}\b)/gi

const isUrlMatch = (value) => (
  /^https?:\/\//i.test(value)
  || /^www\./i.test(value)
  || /^maps\.app\.goo\.gl\//i.test(value)
  || /^goo\.gl\/maps\//i.test(value)
)

const isEmailMatch = (value) => /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value)

const normalizeUrlHref = (value) => {
  if (/^https?:\/\//i.test(value)) return value
  return `https://${value}`
}

const normalizeMailtoHref = (value) => `mailto:${value}`

const normalizeTelHref = (value) => {
  const digits = String(value).replace(/[^\d+]/g, '')
  if (!digits) return null
  return `tel:${digits}`
}

const isPlausiblePhone = (value) => {
  const digits = String(value).replace(/\D/g, '')
  return digits.length >= 10 && digits.length <= 15
}

/** 全角英数・全角スペースを半角へ */
export const normalizeForLinkDetect = (text) => String(text || '')
  .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
  .replace(/\u3000/g, ' ')

const linkStyle = {
  color: '#1d4ed8',
  textDecoration: 'underline',
  wordBreak: 'break-all',
  cursor: 'pointer',
  pointerEvents: 'auto',
  position: 'relative',
  zIndex: 2,
  display: 'inline',
  padding: 0,
  margin: 0,
  border: 0,
  background: 'transparent',
  font: 'inherit',
  textAlign: 'inherit',
  WebkitTapHighlightColor: 'rgba(37, 99, 235, 0.25)',
}

const stopBubble = (event) => {
  event.stopPropagation()
}

export const openExternalHref = (href) => {
  if (!href || typeof window === 'undefined') return

  if (href.startsWith('tel:') || href.startsWith('mailto:')) {
    window.location.href = href
    return
  }

  const opened = window.open(href, '_blank', 'noopener,noreferrer')
  if (opened) return

  const anchor = document.createElement('a')
  anchor.href = href
  anchor.target = '_blank'
  anchor.rel = 'noopener noreferrer'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

const toLinkParts = (text) => {
  const raw = normalizeForLinkDetect(String(text || ''))
  if (!raw) return []

  const parts = []
  let lastIndex = 0
  const pattern = new RegExp(DETAIL_LINK_PATTERN.source, 'gi')
  let match

  while ((match = pattern.exec(raw)) !== null) {
    const value = match[0]
    const start = match.index
    if (start > lastIndex) {
      parts.push({ type: 'text', value: raw.slice(lastIndex, start) })
    }

    if (isUrlMatch(value)) {
      const label = value.replace(/[.,;:!?)]+$/g, '')
      const trailing = value.slice(label.length)
      parts.push({ type: 'link', value: label, href: normalizeUrlHref(label) })
      if (trailing) parts.push({ type: 'text', value: trailing })
    } else if (isEmailMatch(value)) {
      const label = value.replace(/[.,;:!?)]+$/g, '')
      const trailing = value.slice(label.length)
      parts.push({ type: 'link', value: label, href: normalizeMailtoHref(label) })
      if (trailing) parts.push({ type: 'text', value: trailing })
    } else if (isPlausiblePhone(value)) {
      const href = normalizeTelHref(value)
      if (href) parts.push({ type: 'link', value, href })
      else parts.push({ type: 'text', value })
    } else {
      parts.push({ type: 'text', value })
    }

    lastIndex = start + value.length
  }

  if (lastIndex < raw.length) {
    parts.push({ type: 'text', value: raw.slice(lastIndex) })
  }

  return parts.length > 0 ? parts : [{ type: 'text', value: raw }]
}

/**
 * 見守りコメント等で使うリンク化コンポーネント。
 * モーダル内でも確実に開くため button で実装する。
 */
export function LinkedText({ text, emptyFallback = '' }) {
  const raw = String(text ?? '')
  if (!raw.trim()) return emptyFallback

  const parts = toLinkParts(raw)

  return (
    <>
      {parts.map((part, index) => {
        if (part.type !== 'link') {
          return <React.Fragment key={`t-${index}`}>{part.value}</React.Fragment>
        }
        return (
          <button
            key={`l-${index}`}
            type="button"
            className="linked-text-link"
            style={linkStyle}
            title={part.href}
            onClick={(event) => {
              stopBubble(event)
              event.preventDefault()
              openExternalHref(part.href)
            }}
            onPointerDown={stopBubble}
            onTouchStart={stopBubble}
          >
            {part.value}
          </button>
        )
      })}
    </>
  )
}

/**
 * テキスト内の URL・メール・電話番号をタップ可能なリンクとして描画する。
 * @param {string} text
 * @param {{ emptyFallback?: React.ReactNode }} [options]
 */
export const renderLinkedText = (text, options = {}) => {
  const emptyFallback = Object.prototype.hasOwnProperty.call(options, 'emptyFallback')
    ? options.emptyFallback
    : ''
  return <LinkedText text={text} emptyFallback={emptyFallback} />
}

/** 予定詳細用（空のときは「詳細なし」） */
export const renderLinkedScheduleDetails = (text) => (
  renderLinkedText(text, { emptyFallback: '詳細なし' })
)
