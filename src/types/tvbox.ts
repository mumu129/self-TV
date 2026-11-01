export interface TvboxSite {
  key: string
  name: string
  type: number
  api: string
  hide?: number
}

export interface ParseItem {
  name: string
  url: string
}

export interface TvboxConfig {
  sites: TvboxSite[]
  parses?: ParseItem[]
  [key: string]: unknown
}

export interface VideoItem {
  id: string
  name: string
  pic: string
  remarks: string
  year: string
  area: string
  typeName: string
  actor: string
  director: string
  content: string
  playFrom: string
  playUrl: string
}

export interface Episode {
  name: string
  url: string
  from?: string
}

export interface Category {
  id: string
  name: string
  pid?: string
}

export interface CategoryGroup {
  id: string
  name: string
  children: Category[]
}

export interface FilterValue {
  n: string
  v: string
}

export interface FilterGroup {
  key: string
  name: string
  value: FilterValue[]
}

export interface HistoryItem {
  video: VideoItem
  siteKey: string
  episodeName: string
  episodeUrl: string
  progress: number
  updatedAt: number
}

export interface FavoriteItem {
  video: VideoItem
  siteKey: string
}

export interface DownloadItem {
  id: string
  videoName: string
  episodeName: string
  pic: string
  dirPath: string
  m3u8Path: string
  createdAt: number
}