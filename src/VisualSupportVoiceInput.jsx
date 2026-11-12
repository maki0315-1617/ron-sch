import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Mic, MicOff, X } from 'lucide-react'

const getSpeechRecognitionCtor = () => {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

export const isSpeechRecognitionAvailable = () => Boolean(getSpeechRecognitionCtor())

/**
 * 視覚サポート向け音声入力パネル。
 * ×だけに依存せず、大きい「閉じる」「確定」を常時表示する。
 */
export default function VisualSupportVoiceInput({
  open,
  fieldLabel = '入力欄',
  initialText = '',
  maxLength = 0,
  onConfirm,
  onClose,
}) {
  const [draft, setDraft] = useState('')
  const [listening, setListening] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const recognitionRef = useRef(null)
  const speakButtonRef = useRef(null)
  const panelRef = useRef(null)
  const baseTextRef = useRef('')

  const stopRecognition = () => {
    const recognition = recognitionRef.current
    recognitionRef.current = null
    if (!recognition) {
      setListening(false)
      return
    }
    try {
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      recognition.stop()
    } catch {
      // ignore
    }
    setListening(false)
  }

  useEffect(() => {
    if (!open) {
      stopRecognition()
      return undefined
    }
    const next = String(initialText || '')
    setDraft(next)
    baseTextRef.current = next
    setErrorMessage('')
    setStatusMessage(
      isSpeechRecognitionAvailable()
        ? `${fieldLabel}の音声入力を開きました。下の「話す」で開始、「閉じる」で終了できます。`
        : 'この端末では音声入力を利用できません。キーボードで入力するか、閉じてください。',
    )
    const timer = window.setTimeout(() => {
      speakButtonRef.current?.focus?.()
    }, 50)
    return () => {
      window.clearTimeout(timer)
      stopRecognition()
    }
    // open 時のみ初期化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        stopRecognition()
        onClose?.()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, onClose])

  const applyLength = (value) => {
    const text = String(value || '')
    if (maxLength > 0) return text.slice(0, maxLength)
    return text
  }

  const startListening = () => {
    const Recognition = getSpeechRecognitionCtor()
    if (!Recognition) {
      setErrorMessage('このブラウザでは音声入力に対応していません。')
      return
    }
    stopRecognition()
    setErrorMessage('')
    baseTextRef.current = draft
    const recognition = new Recognition()
    recognition.lang = 'ja-JP'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onstart = () => {
      setListening(true)
      setStatusMessage('聞いています。話してください。')
    }
    recognition.onresult = (event) => {
      let finalChunk = ''
      let interimChunk = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        const transcript = result?.[0]?.transcript || ''
        if (result.isFinal) finalChunk += transcript
        else interimChunk += transcript
      }
      if (finalChunk) {
        baseTextRef.current = applyLength(`${baseTextRef.current}${finalChunk}`)
      }
      const next = applyLength(`${baseTextRef.current}${interimChunk}`)
      setDraft(next)
      if (finalChunk) setStatusMessage('認識しました。続けて話すか、確定してください。')
    }
    recognition.onerror = (event) => {
      const code = event?.error || ''
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        setErrorMessage('マイクの許可がありません。ブラウザの設定を確認してください。')
      } else if (code === 'no-speech') {
        setErrorMessage('声を検出できませんでした。もう一度「話す」を押してください。')
      } else if (code !== 'aborted') {
        setErrorMessage(`音声入力でエラーが発生しました（${code || '不明'}）。`)
      }
      setListening(false)
      setStatusMessage('音声入力を停止しました。')
    }
    recognition.onend = () => {
      setListening(false)
      recognitionRef.current = null
      setStatusMessage((current) => (
        current?.includes('聞いています') ? '音声入力を停止しました。' : current
      ))
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
    } catch (error) {
      setListening(false)
      setErrorMessage(error?.message || '音声入力を開始できませんでした。')
    }
  }

  const toggleListening = () => {
    if (listening) {
      stopRecognition()
      setStatusMessage('音声入力を停止しました。')
      return
    }
    startListening()
  }

  const handleConfirm = () => {
    stopRecognition()
    onConfirm?.(applyLength(draft))
    onClose?.()
  }

  const handleClose = () => {
    stopRecognition()
    onClose?.()
  }

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      style={styles.overlay}
      role="presentation"
      onClick={handleClose}
    >
      <div
        ref={panelRef}
        className="visual-support-voice-panel"
        style={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={`${fieldLabel}の音声入力`}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={styles.header}>
          <h2 style={styles.title}>話して入力</h2>
          <p style={styles.subtitle}>対象: {fieldLabel}</p>
        </div>

        <div style={styles.liveRegion} aria-live="assertive" aria-atomic="true">
          {statusMessage}
        </div>
        {errorMessage ? (
          <div style={styles.error} role="alert">{errorMessage}</div>
        ) : null}

        <label style={styles.fieldLabel} htmlFor="visual-support-voice-draft">
          認識テキスト（手入力もできます）
        </label>
        <textarea
          id="visual-support-voice-draft"
          value={draft}
          onChange={(event) => setDraft(applyLength(event.target.value))}
          style={styles.textarea}
          rows={5}
          maxLength={maxLength > 0 ? maxLength : undefined}
        />
        {maxLength > 0 ? (
          <div style={styles.counter}>{draft.length} / {maxLength}</div>
        ) : null}

        <div style={styles.actions}>
          <button
            ref={speakButtonRef}
            type="button"
            style={{
              ...styles.actionButton,
              ...(listening ? styles.listeningButton : styles.primaryButton),
            }}
            onClick={toggleListening}
            aria-pressed={listening}
          >
            {listening ? <MicOff size={22} aria-hidden="true" /> : <Mic size={22} aria-hidden="true" />}
            {listening ? '停止' : '話す'}
          </button>
          <button
            type="button"
            style={{ ...styles.actionButton, ...styles.primaryButton }}
            onClick={handleConfirm}
          >
            確定して入れる
          </button>
          <button
            type="button"
            style={{ ...styles.actionButton, ...styles.closeButton }}
            onClick={handleClose}
          >
            <X size={22} aria-hidden="true" />
            閉じる
          </button>
        </div>
        <p style={styles.hint}>
          閉じる方法: 下の「閉じる」ボタン、またはキーボードの Esc。
        </p>
      </div>
    </div>,
    document.body,
  )
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 400,
    background: 'rgba(15, 23, 42, 0.55)',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    padding: '12px 12px max(12px, env(safe-area-inset-bottom))',
  },
  panel: {
    width: 'min(560px, 100%)',
    maxHeight: 'min(92vh, 720px)',
    overflowY: 'auto',
    background: '#ffffff',
    borderRadius: '16px 16px 12px 12px',
    border: '2px solid #0f172a',
    boxShadow: '0 18px 40px rgba(15, 23, 42, 0.28)',
    padding: '16px',
    color: '#0f172a',
  },
  header: {
    marginBottom: 10,
  },
  title: {
    margin: 0,
    fontSize: 22,
    fontWeight: 800,
    lineHeight: 1.3,
  },
  subtitle: {
    margin: '6px 0 0',
    fontSize: 15,
    fontWeight: 600,
    color: '#334155',
  },
  liveRegion: {
    margin: '0 0 8px',
    padding: '10px 12px',
    borderRadius: 10,
    background: '#eff6ff',
    border: '1px solid #93c5fd',
    color: '#1e3a8a',
    fontSize: 15,
    fontWeight: 700,
    lineHeight: 1.45,
  },
  error: {
    margin: '0 0 8px',
    padding: '10px 12px',
    borderRadius: 10,
    background: '#fef2f2',
    border: '1px solid #fca5a5',
    color: '#991b1b',
    fontSize: 15,
    fontWeight: 700,
    lineHeight: 1.45,
  },
  fieldLabel: {
    display: 'block',
    margin: '0 0 6px',
    fontSize: 14,
    fontWeight: 700,
  },
  textarea: {
    width: '100%',
    minHeight: 120,
    resize: 'vertical',
    borderRadius: 10,
    border: '2px solid #334155',
    padding: '12px',
    fontSize: 18,
    lineHeight: 1.5,
    fontFamily: 'inherit',
    color: '#0f172a',
    background: '#fff',
  },
  counter: {
    marginTop: 4,
    textAlign: 'right',
    fontSize: 13,
    color: '#475569',
    fontWeight: 600,
  },
  actions: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: 10,
    marginTop: 14,
  },
  actionButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 52,
    width: '100%',
    borderRadius: 12,
    border: '2px solid #0f172a',
    fontSize: 18,
    fontWeight: 800,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  primaryButton: {
    background: '#2563eb',
    color: '#fff',
    borderColor: '#1d4ed8',
  },
  listeningButton: {
    background: '#b91c1c',
    color: '#fff',
    borderColor: '#991b1b',
  },
  closeButton: {
    background: '#f8fafc',
    color: '#0f172a',
    borderColor: '#0f172a',
  },
  hint: {
    margin: '12px 0 0',
    fontSize: 13,
    lineHeight: 1.45,
    color: '#334155',
    fontWeight: 600,
  },
}
