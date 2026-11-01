import { app, Menu, session, ipcMain, net, BrowserWindow } from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTvboxJson } from "@whyun/tv-tools";
const __filename$1 = fileURLToPath(import.meta.url);
const __dirname$1 = path.dirname(__filename$1);
let mainWindow = null;
const activeDownloads = {};
const activeRequests = {};
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname$1, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname$1, "../dist/index.html"));
  }
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.key === "F12" && input.type === "keyDown") {
      mainWindow == null ? void 0 : mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
}
async function fetchText(url) {
  return new Promise((resolve, reject) => {
    const request = net.request({ url });
    let data = "";
    request.on("response", (response) => {
      response.on("data", (chunk) => {
        data += chunk.toString();
      });
      response.on("end", () => resolve(data));
    });
    request.on("error", (err) => reject(err));
    request.end();
  });
}
async function downloadSingleFile(url, dest, taskId) {
  return new Promise((resolve, reject) => {
    let isSettled = false;
    const request = net.request({ url });
    activeRequests[taskId] = request;
    const timeout = setTimeout(() => {
      if (isSettled) return;
      isSettled = true;
      request.abort();
      reject(new Error("TIMEOUT"));
    }, 15e3);
    request.on("response", (response) => {
      const file = fs.createWriteStream(dest);
      response.on("data", (chunk) => {
        file.write(chunk);
      });
      response.on("end", () => {
        file.end(() => {
          if (isSettled) return;
          isSettled = true;
          clearTimeout(timeout);
          resolve();
        });
      });
    });
    request.on("error", (err) => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timeout);
      reject(err);
    });
    request.end();
  });
}
async function downloadFileWithRetry(url, dest, taskId, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (activeDownloads[taskId]) throw new Error("CANCELED");
      await downloadSingleFile(url, dest, taskId);
      return;
    } catch (err) {
      if (err.message === "CANCELED" || activeDownloads[taskId]) {
        throw new Error("CANCELED");
      }
      if (attempt === retries) {
        throw new Error(`FAILED_AFTER_${retries}_RETRIES`);
      }
      console.warn(`分片下载失败 (尝试 ${attempt}/${retries})，1秒后重试...`);
      await new Promise((r) => setTimeout(r, 1e3));
    }
  }
}
function resolveUrl(baseUrl, relativeUrl) {
  try {
    return new URL(relativeUrl, baseUrl).href;
  } catch {
    return relativeUrl;
  }
}
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const url = details.url;
    if (url.startsWith("http")) {
      try {
        const urlObj = new URL(url);
        details.requestHeaders["Referer"] = urlObj.origin + "/";
        details.requestHeaders["Origin"] = urlObj.origin;
      } catch (e) {
      }
      details.requestHeaders["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    }
    callback({ requestHeaders: details.requestHeaders });
  });
  createWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
