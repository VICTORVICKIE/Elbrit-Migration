// Google Drive client using the Google Identity Services (GIS) token model.
// Access tokens are ~1h and held in memory only; on 401 we silently request a
// fresh token and retry once. The GCP OAuth consent screen must be "Internal"
// (Workspace) for drive.readonly without verification — see README runbook.

import type { DriveFile } from '../../types'

const GIS_SRC = 'https://accounts.google.com/gsi/client'
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const GSHEET_MIME = 'application/vnd.google-apps.spreadsheet'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

// Drive's `q` filter has no "descendant of" operator — only direct parents —
// so nested spreadsheets require walking the folder tree ourselves. Capped
// to avoid pathological trees burning through Drive API quota.
const MAX_FOLDERS_VISITED = 200
const MAX_DEPTH = 6

interface TokenClient {
  requestAccessToken: (opts?: { prompt?: string }) => void
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (cfg: {
            client_id: string
            scope: string
            callback: (resp: { access_token?: string; error?: string }) => void
          }) => TokenClient
        }
      }
    }
  }
}

/** Google API errors are JSON — pretty-print it if parseable, else raw text. */
async function driveErrorMessage(res: Response): Promise<string> {
  const text = await res.text()
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return `${res.status} ${text}`
  }
}

let gisLoaded: Promise<void> | null = null

function loadGis(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve()
  if (!gisLoaded) {
    gisLoaded = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = GIS_SRC
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => reject(new Error('Failed to load Google Identity Services'))
      document.head.appendChild(s)
    })
  }
  return gisLoaded
}

export class DriveClient {
  private clientId: string
  private token: string | null = null
  private tokenClient: TokenClient | null = null
  // GIS's token flow doesn't handle overlapping concurrent requests — a
  // second initTokenClient()/requestAccessToken() call before the first's
  // callback fires clobbers it, so that first request never resolves. With
  // listFolder() now firing requests in parallel, every caller that needs a
  // token before one exists must share this single in-flight acquisition.
  private tokenPromise: Promise<string> | null = null

  constructor(clientId: string) {
    this.clientId = clientId
  }

  /** Acquire an access token; silent first, interactive consent as fallback. */
  private async acquireToken(interactive: boolean): Promise<string> {
    await loadGis()
    return new Promise((resolve, reject) => {
      this.tokenClient = window.google!.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: SCOPE,
        callback: (resp) => {
          if (resp.access_token) {
            this.token = resp.access_token
            resolve(resp.access_token)
          } else {
            reject(new Error(resp.error ?? 'Google authorization was cancelled'))
          }
        },
      })
      this.tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' })
    })
  }

  private async ensureToken(): Promise<string> {
    if (this.token) return this.token
    if (!this.tokenPromise) {
      this.tokenPromise = this.acquireToken(false)
        .catch(() => this.acquireToken(true))
        .finally(() => {
          this.tokenPromise = null
        })
    }
    return this.tokenPromise
  }

  private async fetchWithAuth(url: string, retried = false): Promise<Response> {
    await this.ensureToken()
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } })
    if (res.status === 401 && !retried) {
      this.token = null
      return this.fetchWithAuth(url, true)
    }
    return res
  }

  /** Direct children of a folder matching a `q` filter (paginated). */
  private async listChildren(
    folderId: string,
    mimeFilter: string,
    fields: string,
  ): Promise<Record<string, unknown>[]> {
    const results: Record<string, unknown>[] = []
    let pageToken: string | undefined
    do {
      const q = encodeURIComponent(
        `'${folderId}' in parents and trashed=false and (${mimeFilter})`,
      )
      const url =
        `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${encodeURIComponent(`nextPageToken,files(${fields})`)}` +
        `&orderBy=folder,name&pageSize=100${pageToken ? `&pageToken=${pageToken}` : ''}`
      const res = await this.fetchWithAuth(url)
      if (!res.ok) throw new Error(`Drive list failed: ${await driveErrorMessage(res)}`)
      const json = (await res.json()) as { files: Record<string, unknown>[]; nextPageToken?: string }
      results.push(...json.files)
      pageToken = json.nextPageToken
    } while (pageToken)
    return results
  }

  /** Lists spreadsheets in a folder and all its subfolders (BFS, capped, parallel per level). */
  async listFolder(folderId: string): Promise<DriveFile[]> {
    const files: DriveFile[] = []
    let queue: { id: string; depth: number; path: string[] }[] = [{ id: folderId, depth: 0, path: [] }]
    let visited = 0

    while (queue.length > 0 && visited < MAX_FOLDERS_VISITED) {
      const batch = queue.slice(0, MAX_FOLDERS_VISITED - visited)
      visited += batch.length
      queue = []

      const results = await Promise.all(
        batch.map(async ({ id, depth, path }) => {
          // One request per folder: fetch spreadsheets and subfolders together,
          // split client-side by mimeType, instead of two separate queries.
          const children = await this.listChildren(
            id,
            `mimeType='${XLSX_MIME}' or mimeType='${GSHEET_MIME}' or mimeType='${FOLDER_MIME}'`,
            'id,name,modifiedTime,size,mimeType',
          )
          return { children, depth, path }
        }),
      )

      for (const { children, depth, path } of results) {
        const folderPath = path.length ? path.join('/') : undefined
        for (const f of children) {
          if (f.mimeType === FOLDER_MIME) {
            if (depth < MAX_DEPTH) {
              queue.push({ id: f.id as string, depth: depth + 1, path: [...path, f.name as string] })
            }
          } else {
            files.push({
              id: f.id as string,
              name: f.name as string,
              modifiedTime: f.modifiedTime as string,
              size: f.size ? Number(f.size) : null,
              mimeType: f.mimeType as string,
              folderPath,
            })
          }
        }
      }
    }

    // Folder-grouped files first (sorted by folder path, then name within the
    // folder), root-level files last (sorted by name).
    return files.sort((a, b) => {
      if (Boolean(a.folderPath) !== Boolean(b.folderPath)) return a.folderPath ? -1 : 1
      if (a.folderPath && b.folderPath && a.folderPath !== b.folderPath) {
        return a.folderPath.localeCompare(b.folderPath)
      }
      return a.name.localeCompare(b.name)
    })
  }

  /** Fetch a single file's metadata by ID (e.g. to re-download a file we only have the driveFileId for). */
  async getFileMeta(fileId: string): Promise<DriveFile> {
    const fields = encodeURIComponent('id,name,modifiedTime,size,mimeType')
    const res = await this.fetchWithAuth(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=${fields}`)
    if (!res.ok) throw new Error(`Drive file lookup failed: ${await driveErrorMessage(res)}`)
    const f = (await res.json()) as { id: string; name: string; modifiedTime: string; size?: string; mimeType: string }
    return {
      id: f.id,
      name: f.name,
      modifiedTime: f.modifiedTime,
      size: f.size ? Number(f.size) : null,
      mimeType: f.mimeType,
    }
  }

  async downloadXlsx(file: Pick<DriveFile, 'id' | 'mimeType'>): Promise<ArrayBuffer> {
    const url =
      file.mimeType === GSHEET_MIME
        ? `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=${encodeURIComponent(XLSX_MIME)}`
        : `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`
    const res = await this.fetchWithAuth(url)
    if (!res.ok) throw new Error(`Drive download failed: ${await driveErrorMessage(res)}`)
    return res.arrayBuffer()
  }
}
