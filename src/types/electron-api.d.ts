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
    electronAPI: {
      httpRequest: (payload: HttpRequestPayload) => Promise<HttpRequestResult>
      parseTvboxConfig: (rawText: string) => Promise<ParseTvboxResult>
      
      // 新增的下载相关接口
      downloadEpisode: (url: string, filename: string, taskId: string) => Promise<{ ok: boolean; path?: string; error?: string }>
      cancelDownload: (taskId: string) => void
      onDownloadProgress: (cb: (data: { taskId: string, completed: number, total: number }) => void) => void
      
      // 新增的窗口控制接口
      minimize: () => void
      maximize: () => void
      close: () => void
    }
  }
}

export {}