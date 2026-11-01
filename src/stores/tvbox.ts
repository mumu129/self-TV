import { defineStore } from 'pinia'
import { XMLParser } from 'fast-xml-parser'
import type { Category, CategoryGroup, Episode, TvboxConfig, TvboxSite, VideoItem, ParseItem, FilterGroup, HistoryItem, FavoriteItem, DownloadItem } from '@/types/tvbox'
import { ElMessage } from 'element-plus'

interface Task {
  id: string
  videoName: string
  episodeName: string
  pic: string
  progress: number
  total: number
  status: 'downloading' | 'canceled' | 'done'
  epUrl: string
}

interface State {
  config: TvboxConfig | null
  savedSites: TvboxSite[] 
  currentSite: TvboxSite | null
  categoryGroups: CategoryGroup[]
  currentGroupId: string
  currentCategoryId: string
  filters: FilterGroup[] 
  activeFilters: Record<string, string> 
  searchKeyword: string
  currentPage: number
  hasMore: boolean
  videos: VideoItem[]
  currentVideo: VideoItem | null
  episodes: Episode[]
  currentPlayEpisode: Episode | null
  favorites: FavoriteItem[]
  historyList: HistoryItem[]
  downloads: DownloadItem[]
  resumeProgress: number
  loading: boolean
  error: string
  parses: ParseItem[]
  currentParseUrl: string
  enableAdFilter: boolean
  playProgressMap: Record<string, number>
  downloadingTasks: Task[]
}

function cleanApiUrl(api: string): string {
  if (!api) return ''
  return api.replace(/([?&])ac=[^&]*/g, '$1').replace(/[?&]$/, '')
}
function buildCmsUrl(site: TvboxSite, params: Record<string, string>): string {
  const base = cleanApiUrl(site.api)
  const sep = base.includes('?') ? '&' : '?'
  const query = new URLSearchParams(params).toString()
  return `${base}${sep}${query}`
}
function normalizeVideo(item: any): VideoItem {
  if (!item) return {} as VideoItem
  return {
    id: String(item.vod_id ?? item.id ?? ''),
    name: String(item.vod_name ?? item.name ?? ''),
    pic: String(item.vod_pic ?? item.pic ?? ''),
    remarks: String(item.vod_remarks ?? item.remarks ?? ''),
    year: String(item.vod_year ?? ''),
    area: String(item.vod_area ?? ''),
    typeName: String(item.vod_class ?? item.type_name ?? ''),
    actor: String(item.vod_actor ?? ''),
    director: String(item.vod_director ?? ''),
    content: String(item.vod_content ?? item.vod_blurb ?? ''),
    playFrom: String(item.vod_play_from ?? ''),
    playUrl: String(item.vod_play_url ?? ''),
  }
}
function parseEpisodes(video: VideoItem): Episode[] {
  if (!video.playUrl) return []
  const froms = video.playFrom ? video.playFrom.split('$$$') : []
  const urlGroups = video.playUrl.split('$$$')
  const episodes: Episode[] = []
  urlGroups.forEach((group, index) => {
    const fromName = froms[index] || `线路${index + 1}`
    group.split('#').forEach(seg => {
      const parts = seg.split('$')
      if (parts.length >= 2) episodes.push({ name: parts[0], url: parts[1], from: fromName })
    })
  })
  return episodes
}
async function requestJson(url: string): Promise<Record<string, any>> {
  const res = await window.electronAPI.httpRequest({ url })
  if (!res.ok) throw new Error(res.error ?? '网络请求失败')
  if (!res.data) throw new Error('响应为空')
  let responseData = res.data.trim()
  if (responseData.startsWith('<')) {
    const parser = new XMLParser({ ignoreAttributes: false })
    const xmlObj = parser.parse(responseData)
    const rss = xmlObj.rss
    if (rss && rss.list) {
      return {
        class: rss.class ? (Array.isArray(rss.class.ty) ? rss.class.ty : [rss.class.ty]) : [],
        filters: rss.filters,
        list: rss.list.video ? (Array.isArray(rss.list.video) ? rss.list.video : [rss.list.video]) : []
      }
    }
    throw new Error('无法解析的 XML 结构')
  }
  return JSON.parse(responseData)
}
function getLocalData<T>(key: string, defaultVal: T): T {
  try {
    const data = localStorage.getItem(key)
    return data ? JSON.parse(data) : defaultVal
  } catch { return defaultVal }
}