ipcMain.on("window-min", () => mainWindow == null ? void 0 : mainWindow.minimize());
ipcMain.on("window-max", () => {
  if (mainWindow == null ? void 0 : mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow == null ? void 0 : mainWindow.maximize();
});
ipcMain.on("window-close", () => mainWindow == null ? void 0 : mainWindow.close());
ipcMain.handle("http-request", async (_event, payload) => {
  const { url, method = "GET", headers = {} } = payload;
  return new Promise((resolve) => {
    const request = net.request({ url, method });
    const defaultHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
      ...headers
    };
    for (const [key, value] of Object.entries(defaultHeaders)) {
      request.setHeader(key, value);
    }
    let data = "";
    request.on("response", (response) => {
      response.on("data", (chunk) => {
        data += chunk.toString();
      });
      response.on("end", () => resolve({ ok: true, status: response.statusCode, data }));
    });
    request.on("error", (error) => resolve({ ok: false, error: error.message }));
    request.end();
  });
});
ipcMain.handle("parse-tvbox-config", async (_event, rawText) => {
  try {
    const config = parseTvboxJson(rawText);
    return { ok: true, config };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
});
ipcMain.on("cancel-download", (_event, taskId) => {
  activeDownloads[taskId] = true;
  if (activeRequests[taskId]) {
    activeRequests[taskId].abort();
  }
});
ipcMain.handle("download-episode", async (event, { url, filename, taskId }) => {
  try {
    activeDownloads[taskId] = false;
    const saveDir = path.join(app.getPath("downloads"), "TVBox_Downloads", filename.replace(/[\\/:*?"<>|]/g, "_"));
    if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });
    let m3u8Url = url;
    let content = await fetchText(m3u8Url);
    let lastUrl = content.trim().split("\n").filter(Boolean).slice(-1)[0] || "";
    if (lastUrl.includes(".m3u8") && lastUrl !== m3u8Url) {
      m3u8Url = resolveUrl(m3u8Url, lastUrl);
      content = await fetchText(m3u8Url);
    }
    let lines = content.trim().split("\n").filter(Boolean);
    if (content.includes("#EXT-X-DISCONTINUITY")) {
      const fpsCounts = { "24": 0, "25": 0, "30": 0, "60": 0 };
      let allDurs = [];
      for (let line of lines) {
        if (line.startsWith("#EXTINF:")) {
          const dur = parseFloat(line.split(":")[1].split(",")[0]);
          if (!isNaN(dur)) {
            allDurs.push(dur);
            for (let fps of [24, 25, 30, 60]) if (Math.abs(dur * fps - Math.round(dur * fps)) < 0.05) fpsCounts[fps]++;
          }
        }
      }
      let mainFps = 24, maxMatch = 0;
      for (let fps of [24, 25, 30, 60]) {
        if (fpsCounts[fps] > maxMatch) {
          maxMatch = fpsCounts[fps];
          mainFps = fps;
        }
      }
      const finalLines = [];
      let currentBlock = [];
      let isAd = false;
      const flush = () => {
        if (currentBlock.length > 0 && !isAd) finalLines.push(...currentBlock);
        currentBlock = [];
      };
      for (let line of lines) {
        const t = line.trim();
        if (t.startsWith("#EXTM3U") || t.startsWith("#EXT-X-VERSION") || t.startsWith("#EXT-X-TARGETDURATION") || t.startsWith("#EXT-X-MEDIA-SEQUENCE") || t.startsWith("#EXT-X-PLAYLIST-TYPE") || t.startsWith("#EXT-X-ENDLIST")) {
          finalLines.push(t);
          continue;
        }
        if (t.startsWith("#EXT-X-DISCONTINUITY")) {
          flush();
          currentBlock = [t];
          isAd = false;
          continue;
        }
        currentBlock.push(t);
        if (t.startsWith("#EXTINF:")) {
          const dur = parseFloat(t.split(":")[1].split(",")[0]);
          if (Math.abs(dur * mainFps - Math.round(dur * mainFps)) > 0.1) isAd = true;
        }
      }
      flush();
      lines = finalLines;
    }
    const tsList = [];
    const cleanM3u8Lines = [];
    for (let line of lines) {
      if (line.startsWith("#")) {
        cleanM3u8Lines.push(line);
      } else if (line.trim()) {
        const tsUrl = resolveUrl(m3u8Url, line.trim());
        tsList.push(tsUrl);
        cleanM3u8Lines.push(path.basename(new URL(tsUrl).pathname) || `${tsList.length}.ts`);
      }
    }
    let completed = 0;
    for (let i = 0; i < tsList.length; i++) {
      if (activeDownloads[taskId]) {
        fs.rmSync(saveDir, { recursive: true, force: true });
        return { ok: false, error: "CANCELED" };
      }
      const tsUrl = tsList[i];
      const dest = path.join(saveDir, path.basename(new URL(tsUrl).pathname) || `part${i}.ts`);
      if (!fs.existsSync(dest)) {
        try {
          await downloadFileWithRetry(tsUrl, dest, taskId);
        } catch (err) {
          if (err.message === "CANCELED" || activeDownloads[taskId]) return { ok: false, error: "CANCELED" };
          if (err.message.includes("FAILED_AFTER_")) {
            console.warn(`分片 ${tsUrl} 重试3次均失败，放弃此分片...`);
            continue;
          }
        }
      }
      completed++;
      event.sender.send("download-progress", { taskId, completed, total: tsList.length });
    }
    fs.writeFileSync(path.join(saveDir, "index.m3u8"), cleanM3u8Lines.join("\n"));
    return { ok: true, path: saveDir };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});
