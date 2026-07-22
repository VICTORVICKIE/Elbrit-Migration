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
    // /api/resource/* wraps its payload as {data: ...}; /api/method/* (whitelisted
    // function calls) wraps it as {message: ...} instead — different envelope key.
    unwrapKey: 'data' | 'message' = 'data',
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
      const json = (await res.json()) as Record<string, T>
      return json[unwrapKey]
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

  /**
   * Page through everything (used for Item / Customer indexes, which can run
   * into the thousands of rows). Fetches the total count up front so every
   * page can go out in parallel instead of one round-trip at a time — for a
   * large catalog, sequential paging stacks page-count × latency, which is
   * the dominant cost when the doctype is big. Falls back to sequential
   * paging if `frappe.client.get_count` isn't available on this ERPNext
   * instance (older/customized deployments).
   */
  async listAll<T>(
    doctype: string,
    opts: { filters?: unknown[][]; fields?: string[]; pageSize?: number } = {},
  ): Promise<T[]> {
    const pageSize = opts.pageSize ?? 200
    const filtersParam = opts.filters?.length ? JSON.stringify(opts.filters) : undefined
    const fieldsParam = JSON.stringify(opts.fields ?? ['name'])

    const fetchPage = (start: number): Promise<T[]> => {
      const params = new URLSearchParams()
      if (filtersParam) params.set('filters', filtersParam)
      params.set('fields', fieldsParam)
      params.set('limit_page_length', String(pageSize))
      params.set('limit_start', String(start))
      return this.request<T[]>('GET', `/api/resource/${encodeURIComponent(doctype)}?${params}`)
    }

    let total: number | null = null
    try {
      const countParams = new URLSearchParams()
      countParams.set('doctype', doctype)
      if (filtersParam) countParams.set('filters', filtersParam)
      const count = await this.request<number>('GET', `/api/method/frappe.client.get_count?${countParams}`, undefined, 'message')
      if (typeof count === 'number') total = count
    } catch {
      total = null // get_count unsupported/blocked here — fall back below
    }

    if (total !== null) {
      if (total === 0) return []
      const starts: number[] = []
      for (let start = 0; start < total; start += pageSize) starts.push(start)
      const pages = await Promise.all(starts.map(fetchPage))
      return pages.flat()
    }

    const all: T[] = []
    for (let start = 0; ; start += pageSize) {
      const page = await fetchPage(start)
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

  /**
   * Call a whitelisted server-side method (e.g. a Server Script of type
   * "API") by name, POSTing `params` as the body. Use this for bulk/joined
   * reads that would otherwise need many REST round-trips — the method runs
   * in-process on ERPNext via `frappe.get_all`/`frappe.get_meta`, which
   * side-steps both the per-doctype REST permission checks (frappe.get_all
   * ignores user permissions by default, unlike the list REST endpoint) and
   * the GET query-string length limit (params go in the POST body).
   */
  async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.request<T>('POST', `/api/method/${method}`, params, 'message')
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
