// Two routes, no dependency. History API is plenty for '/' and '/:id'.
//
// The id is NOT pattern-matched: routing just hands the path segment to the
// pages API and lets the 404 decide. That keeps legacy `p_<uuid>` pages and
// the 11-char short codes on the same path — no format migration, ever.

import { useEffect, useState } from 'react'

export type Route = { name: 'home' } | { name: 'page'; id: string }

/** App-global event so programmatic navigation re-renders `useRoute`. */
const NAV_EVENT = 'qdroute:navigate'

export function parseRoute(pathname: string): Route {
  // '/xxas23sadhj' → ['xxas23sadhj']; '/' → ['']; '/a/b' → two segments.
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length !== 1) return { name: 'home' }
  return { name: 'page', id: decodeURIComponent(segments[0]) }
}

export function navigate(to: Route, opts?: { replace?: boolean }): void {
  const path = to.name === 'home' ? '/' : `/${encodeURIComponent(to.id)}`
  if (opts?.replace) history.replaceState(null, '', path)
  else history.pushState(null, '', path)
  window.dispatchEvent(new Event(NAV_EVENT))
}

/** Subscribes to history changes (popstate + our own navigate events). */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.pathname))

  useEffect(() => {
    const sync = () => setRoute(parseRoute(location.pathname))
    window.addEventListener('popstate', sync)
    window.addEventListener(NAV_EVENT, sync)
    return () => {
      window.removeEventListener('popstate', sync)
      window.removeEventListener(NAV_EVENT, sync)
    }
  }, [])

  return route
}
