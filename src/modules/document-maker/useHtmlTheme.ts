import { useEffect, useState } from 'react'

const read = (): 'light' | 'dark' => (document.documentElement.classList.contains('dark') ? 'dark' : 'light')

/** The app's current theme, following the `.dark` class on <html> as it changes. */
export function useHtmlTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState(read)
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(read()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return theme
}
