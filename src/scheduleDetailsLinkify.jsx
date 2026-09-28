import React from 'react'

/** URL / メール / 電話番号を検出してリンク化する（詳細表示用） */
const DETAIL_LINK_PATTERN =
  /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:\+81|0)\d{1,4}[-.\s()]{0,2}\d{1,4}[-.\s()]{0,2}\d{3,4}[-.\s()]{0,2}\d{3,4}|\b0\d{9,10}\b)/gi

const isUrlMatch = (value) => /^https?:\/\//i.test(value) || /^www\./i.test(value)

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

const linkStyle = {
  color: '#2563eb',
  textDecoration: 'underline',
  wordBreak: 'break-all',
}

const stopCardGesture = (event) => {
  event.stopPropagation()
}

/**
 * 詳細テキスト内の URL・メール・電話番号をタップ可能なリンクとして描画する。
 * カード全体のクリックと干渉しないよう stopPropagation する。
 */
export const renderLinkedScheduleDetails = (text) => {
  const raw = String(text || '')
  if (!raw.trim()) return '詳細なし'

  const nodes = []
  let lastIndex = 0
  let match
  let key = 0
  const pattern = new RegExp(DETAIL_LINK_PATTERN.source, 'gi')

  while ((match = pattern.exec(raw)) !== null) {
    const value = match[0]
    const start = match.index
    if (start > lastIndex) {
      nodes.push(raw.slice(lastIndex, start))
    }

    if (isUrlMatch(value)) {
      const label = value.replace(/[.,;:!?)]+$/g, '')
      const trailing = value.slice(label.length)
      const href = normalizeUrlHref(label)
      nodes.push(
        <a
          key={`url-${key++}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          style={linkStyle}
          onClick={stopCardGesture}
          onPointerDown={stopCardGesture}
        >
          {label}
        </a>
      )
      if (trailing) nodes.push(trailing)
    } else if (isEmailMatch(value)) {
      const label = value.replace(/[.,;:!?)]+$/g, '')
      const trailing = value.slice(label.length)
      nodes.push(
        <a
          key={`mail-${key++}`}
          href={normalizeMailtoHref(label)}
          style={linkStyle}
          onClick={stopCardGesture}
          onPointerDown={stopCardGesture}
        >
          {label}
        </a>
      )
      if (trailing) nodes.push(trailing)
    } else if (isPlausiblePhone(value)) {
      const href = normalizeTelHref(value)
      if (href) {
        nodes.push(
          <a
            key={`tel-${key++}`}
            href={href}
            style={linkStyle}
            onClick={stopCardGesture}
            onPointerDown={stopCardGesture}
          >
            {value}
          </a>
        )
      } else {
        nodes.push(value)
      }
    } else {
      nodes.push(value)
    }

    lastIndex = start + value.length
  }

  if (lastIndex < raw.length) {
    nodes.push(raw.slice(lastIndex))
  }

  return nodes.length > 0 ? nodes : raw
}
