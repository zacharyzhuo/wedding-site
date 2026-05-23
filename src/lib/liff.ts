// Thin wrapper around @line/liff so the LIFF init lifecycle is in one place.
// Components consume `useLiffProfile()` and stay free of SDK details.
'use client'

import { useEffect, useState } from 'react'

export type LiffProfile = {
  userId: string
  displayName: string
  pictureUrl?: string
}

type LiffState =
  | { status: 'loading' }
  | { status: 'ready'; profile: LiffProfile; inClient: boolean }
  | { status: 'error'; message: string }

export function useLiffProfile(liffId: string | undefined): LiffState {
  const [state, setState] = useState<LiffState>({ status: 'loading' })

  useEffect(() => {
    if (!liffId) {
      setState({ status: 'error', message: 'Missing LIFF ID env var' })
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        // Dynamic import keeps the SDK out of any server-rendered bundle.
        const liff = (await import('@line/liff')).default
        await liff.init({ liffId })

        if (!liff.isLoggedIn()) {
          // Opens LINE Login; control returns to this page after redirect.
          liff.login()
          return
        }

        const profile = await liff.getProfile()
        if (cancelled) return
        setState({
          status: 'ready',
          profile: {
            userId: profile.userId,
            displayName: profile.displayName,
            pictureUrl: profile.pictureUrl,
          },
          inClient: liff.isInClient(),
        })
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        if (!cancelled) setState({ status: 'error', message })
      }
    })()

    return () => { cancelled = true }
  }, [liffId])

  return state
}
