'use client'

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import {
  addDays,
  addMonths,
  endOfMonth,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { it } from 'date-fns/locale'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'

interface ItalianDateInputProps {
  value: string
  onChange: (value: string) => void
  onValidityChange?: (isValid: boolean) => void
  required?: boolean
  disabled?: boolean
  autoFocus?: boolean
  min?: string
  max?: string
  ariaLabel?: string
  className?: string
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
}

interface PopoverPosition {
  top: number
  left: number
}

const DATE_PICKER_WIDTH = 304
const DATE_PICKER_HEIGHT = 376
const weekDays = ['Lu', 'Ma', 'Me', 'Gi', 'Ve', 'Sa', 'Do']

function parseIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)

  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return null
  }

  date.setHours(0, 0, 0, 0)
  return date
}

function toIsoDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toDisplayDate(value: string) {
  const date = parseIsoDate(value)
  return date ? format(date, 'dd/MM/yyyy') : ''
}

function parseDisplayDate(value: string) {
  const normalizedValue = value.trim()
  const isoDate = parseIsoDate(normalizedValue)
  if (isoDate) return isoDate

  const match = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(normalizedValue)
  if (!match) return null

  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  const date = new Date(year, month - 1, day)

  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return null
  }

  date.setHours(0, 0, 0, 0)
  return date
}

function getValidationMessage(
  draft: string,
  required: boolean,
  min?: string,
  max?: string,
) {
  if (!draft.trim()) return required ? 'Inserisci una data.' : ''

  const date = parseDisplayDate(draft)
  if (!date) return 'Inserisci la data completa nel formato GG/MM/AAAA.'

  const isoDate = toIsoDate(date)
  if (min && isoDate < min) return `La data deve essere successiva al ${toDisplayDate(min)}.`
  if (max && isoDate > max) return `La data deve essere precedente al ${toDisplayDate(max)}.`
  return ''
}

