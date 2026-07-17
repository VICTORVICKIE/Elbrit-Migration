// ERPNext REST client — token auth, pagination, normalized errors, and a
// small write rate-limiter. All calls go straight from the browser; the
// ERPNext site must allow CORS from this app's origin (see README runbook).

export interface ErpError {
  kind: 'auth' | 'permission' | 'validation' | 'duplicate' | 'network' | 'server'
  httpStatus: number | null
  message: string
}

export class ErpApiError extends Error {
  kind: ErpError['kind']
  httpStatus: number | null
  constructor(err: ErpError) {
    super(err.message)
    this.kind = err.kind
    this.httpStatus = err.httpStatus
  }
}

interface ErpConfig {
  baseUrl: string
  apiKey: string
  apiSecret: string
}

/** Serialize writes: concurrency 1 with a gap, so we never hammer the ERP. */
class WriteQueue {
  private chain: Promise<unknown> = Promise.resolve()
  private gapMs: number
  constructor(gapMs = 200) {
    this.gapMs = gapMs
  }
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn)
    this.chain = next
      .catch(() => undefined)
      .then(() => new Promise((r) => setTimeout(r, this.gapMs)))
    return next
  }
}

function parseServerMessages(body: unknown): string {
  try {
    const b = body as { _server_messages?: string; exception?: string; message?: string }
    if (b._server_messages) {
      const msgs = JSON.parse(b._server_messages) as string[]
      return msgs
        .map((m) => {
          try {
            return (JSON.parse(m) as { message?: string }).message ?? m
          } catch {
            return m
          }
        })
        .join('; ')
    }
    return b.exception ?? b.message ?? ''
  } catch {
    return ''
  }
}

export class ErpNextClient {
  private cfg: ErpConfig
  private writes = new WriteQueue()

  constructor(cfg: ErpConfig) {
    this.cfg = { ...cfg, baseUrl: cfg.baseUrl.replace(/\/+$/, '') }
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    let res: Response
    try {
      res = await fetch(`${this.cfg.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `token ${this.cfg.apiKey}:${this.cfg.apiSecret}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch (e) {
      // fetch throws on network errors AND on CORS rejections — indistinguishable
      throw new ErpApiError({
        kind: 'network',
        httpStatus: null,
        message:
          'Could not reach ERPNext. Check the base URL, your network, and that CORS is allowed for this origin. ' +
          String(e),
      })
    }

    if (res.ok) {
      const json = (await res.json()) as { data: T }
      return json.data
    }

    let payload: unknown = {}
    try {
      payload = await res.json()
    } catch {
      /* non-JSON error body */
    }
    const detail = parseServerMessages(payload)
    const excType = (payload as { exc_type?: string }).exc_type ?? ''

    const kind: ErpError['kind'] =
      res.status === 401 || res.status === 403
        ? excType.includes('Permission')
          ? 'permission'
          : 'auth'
        : excType.includes('Duplicate') || res.status === 409
          ? 'duplicate'
          : res.status === 417 || excType.includes('Validation') || excType.includes('Mandatory')
            ? 'validation'
            : 'server'

    throw new ErpApiError({
      kind,
      httpStatus: res.status,
      message: detail || `${res.status} ${res.statusText}`,
    })
  }

  async getDoc<T>(doctype: string, name: string): Promise<T> {
    return this.request<T>('GET', `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`)
  }

  async list<T>(
    doctype: string,
    opts: { filters?: unknown[][]; fields?: string[]; limit?: number; orderBy?: string } = {},
  ): Promise<T[]> {
    const params = new URLSearchParams()
    if (opts.filters?.length) params.set('filters', JSON.stringify(opts.filters))
    params.set('fields', JSON.stringify(opts.fields ?? ['name']))
    params.set('limit_page_length', String(opts.limit ?? 100))
    if (opts.orderBy) params.set('order_by', opts.orderBy)
    return this.request<T[]>('GET', `/api/resource/${encodeURIComponent(doctype)}?${params}`)
  }

  /** Page through everything (used for Item / Customer indexes). */
  async listAll<T>(
    doctype: string,
    opts: { filters?: unknown[][]; fields?: string[]; pageSize?: number } = {},
  ): Promise<T[]> {
    const pageSize = opts.pageSize ?? 200
    const all: T[] = []
    for (let start = 0; ; start += pageSize) {
      const params = new URLSearchParams()
      if (opts.filters?.length) params.set('filters', JSON.stringify(opts.filters))
      params.set('fields', JSON.stringify(opts.fields ?? ['name']))
      params.set('limit_page_length', String(pageSize))
      params.set('limit_start', String(start))
      const page = await this.request<T[]>(
        'GET',
        `/api/resource/${encodeURIComponent(doctype)}?${params}`,
      )
      all.push(...page)
      if (page.length < pageSize) return all
    }
  }

  async createDoc<T>(doctype: string, doc: unknown): Promise<T> {
    return this.writes.run(() =>
      this.request<T>('POST', `/api/resource/${encodeURIComponent(doctype)}`, doc),
    )
  }

  async updateDoc<T>(doctype: string, name: string, doc: unknown): Promise<T> {
    return this.writes.run(() =>
      this.request<T>(
        'PUT',
        `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
        doc,
      ),
    )
  }

  /** Connection test: cheapest authenticated read. */
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.list('Department', { limit: 1 })
      return { ok: true, message: 'Connected to ERPNext.' }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  }
}
