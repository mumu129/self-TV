import type { UnlistenFn } from '@tauri-apps/api/event'
import type { TvboxConfig } from './tvbox'

export interface HttpRequestPayload {
  url: string
  method?: string
  headers?: Record<string, string>
}

export interface HttpRequestResult {
  ok: boolean
  status?: number
  data?: string
  error?: string
}

export type ParseTvboxResult =
  | { ok: true; config: TvboxConfig }
  | { ok: false; error: string }

declare global {
  interface Window {
    desktopAPI: {
      httpRequest: (payload: HttpRequestPayload) => Promise<HttpRequestResult>
      parseTvboxConfig: (rawText: string) => Promise<ParseTvboxResult>
      downloadEpisode: (url: string, filename: string, taskId: string) => Promise<{ ok: boolean; path?: string; error?: string }>
      cancelDownload: (taskId: string) => Promise<void>
      onDownloadProgress: (cb: (data: { taskId: string; completed: number; total: number }) => void) => Promise<UnlistenFn>
      convertFileSrc: (path: string) => string
      proxyMediaUrl: (url: string) => Promise<string>
      minimize: () => Promise<void>
      maximize: () => Promise<void>
      close: () => Promise<void>
      toggleDevTools: () => Promise<void>
    }
  }
}

export {}
