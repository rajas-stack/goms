/** Loads the ONLYOFFICE Docs API (`api.js`) from the Document Server at runtime — it cannot be bundled, it must come
 *  from the same server that will host the editor frame. */

export interface DocEditorInstance { destroyEditor: () => void }
export interface DocsApi { DocEditor: new (containerId: string, config: Record<string, unknown>) => DocEditorInstance }

declare global {
  interface Window { DocsAPI?: DocsApi }
}

export const DOCS_API_PATH = '/web-apps/apps/api/documents/api.js'
const LOAD_TIMEOUT_MS = 20_000

export class DocumentServerUnreachable extends Error {
  constructor(public readonly serverUrl: string) {
    super(`The ONLYOFFICE Document Server at ${serverUrl} is not responding.`)
  }
}

const pending = new Map<string, Promise<DocsApi>>()

export function loadDocsApi(serverUrl: string): Promise<DocsApi> {
  const src = `${serverUrl.replace(/\/+$/, '')}${DOCS_API_PATH}`
  if (window.DocsAPI) return Promise.resolve(window.DocsAPI)
  const existing = pending.get(src)
  if (existing) return existing
  const promise = new Promise<DocsApi>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.async = true
    const fail = () => { pending.delete(src); script.remove(); reject(new DocumentServerUnreachable(serverUrl)) }
    const timer = window.setTimeout(fail, LOAD_TIMEOUT_MS)
    script.onload = () => {
      window.clearTimeout(timer)
      if (window.DocsAPI) resolve(window.DocsAPI)
      else fail()
    }
    script.onerror = () => { window.clearTimeout(timer); fail() }
    document.head.appendChild(script)
  })
  pending.set(src, promise)
  return promise
}