export const useTvboxStore = defineStore('tvbox', {
  state: (): State => ({
    config: null,
    savedSites: getLocalData<TvboxSite[]>('tvbox_sites', []),
    currentSite: null,
    categoryGroups: [],
    currentGroupId: '',
    currentCategoryId: '',
    filters: [],
    activeFilters: {},
    searchKeyword: '',
    currentPage: 1,
    hasMore: true,
    videos: [],
    currentVideo: null,
    episodes: [],
    currentPlayEpisode: null,
    favorites: getLocalData<FavoriteItem[]>('tvbox_favorites', []),
    historyList: getLocalData<HistoryItem[]>('tvbox_history', []),
    downloads: getLocalData<DownloadItem[]>('tvbox_downloads', []),
    resumeProgress: 0,
    loading: false,
    error: '',
    parses: getLocalData<ParseItem[]>('tvbox_parses', []),
    currentParseUrl: localStorage.getItem('tvbox_current_parse') || '',
    enableAdFilter: localStorage.getItem('tvbox_ad_filter') !== 'false',
    playProgressMap: getLocalData<Record<string, number>>('tvbox_play_map', {}),
    downloadingTasks: [],
  }),

  actions: {
    saveSites() { localStorage.setItem('tvbox_sites', JSON.stringify(this.savedSites || [])) },
    async importConfig(rawText: string): Promise<TvboxSite[]> {
      this.error = ''
      try {
        const trimmed = rawText.trim()
        let config: TvboxConfig
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
          let apiUrl = trimmed
          if (apiUrl.includes('/xml/')) apiUrl = apiUrl.replace('/xml/', '/json/')
          config = { sites: [{ key: `custom_${Date.now()}`, name: '自定义接口', type: 1, api: apiUrl }] }
        } else if (trimmed.startsWith('{')) {
          try { config = JSON.parse(trimmed) } catch {
            const res = await window.electronAPI.parseTvboxConfig(rawText)
            if (!res.ok) throw new Error(res.error)
            config = res.config
          }
        } else {
          const res = await window.electronAPI.parseTvboxConfig(rawText)
          if (!res.ok) throw new Error(res.error)
          config = res.config
        }
        if (!config || !Array.isArray(config.sites)) throw new Error('配置中没有找到有效的 sites 列表')
        if (config.parses && Array.isArray(config.parses)) {
          const newParses = config.parses.filter((p: any) => p && p.url).map((p: any) => ({ name: p.name || '未命名解析', url: p.url }))
          const currentParses = this.parses || []
          const existingUrls = new Set(currentParses.map(p => p.url))
          const toAdd = newParses.filter((p: any) => !existingUrls.has(p.url))
          if (toAdd.length > 0) {
            this.parses = [...currentParses, ...toAdd]
            this.saveParses()
            if (!this.currentParseUrl && this.parses.length > 0) this.setCurrentParse(this.parses[0].url)
          }
        }
        const newSites = config.sites.filter(s => s.type === 1 && !!s.api && s.hide !== 1).map(s => ({
          ...s, key: s.key || `site_${Date.now()}_${Math.random().toString(36).substring(7)}`
        }))
        if (newSites.length === 0) throw new Error('当前配置中没有可用的 type:1 站点')
        const currentSites = this.savedSites || []
        const existingKeys = new Set(currentSites.map(s => s.key))
        const uniqueNewSites = newSites.filter(s => !existingKeys.has(s.key))
        this.savedSites = [...currentSites, ...uniqueNewSites]
        this.saveSites()
        return this.savedSites
      } catch (e) {
        this.error = e instanceof Error ? e.message : '配置解析失败'
        throw e
      }
    },
    removeSite(key: string) {
      this.savedSites = this.savedSites.filter(s => s.key !== key)
      this.saveSites()
      if (this.currentSite?.key === key) {
        this.currentSite = null
        this.categoryGroups = []
        this.videos = []
      }
    },
    async selectSite(site: TvboxSite): Promise<void> {
      this.currentSite = site
      this.categoryGroups = []
      this.currentGroupId = ''
      this.currentCategoryId = ''
      this.filters = []
      this.activeFilters = {}
      this.searchKeyword = ''
      this.videos = []
      this.error = ''
      await this.loadCategories()
    },
    async loadCategories(): Promise<void> {
      if (!this.currentSite) return
      this.loading = true
      try {
        const url = buildCmsUrl(this.currentSite, { ac: 'list' })
        const json = await requestJson(url)
        let rawClasses = json.class ?? json.classes ?? []
        if (!Array.isArray(rawClasses) && typeof rawClasses === 'object') rawClasses = [rawClasses]
        
        const parsedCats: Category[] = rawClasses.map((c: any) => ({
          id: String(c.type_id ?? c.id ?? c['@_id'] ?? ''),
          name: String(c.type_name ?? c.name ?? c['#text'] ?? ''),
          pid: String(c.type_pid ?? c.pid ?? '0')
        })).filter((c: Category) => c.id && c.name)

        const groups: CategoryGroup[] = []
        const rootCats = parsedCats.filter(c => !c.pid || c.pid === '0')
        
        if (rootCats.length > 0) {
          // 如果有明确的父子层级，直接按原样映射，绝不捏造“全部”节点
          rootCats.forEach(root => {
            groups.push({
              id: root.id,
              name: root.name,
              children: parsedCats.filter(child => child.pid === root.id)
            })
          })
        } else {
          // 如果是纯平铺数据（无父子关系），就直接作为一级展示
          groups.push({ id: 'all', name: '全部视频', children: parsedCats })
        }

        this.categoryGroups = groups
        if (groups.length > 0) await this.handleGroupChange(groups[0].id)
      } catch (e) {
        this.error = e instanceof Error ? e.message : '加载分类失败'
      } finally { this.loading = false }
    },
    async handleGroupChange(groupId: string) {
      this.currentGroupId = groupId
      const group = this.categoryGroups.find(g => g.id === groupId)
      if (group) {
        if (group.children.length > 0) {
          // 如果有子分类，默认选中第一个子分类
          await this.handleCategoryChange(group.children[0].id)
        } else {
          // 如果没有子分类，直接请求该一级分类本身的数据
          await this.handleCategoryChange(group.id)
        }
      }
    },
    async handleCategoryChange(categoryId: string) {
      this.currentCategoryId = categoryId
      this.activeFilters = {}
      this.searchKeyword = ''
      await this.loadVideos()
    },
    async loadVideos(isLoadMore = false): Promise<void> {
      if (!this.currentSite) return
      if (!isLoadMore) { this.currentPage = 1; this.hasMore = true; this.videos = [] }
      else { if (!this.hasMore) return; this.currentPage++ }
      this.loading = true; this.error = ''
      try {
        const params: Record<string, string> = { ac: 'detail', pg: String(this.currentPage) }
        if (this.searchKeyword) {
          params.wd = this.searchKeyword
        } else {
          params.t = this.currentCategoryId
          Object.keys(this.activeFilters).forEach(k => {
            if (this.activeFilters[k]) params[k] = this.activeFilters[k]
          })
        }
        const url = buildCmsUrl(this.currentSite, params)
        const json = await requestJson(url)
        if (!this.searchKeyword && json.filters) {
          const currentFilters = json.filters[this.currentCategoryId] || []
          this.filters = Array.isArray(currentFilters) ? currentFilters.map((f: any) => ({
            key: f.key, name: f.name, value: Array.isArray(f.value) ? f.value.map((v: any) => ({ n: v.n, v: v.v })) : []
          })) : []
        }
        let list = json.list ?? []
        if (!Array.isArray(list) && typeof list === 'object') list = [list]
        if (!Array.isArray(list)) list = []
        const newVideos = list.map((item: any) => normalizeVideo(item))
        if (isLoadMore) this.videos = [...this.videos, ...newVideos]
        else this.videos = newVideos
        if (newVideos.length === 0) this.hasMore = false
      } catch (e) {
        this.error = e instanceof Error ? e.message : '加载列表失败'
        this.hasMore = false
      } finally { this.loading = false }
    },
    async setFilter(key: string, value: string) {
      this.activeFilters[key] = value
      await this.loadVideos()
    },
    async search(keyword: string) {
      this.searchKeyword = keyword.trim()
      this.filters = []
      await this.loadVideos()
    },
    async openVideo(video: VideoItem, site?: TvboxSite): Promise<boolean> {
      if (site && (!this.currentSite || this.currentSite.key !== site.key)) {
        this.currentSite = site
      }
      if (!this.currentSite) return false
      this.currentVideo = video
      this.episodes = []
      this.currentPlayEpisode = null
      this.loading = true
      this.error = ''
      try {
        const url = buildCmsUrl(this.currentSite, { ac: 'detail', ids: video.id })
        const json = await requestJson(url)
        let list = json.list ?? []
        if (!Array.isArray(list) && typeof list === 'object') list = [list]
        const detail = list[0]
        if (!detail) throw new Error('详情接口未返回数据')
        const normalized = normalizeVideo(detail)
        this.currentVideo = normalized
        this.episodes = parseEpisodes(normalized)
        return true
      } catch (e) {
        this.error = e instanceof Error ? e.message : '加载详情失败'
        if (video.playUrl) {
          this.episodes = parseEpisodes(video)
          return true
        }
        return false
      } finally {
        this.loading = false
      }
    },
    setPlayEpisode(ep: Episode, resume: number = 0) {
      this.currentPlayEpisode = ep
      this.resumeProgress = resume
    },
    getEpisodeProgress(videoId: string, epUrl: string): number {
      const key = `${videoId}_${epUrl}`
      return this.playProgressMap[key] || 0
    },
    toggleFavorite(video: VideoItem) {
      if (!this.currentSite) return
      const idx = this.favorites.findIndex(f => f.video.id === video.id && f.siteKey === this.currentSite!.key)
      if (idx >= 0) this.favorites.splice(idx, 1)
      else this.favorites.unshift({ video, siteKey: this.currentSite.key })
      localStorage.setItem('tvbox_favorites', JSON.stringify(this.favorites))
    },
    isFavorite(videoId: string) {
      if (!this.currentSite) return false
      return this.favorites.some(f => f.video.id === videoId && f.siteKey === this.currentSite!.key)
    },
    removeFavorite(videoId: string, siteKey: string) {
      const idx = this.favorites.findIndex(f => f.video.id === videoId && f.siteKey === siteKey)
      if (idx >= 0) {
        this.favorites.splice(idx, 1)
        localStorage.setItem('tvbox_favorites', JSON.stringify(this.favorites))
      }
    },
    clearFavorites() {
      this.favorites = []
      localStorage.removeItem('tvbox_favorites')
    },
    updateHistory(video: VideoItem, ep: Episode, progress: number) {
      if (!this.currentSite || progress < 0) return
      if (progress > 0) {
        const mapKey = `${video.id}_${ep.url}`
        this.playProgressMap[mapKey] = progress
        localStorage.setItem('tvbox_play_map', JSON.stringify(this.playProgressMap))
      }
      const existingIdx = this.historyList.findIndex(h => h.video.id === video.id && h.siteKey === this.currentSite!.key)
      if (existingIdx >= 0) {
        const oldItem = this.historyList[existingIdx]
        if (ep.url !== oldItem.episodeUrl) {
          oldItem.episodeName = ep.name
          oldItem.episodeUrl = ep.url
          oldItem.progress = progress
          oldItem.updatedAt = Date.now()
          this.historyList.splice(existingIdx, 1)
          this.historyList.unshift(oldItem)
        } else {
          if (progress > oldItem.progress) {
            oldItem.progress = progress
            oldItem.updatedAt = Date.now()
            this.historyList.splice(existingIdx, 1)
            this.historyList.unshift(oldItem)
          }
        }
      } else {
        this.historyList.unshift({
          video, siteKey: this.currentSite.key, episodeName: ep.name, episodeUrl: ep.url, progress, updatedAt: Date.now()
        })
      }
      if (this.historyList.length > 100) this.historyList.pop()
      localStorage.setItem('tvbox_history', JSON.stringify(this.historyList))
    },
    removeHistory(index: number) {
      this.historyList.splice(index, 1)
      localStorage.setItem('tvbox_history', JSON.stringify(this.historyList))
    },
    clearHistory() {
      this.historyList = []
      localStorage.removeItem('tvbox_history')
      localStorage.removeItem('tvbox_play_map')
      this.playProgressMap = {}
    },

    saveDownloads() { localStorage.setItem('tvbox_downloads', JSON.stringify(this.downloads || [])) },
    addDownload(item: DownloadItem) {
      this.downloads.unshift(item)
      this.saveDownloads()
    },
    removeDownload(id: string) {
      this.downloads = this.downloads.filter(d => d.id !== id)
      this.saveDownloads()
    },
    clearDownloads() {
      this.downloads = []
      localStorage.removeItem('tvbox_downloads')
    },
    async addToDownloadQueue(video: VideoItem, eps: Episode[]) {
      if (!(window as any)._downloadProgressBound) {
        (window as any)._downloadProgressBound = true
        window.electronAPI.onDownloadProgress((data) => {
          const task = this.downloadingTasks.find(t => t.id === data.taskId)
          if (task) {
            task.progress = data.completed
            task.total = data.total
          }
        })
      }

      for (const ep of eps) {
        if (!ep.url.includes('.m3u8')) continue
        const isDownloaded = this.downloads.some(d => d.videoName === video.name && d.episodeName === ep.name)
        const isDownloading = this.downloadingTasks.some(t => t.episodeName === ep.name && t.videoName === video.name && t.status === 'downloading')
        if (isDownloaded || isDownloading) continue

        const taskId = Date.now().toString() + Math.random().toString(36).substring(7)
        const newTask: Task = {
          id: taskId,
          videoName: video.name,
          episodeName: ep.name,
          pic: video.pic,
          progress: 0,
          total: 100,
          status: 'downloading',
          epUrl: ep.url
        }
        this.downloadingTasks.unshift(newTask)
        this.runDownloadTask(newTask)
      }
      ElMessage.success(`已添加 ${eps.length} 个下载任务到后台`)
    },
    async runDownloadTask(task: Task) {
      try {
        const res = await window.electronAPI.downloadEpisode(task.epUrl, task.videoName + '-' + task.episodeName, task.id)
        if (res.ok && res.path) {
          task.status = 'done'
          this.addDownload({
            id: task.id, videoName: task.videoName, episodeName: task.episodeName,
            pic: task.pic, dirPath: res.path, m3u8Path: `${res.path}/index.m3u8`, createdAt: Date.now()
          })
          const idx = this.downloadingTasks.findIndex(t => t.id === task.id)
          if (idx >= 0) this.downloadingTasks.splice(idx, 1)
        } else if (res.error === 'CANCELED') {
          // 已取消
        } else {
          task.status = 'canceled'
          ElMessage.error(`下载失败: ${res.error}`)
        }
      } catch (e) {
        task.status = 'canceled'
      }
    },
    cancelDownloadTask(taskId: string) {
      window.electronAPI.cancelDownload(taskId)
      const idx = this.downloadingTasks.findIndex(t => t.id === taskId)
      if (idx >= 0) {
        this.downloadingTasks[idx].status = 'canceled'
        this.downloadingTasks.splice(idx, 1)
      }
    },

    saveParses() { localStorage.setItem('tvbox_parses', JSON.stringify(this.parses || [])) },
    addParse(name: string, url: string) {
      if (!url) return
      this.parses.push({ name: name || '自定义解析', url })
      this.saveParses()
      if (!this.currentParseUrl) this.setCurrentParse(url)
    },
    removeParse(index: number) {
      const removed = this.parses.splice(index, 1)[0]
      this.saveParses()
      if (removed && removed.url === this.currentParseUrl) this.setCurrentParse(this.parses.length > 0 ? this.parses[0].url : '')
    },
    setCurrentParse(url: string) {
      this.currentParseUrl = url
      localStorage.setItem('tvbox_current_parse', url)
    },
    setAdFilter(val: boolean) {
      this.enableAdFilter = val
      localStorage.setItem('tvbox_ad_filter', String(val))
    }
  },
})