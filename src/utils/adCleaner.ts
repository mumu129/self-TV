// src/utils/adCleaner.ts

// 替代原库的 urlResolve
const resolveUrl = (baseUrl: string, relativeUrl: string): string => {
  try {
    return new URL(relativeUrl, baseUrl).href;
  } catch (e) {
    return relativeUrl;
  }
};

export const cleanM3u8Ads = async (m3u8Url: string): Promise<string> => {
  const startTime = Date.now();
  const LOG_TAG = '[HLS-AdCleaner]';

  // 1. 拉取并格式化 M3U8
  const fetchM3u8 = async (url: string) => {
    // 使用 Electron IPC 请求以绕过跨域
    const res = await window.electronAPI.httpRequest({ url });
    if (!res.ok || !res.data) throw new Error('请求 m3u8 失败');
    
    return res.data
      .trim()
      .split('\n')
      .map((line: string) => {
        const l = line.trim();
        if (!l || l.startsWith('#')) return l;
        return resolveUrl(url, l);
      })
      .join('\n')
      .replace(/\n\n/g, '\n');
  };

  let m3u8Content = await fetchM3u8(m3u8Url);

  // 2. 处理嵌套 m3u8
  let lastUrl = m3u8Content.split('\n').filter(Boolean).slice(-1)[0] || '';
  if (lastUrl.length < 5) {
    lastUrl = m3u8Content.split('\n').filter(Boolean).slice(-2)[0] || '';
  }
  if (lastUrl.includes('.m3u8') && lastUrl !== m3u8Url) {
    m3u8Url = resolveUrl(m3u8Url, lastUrl);
    console.info(`${LOG_TAG} 嵌套 m3u8 发现: ${m3u8Url}`);
    m3u8Content = await fetchM3u8(m3u8Url);
  }

  const lines = m3u8Content.trim().split('\n').filter(Boolean);
  const hasAds = m3u8Content.includes('#EXT-X-DISCONTINUITY');

  // 3. 核心替换：帧率指纹算法
  if (hasAds) {
    console.info(`${LOG_TAG} 检测到 #EXT-X-DISCONTINUITY，启动帧率指纹分析...`);

    const commonFps = [23.976, 24, 25, 29.97, 30, 50, 60];
    const fpsCounts: Record<string, number> = {};
    commonFps.forEach(f => fpsCounts[f] = 0);
    
    let allDurs: number[] = [];

    // 统计帧率
    for (let line of lines) {
      if (line.startsWith('#EXTINF:')) {
        const durStr = line.split(':')[1].split(',')[0].trim();
        const dur = parseFloat(durStr);
        if (!isNaN(dur)) {
          allDurs.push(dur);
          for (let fps of commonFps) {
            const frames = dur * fps;
            const diff = Math.abs(frames - Math.round(frames));
            if (diff < 0.05) fpsCounts[fps]++;
          }
        }
      }
    }

    let mainFps = 24;
    let maxMatch = 0;
    for (let fps of commonFps) {
      if (fpsCounts[fps] > maxMatch) {
        maxMatch = fpsCounts[fps];
        mainFps = fps;
      }
    }

    console.info(`${LOG_TAG} 分析完成：主视频帧率 ${mainFps}fps (匹配切片数: ${maxMatch}/${allDurs.length})`);

    // 剔除广告块
    const finalLines: string[] = [];
    let currentBlock: string[] = [];
    let isAdBlock = false;

    const flushBlock = () => {
      if (currentBlock.length > 0) {
        if (!isAdBlock) {
          finalLines.push(...currentBlock);
        } else {
          console.info(`${LOG_TAG} 剔除广告区块 (帧率异常)`);
        }
        currentBlock = [];
      }
    };

    for (let line of lines) {
      const t = line.trim();
      if (!t) continue;

      if (t.startsWith('#EXTM3U') || t.startsWith('#EXT-X-VERSION') || 
          t.startsWith('#EXT-X-TARGETDURATION') || t.startsWith('#EXT-X-MEDIA-SEQUENCE') || 
          t.startsWith('#EXT-X-PLAYLIST-TYPE') || t.startsWith('#EXT-X-ENDLIST')) {
        finalLines.push(line);
        continue;
      }

      if (t.startsWith('#EXT-X-DISCONTINUITY')) {
        flushBlock();
        currentBlock = [line];
        isAdBlock = false;
        continue;
      }

      currentBlock.push(line);

      if (line.startsWith('#EXTINF:')) {
        const dur = parseFloat(line.split(':')[1].split(',')[0].trim());
        const frames = dur * mainFps;
        const diff = Math.abs(frames - Math.round(frames));
        if (diff > 0.1) isAdBlock = true;
      }
    }
    flushBlock();

    const cleanedContent = finalLines.join('\n');
    const finalCleanedLines = cleanedContent.split('\n').map(l => {
        if (l.trim() && !l.startsWith('#')) {
            return resolveUrl(m3u8Url, l.trim());
        }
        return l;
    }).join('\n');

    m3u8Content = finalCleanedLines;
    console.info(`${LOG_TAG} 帧率清洗完成`);
  } else {
    console.info(`${LOG_TAG} 未检测到广告标签，使用原 m3u8...`);
  }

  console.info(`${LOG_TAG} 处理耗时: ${Date.now() - startTime}ms`);
  return m3u8Content;
};