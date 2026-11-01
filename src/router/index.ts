import { createRouter, createWebHashHistory } from 'vue-router'
import SiteBrowser from '@/views/SiteBrowser.vue'
import VideoDetail from '@/views/VideoDetail.vue'
import VideoPlayer from '@/views/VideoPlayer.vue'

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: SiteBrowser },
    { path: '/detail', component: VideoDetail }, // 👈 就是少了这一行
    { path: '/player', component: VideoPlayer },
  ],
})