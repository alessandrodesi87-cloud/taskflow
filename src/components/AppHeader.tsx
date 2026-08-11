'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

interface AppHeaderProps {
  email?: string | null
  fullName?: string | null
  isAdmin?: boolean
  current?: 'dashboard' | 'settings' | 'admin'
  onLogout: () => void | Promise<void>
}

export default function AppHeader({
  email,
  fullName,
  isAdmin = false,
  current = 'dashboard',
  onLogout,
}: AppHeaderProps) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const label = fullName || email || 'Profilo'
  const initials = label
    .split(/\s+|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'TF'

  useEffect(() => {
    const closeMenu = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', closeMenu)
    return () => document.removeEventListener('mousedown', closeMenu)
  }, [])

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link href="/dashboard" className="text-2xl font-bold text-blue-600">TaskFlow</Link>
        <div className="flex items-center gap-2">
          {current !== 'dashboard' && (
            <Link href="/dashboard" className="rounded-lg px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 hover:text-blue-700">
              Dashboard
            </Link>
          )}
          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className="flex items-center gap-2 rounded-full border border-gray-200 bg-white py-1.5 pl-1.5 pr-3 text-left hover:bg-gray-50"
              aria-expanded={open}
              aria-haspopup="menu"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">{initials}</span>
              <span className="hidden max-w-48 truncate text-sm font-medium text-gray-700 sm:block">{label}</span>
              <span className="text-xs text-gray-400">⌄</span>
            </button>
            {open && (
              <div className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl" role="menu">
                <div className="border-b border-gray-100 px-4 py-3">
                  <p className="truncate text-sm font-semibold text-gray-900">{fullName || 'Il tuo profilo'}</p>
                  <p className="truncate text-xs text-gray-500">{email}</p>
                </div>
                <div className="p-2 text-sm">
                  <Link href="/settings?section=profile" className="block rounded-lg px-3 py-2 text-gray-700 hover:bg-gray-100" role="menuitem">Profilo</Link>
                  <Link href="/settings?section=notifications" className="block rounded-lg px-3 py-2 text-gray-700 hover:bg-gray-100" role="menuitem">Notifiche</Link>
                  <Link href="/settings?section=integrations" className="block rounded-lg px-3 py-2 text-gray-700 hover:bg-gray-100" role="menuitem">Integrazioni</Link>
                  {isAdmin && (
                    <Link href="/admin" className="block rounded-lg px-3 py-2 font-semibold text-red-700 hover:bg-red-50" role="menuitem">Amministrazione</Link>
                  )}
                </div>
                <div className="border-t border-gray-100 p-2">
                  <button type="button" onClick={() => void onLogout()} className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-gray-700 hover:bg-gray-100" role="menuitem">Esci</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