export default function ItalianDateInput({
  value,
  onChange,
  onValidityChange,
  required = false,
  disabled = false,
  autoFocus = false,
  min,
  max,
  ariaLabel = 'Data',
  className = '',
  onKeyDown,
}: ItalianDateInputProps) {
  const inputId = useId()
  const popoverId = `${inputId}-calendar`
  const wrapperRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(() => toDisplayDate(value))
  const [isOpen, setIsOpen] = useState(false)
  const [showValidation, setShowValidation] = useState(false)
  const [popoverPosition, setPopoverPosition] = useState<PopoverPosition | null>(null)
  const [visibleMonth, setVisibleMonth] = useState(() => (
    startOfMonth(parseIsoDate(value) || new Date())
  ))

  const selectedDate = useMemo(() => parseIsoDate(value), [value])
  const minDate = useMemo(() => (min ? parseIsoDate(min) : null), [min])
  const maxDate = useMemo(() => (max ? parseIsoDate(max) : null), [max])
  const validationMessage = useMemo(
    () => getValidationMessage(draft, required, min, max),
    [draft, required, min, max],
  )
  const isValid = !validationMessage

  const calendarDays = useMemo(() => {
    const firstDay = startOfWeek(startOfMonth(visibleMonth), { weekStartsOn: 1 })
    return Array.from({ length: 42 }, (_, index) => addDays(firstDay, index))
  }, [visibleMonth])

  const previousMonth = addMonths(visibleMonth, -1)
  const nextMonth = addMonths(visibleMonth, 1)
  const previousMonthDisabled = Boolean(minDate && endOfMonth(previousMonth) < minDate)
  const nextMonthDisabled = Boolean(maxDate && startOfMonth(nextMonth) > maxDate)

  useEffect(() => {
    setDraft(toDisplayDate(value))
  }, [value])

  useEffect(() => {
    inputRef.current?.setCustomValidity(validationMessage)
    onValidityChange?.(isValid)
  }, [isValid, onValidityChange, validationMessage])

  const updatePopoverPosition = useCallback(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return

    const rect = wrapper.getBoundingClientRect()
    const maximumLeft = Math.max(8, window.innerWidth - DATE_PICKER_WIDTH - 8)
    const left = Math.min(Math.max(8, rect.left), maximumLeft)
    const belowTop = rect.bottom + 8
    const top = belowTop + DATE_PICKER_HEIGHT <= window.innerHeight
      ? belowTop
      : Math.max(8, rect.top - DATE_PICKER_HEIGHT - 8)

    setPopoverPosition({ top, left })
  }, [])

  useEffect(() => {
    if (!isOpen) return

    updatePopoverPosition()
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (wrapperRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      setIsOpen(false)
    }
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    window.addEventListener('resize', updatePopoverPosition)
    window.addEventListener('scroll', updatePopoverPosition, { capture: true, passive: true })

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
      window.removeEventListener('resize', updatePopoverPosition)
      window.removeEventListener('scroll', updatePopoverPosition, true)
    }
  }, [isOpen, updatePopoverPosition])

  const commitDate = (date: Date, closeCalendar = false) => {
    const isoDate = toIsoDate(date)
    if ((min && isoDate < min) || (max && isoDate > max)) return

    setDraft(format(date, 'dd/MM/yyyy'))
    setShowValidation(false)
    onChange(isoDate)
    if (closeCalendar) {
      setIsOpen(false)
      inputRef.current?.focus()
    }
  }

  const handleTextChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextDraft = event.target.value.slice(0, 10)
    setDraft(nextDraft)

    const nextDate = parseDisplayDate(nextDraft)
    if (!nextDate) {
      if (!nextDraft.trim() && !required) onChange('')
      return
    }

    const isoDate = toIsoDate(nextDate)
    if ((min && isoDate < min) || (max && isoDate > max)) return
    onChange(isoDate)
    setVisibleMonth(startOfMonth(nextDate))
  }

  const handleBlur = () => {
    setShowValidation(true)
    const parsedDate = parseDisplayDate(draft)
    if (parsedDate && !getValidationMessage(draft, required, min, max)) {
      commitDate(parsedDate)
    }
  }

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && event.altKey) {
      event.preventDefault()
      setIsOpen(true)
      return
    }
    if (event.key === 'Escape' && isOpen) {
      event.preventDefault()
      setIsOpen(false)
      return
    }
    if (event.key === 'Enter' && validationMessage) {
      event.preventDefault()
      setShowValidation(true)
      inputRef.current?.reportValidity()
      return
    }
    onKeyDown?.(event)
  }

  const openCalendar = () => {
    if (disabled) return
    setVisibleMonth(startOfMonth(selectedDate || parseDisplayDate(draft) || new Date()))
    setIsOpen((current) => !current)
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayIso = toIsoDate(today)
  const todayDisabled = Boolean((min && todayIso < min) || (max && todayIso > max))

  const calendar = isOpen && popoverPosition
    ? createPortal(
        <div
          ref={popoverRef}
          id={popoverId}
          role="dialog"
          aria-label={`Calendario ${ariaLabel}`}
          className="fixed z-[100] w-[304px] rounded-xl border border-slate-200 bg-white p-3 shadow-2xl"
          style={{ top: popoverPosition.top, left: popoverPosition.left }}
        >
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setVisibleMonth(previousMonth)}
              disabled={previousMonthDisabled}
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Mese precedente"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <p className="font-semibold capitalize text-slate-900" aria-live="polite">
              {format(visibleMonth, 'MMMM yyyy', { locale: it })}
            </p>
            <button
              type="button"
              onClick={() => setVisibleMonth(nextMonth)}
              disabled={nextMonthDisabled}
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Mese successivo"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase text-slate-400">
            {weekDays.map((day) => <span key={day}>{day}</span>)}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-1">
            {calendarDays.map((date) => {
              const isoDate = toIsoDate(date)
              const isSelected = Boolean(selectedDate && isSameDay(date, selectedDate))
              const isToday = isSameDay(date, today)
              const isOutsideMonth = !isSameMonth(date, visibleMonth)
              const isDisabled = Boolean((min && isoDate < min) || (max && isoDate > max))

              return (
                <button
                  key={isoDate}
                  type="button"
                  onClick={() => commitDate(date, true)}
                  disabled={isDisabled}
                  aria-label={format(date, 'EEEE d MMMM yyyy', { locale: it })}
                  aria-pressed={isSelected}
                  className={`h-9 rounded-lg text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-25 ${
                    isSelected
                      ? 'bg-[#0b2f57] font-semibold text-white'
                      : isToday
                        ? 'bg-blue-50 font-semibold text-blue-700 hover:bg-blue-100'
                        : isOutsideMonth
                          ? 'text-slate-300 hover:bg-slate-50'
                          : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {date.getDate()}
                </button>
              )
            })}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
            {!required ? (
              <button
                type="button"
                onClick={() => {
                  setDraft('')
                  onChange('')
                  setShowValidation(false)
                  setIsOpen(false)
                }}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100"
              >
                Cancella
              </button>
            ) : <span />}
            <button
              type="button"
              onClick={() => commitDate(today, true)}
              disabled={todayDisabled}
              className="rounded-lg px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-30"
            >
              Oggi
            </button>
          </div>
        </div>,
        document.body,
      )
    : null

  return (
    <div ref={wrapperRef} className="relative min-w-0">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={handleTextChange}
          onBlur={handleBlur}
          onKeyDown={handleInputKeyDown}
          required={required}
          disabled={disabled}
          autoFocus={autoFocus}
          inputMode="numeric"
          autoComplete="off"
          placeholder="GG/MM/AAAA"
          aria-label={ariaLabel}
          aria-invalid={showValidation && !isValid}
          aria-haspopup="dialog"
          aria-controls={isOpen ? popoverId : undefined}
          className={`w-full rounded-lg border bg-white py-2 pl-3 pr-10 text-sm text-slate-800 outline-none transition focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-100 ${
            showValidation && !isValid
              ? 'border-red-400 focus:border-red-500 focus:ring-red-100'
              : 'border-slate-300 focus:border-blue-500 focus:ring-blue-100'
          } ${className}`}
        />
        <button
          type="button"
          onClick={openCalendar}
          disabled={disabled}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-slate-500 hover:bg-slate-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={`Apri calendario ${ariaLabel}`}
          aria-expanded={isOpen}
          aria-controls={popoverId}
        >
          <CalendarDays className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {showValidation && validationMessage ? (
        <p className="mt-1 text-xs text-red-600" role="alert">{validationMessage}</p>
      ) : null}
      {calendar}
    </div>
  )
}
