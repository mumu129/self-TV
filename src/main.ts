import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import App from './App.vue'
import router from './router'
import './style.css'
import type { HttpRequestPayload, HttpRequestResult, ParseTvboxResult } from './types/tauri-api'

window.desktopAPI = {
	httpRequest: (payload: HttpRequestPayload) => invoke<HttpRequestResult>('http_request', { payload }),
	parseTvboxConfig: (rawText: string) => invoke<ParseTvboxResult>('parse_tvbox_config', { rawText }),
	downloadEpisode: (url: string, filename: string, taskId: string) =>
		invoke<{ ok: boolean; path?: string; error?: string }>('download_episode', { url, filename, taskId }),
	cancelDownload: (taskId: string) => invoke<void>('cancel_download', { taskId }),
	onDownloadProgress: (cb) => listen<{ taskId: string; completed: number; total: number }>(
		'download-progress', (event) => cb(event.payload)
	),
	convertFileSrc,
	proxyMediaUrl: (url: string) => invoke<string>('proxy_media_url', { url }),
	minimize: () => invoke<void>('minimize'),
	maximize: () => invoke<void>('maximize'),
	close: () => invoke<void>('close'),
	toggleDevTools: () => invoke<void>('toggle_devtools'),
}

window.addEventListener('keydown', (event) => {
	if (event.key === 'F12') {
		event.preventDefault()
		void window.desktopAPI.toggleDevTools()
	}
})

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(ElementPlus, { locale: zhCn }) // 配置中文

app.mount('#app')