const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
    // Window controls
    closeApp: () => ipcRenderer.send("close-app"),
    minimizeApp: () => ipcRenderer.send("minimize-app"),

    // Download functionality
    downloadMP3: (url) => ipcRenderer.send("download-mp3", url),
    downloadMedia: (options) => ipcRenderer.send("download-media", options),
    cancelDownload: (id) => ipcRenderer.send("cancel-download", id),

    // Download events
    onDownloadStatus: (callback) => ipcRenderer.on("download-status", (event, status) => callback(status)),
    onDownloadProgress: (callback) => ipcRenderer.on("download-progress", (event, data) => callback(data)),
    onDownloadComplete: (callback) => ipcRenderer.on("download-complete", (event, data) => callback(data)),
    onDownloadError: (callback) => ipcRenderer.on("download-error", (event, data) => callback(data)),

    // Video info
    getVideoInfo: (url) => ipcRenderer.invoke("get-video-info", url),
    searchYouTube: (query) => ipcRenderer.invoke("search-youtube", query),

    // Directory/File operations
    selectDirectory: () => ipcRenderer.send("select-directory"),
    onDirectorySelected: (callback) => ipcRenderer.on("selected-directory", callback),
    openFileLocation: (filePath) => ipcRenderer.send("open-file-location", filePath),
    openFile: (filePath) => ipcRenderer.send("open-file", filePath),
    deleteFile: (filePath) => ipcRenderer.invoke("delete-file", filePath),
    fileExists: (filePath) => ipcRenderer.invoke("file-exists", filePath),

    // Auto-updater
    checkForUpdates: () => ipcRenderer.send("check-for-updates"),
    downloadUpdate: () => ipcRenderer.send("download-update"),
    installUpdate: () => ipcRenderer.send("install-update"),
    onCheckingForUpdate: (callback) => ipcRenderer.on("checking-for-update", callback),
    onUpdateAvailable: (callback) => ipcRenderer.on("update-available", (event, info) => callback(info)),
    onUpdateNotAvailable: (callback) => ipcRenderer.on("update-not-available", callback),
    onUpdateDownloadProgress: (callback) => ipcRenderer.on("update-download-progress", (event, progress) => callback(progress)),
    onUpdateDownloaded: (callback) => ipcRenderer.on("update-downloaded", (event, info) => callback(info)),
    onUpdateError: (callback) => ipcRenderer.on("update-error", (event, error) => callback(error)),

    // Remove listeners
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),

    // App info
    getVersion: () => ipcRenderer.invoke("get-version")
});
