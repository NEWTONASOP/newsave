const { app, BrowserWindow, ipcMain, dialog, Notification, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const { exec, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

let mainWindow;
const activeDownloads = new Map();

// Configure auto-updater
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

app.whenReady().then(() => {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        minWidth: 800,
        minHeight: 600,
        resizable: true,
        frame: false,
        backgroundColor: '#09090b',
        alwaysOnTop: false,
        icon: path.join(__dirname, 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    mainWindow.loadFile("index.html");

    // Open DevTools in development
    // mainWindow.webContents.openDevTools();

    setupIPCHandlers();
    setupAutoUpdater();
});

function setupIPCHandlers() {
    // Window controls
    ipcMain.on("close-app", () => {
        // Cancel all active downloads before closing
        activeDownloads.forEach((process, id) => {
            try {
                process.kill();
            } catch (e) {
                console.error('Error killing process:', e);
            }
        });
        if (mainWindow) mainWindow.close();
    });

    ipcMain.on("minimize-app", () => {
        if (mainWindow) mainWindow.minimize();
    });

    // Directory selection
    ipcMain.on("select-directory", async (event) => {
        const result = await dialog.showOpenDialog(mainWindow, {
            properties: ['openDirectory'],
            title: 'Select Download Folder'
        });

        if (!result.canceled && result.filePaths.length > 0) {
            event.reply("selected-directory", result.filePaths[0]);
        }
    });

    // Get video info
    ipcMain.handle("get-video-info", async (event, url) => {
        try {
            return await getVideoInfo(url);
        } catch (error) {
            console.error('Failed to get video info:', error);
            return null;
        }
    });

    // Search YouTube
    ipcMain.handle("search-youtube", async (event, query) => {
        try {
            return await searchYouTube(query);
        } catch (error) {
            console.error('Search failed:', error);
            return [];
        }
    });

    // Download media (new unified handler)
    ipcMain.on("download-media", async (event, options) => {
        try {
            await downloadMedia(event, options);
        } catch (error) {
            event.reply("download-error", {
                id: options.id,
                error: error.message
            });
        }
    });

    // Cancel download
    ipcMain.on("cancel-download", (event, id) => {
        const proc = activeDownloads.get(id);
        if (proc) {
            try {
                proc.kill('SIGTERM');
                activeDownloads.delete(id);
                console.log(`Cancelled download: ${id}`);
            } catch (e) {
                console.error('Error cancelling download:', e);
            }
        }
    });

    // Open file location
    ipcMain.on("open-file-location", (event, filePath) => {
        if (filePath && fs.existsSync(filePath)) {
            shell.showItemInFolder(filePath);
        } else if (filePath) {
            // Try to open the directory
            const dir = path.dirname(filePath);
            if (fs.existsSync(dir)) {
                shell.openPath(dir);
            }
        }
    });

    // Open file directly
    ipcMain.on("open-file", (event, filePath) => {
        if (filePath && fs.existsSync(filePath)) {
            shell.openPath(filePath);
        }
    });

    // Delete file
    ipcMain.handle("delete-file", async (event, filePath) => {
        try {
            if (filePath && fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                return { success: true };
            }
            return { success: false, error: 'File not found' };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Check if file exists
    ipcMain.handle("file-exists", async (event, filePath) => {
        try {
            return filePath && fs.existsSync(filePath);
        } catch (error) {
            return false;
        }
    });

    // Legacy download handler (for backward compatibility)
    ipcMain.on("download-mp3", async (event, url) => {
        if (!url || typeof url !== 'string') {
            event.reply("download-status", "Invalid URL");
            return;
        }

        const sanitizedUrl = url.trim();
        event.reply("download-status", "Started...");

        try {
            const info = await getVideoInfo(sanitizedUrl);
            const videoTitle = sanitizeFilename(info.title);

            const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
                title: "Save MP3",
                defaultPath: `${videoTitle}.mp3`,
                filters: [{ name: "MP3 Files", extensions: ["mp3"] }]
            });

            if (canceled || !filePath) {
                event.reply("download-status", "Cancelled");
                return;
            }

            await downloadFile(sanitizedUrl, filePath, 'audio', 'mp3', 'best', (progress) => {
                // Progress updates
            });

            event.reply("download-status", "Complete ✅");
        } catch (error) {
            console.error('Download error:', error);
            event.reply("download-status", "Error: " + error.message);
        }
    });

    // Auto-updater IPC handlers
    ipcMain.on("check-for-updates", () => {
        autoUpdater.checkForUpdates();
    });

    ipcMain.on("download-update", () => {
        autoUpdater.downloadUpdate();
    });

    ipcMain.on("install-update", () => {
        autoUpdater.quitAndInstall();
    });
}

// Get video information
async function getVideoInfo(url) {
    return new Promise((resolve, reject) => {
        const ytDlpPath = getYtDlpPath();
        const command = `"${ytDlpPath}" --dump-json --no-playlist "${url}"`;

        exec(command, { timeout: 30000, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
            if (error) {
                console.error('yt-dlp error:', stderr);
                reject(new Error('Failed to fetch video info'));
                return;
            }

            try {
                const info = JSON.parse(stdout);
                resolve({
                    title: info.title || 'Unknown',
                    duration: info.duration || 0,
                    thumbnail: info.thumbnail || '',
                    channel: info.uploader || 'Unknown',
                    url: url,
                    isPlaylist: info._type === 'playlist'
                });
            } catch (err) {
                reject(new Error('Failed to parse video info'));
            }
        });
    });
}

// Search YouTube
async function searchYouTube(query) {
    return new Promise((resolve, reject) => {
        const ytDlpPath = getYtDlpPath();
        const command = `"${ytDlpPath}" "ytsearch5:${query}" --dump-json --no-playlist --flat-playlist`;

        exec(command, { timeout: 30000, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error('Search failed'));
                return;
            }

            try {
                const lines = stdout.trim().split('\n');
                console.log('Search raw output lines:', lines.length);
                const results = lines.map(line => {
                    try {
                        const info = JSON.parse(line);
                        // console.log('Search result item:', JSON.stringify(info, null, 2)); // Debug single item

                        let thumb = info.thumbnail;
                        if (!thumb && info.thumbnails && info.thumbnails.length > 0) {
                            // Get the best quality thumbnail (usually the last one)
                            thumb = info.thumbnails[info.thumbnails.length - 1].url;
                        }

                        return {
                            title: info.title,
                            url: info.webpage_url || info.url,
                            thumbnail: thumb,
                            duration: formatDuration(info.duration),
                            channel: info.uploader || info.channel
                        };
                    } catch (e) {
                        console.error('Failed to parse search line', e);
                        return null;
                    }
                }).filter(r => r !== null);
                resolve(results);
            } catch (err) {
                reject(new Error('Failed to parse search results'));
            }
        });
    });
}

// Download media (audio or video)
async function downloadMedia(event, options) {
    const { id, url, type, format, quality, path: downloadPath } = options;

    try {
        // Get video info first
        let info;
        try {
            info = await getVideoInfo(url);
        } catch (e) {
            info = { title: 'download_' + Date.now() };
        }

        const filename = sanitizeFilename(info.title);

        // Determine output path
        let outputPath;
        if (downloadPath) {
            const ext = format || (type === 'video' ? 'mp4' : 'mp3');
            outputPath = path.join(downloadPath, `${filename}.${ext}`);
        } else {
            const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
                title: `Save ${type === 'video' ? 'Video' : 'Audio'}`,
                defaultPath: `${filename}.${format || (type === 'video' ? 'mp4' : 'mp3')}`,
                filters: [{
                    name: type === 'video' ? 'Video Files' : 'Audio Files',
                    extensions: [format || (type === 'video' ? 'mp4' : 'mp3')]
                }]
            });

            if (canceled || !filePath) {
                event.reply("download-error", { id, error: "Cancelled" });
                return;
            }
            outputPath = filePath;
        }

        // Check if it's a playlist
        const isPlaylist = url.includes('playlist') || type === 'playlist';

        if (isPlaylist) {
            await downloadPlaylist(event, id, url, outputPath, format, quality, type);
        } else {
            await downloadFile(url, outputPath, type, format, quality, (progress) => {
                event.reply("download-progress", { id, progress });
            }, id);
        }

        event.reply("download-complete", {
            id,
            title: info.title,
            path: outputPath
        });

    } catch (error) {
        console.error('Download error:', error);
        event.reply("download-error", { id, error: error.message });
    }
}

// Download single file
function downloadFile(url, outputPath, type, format, quality, onProgress, downloadId) {
    return new Promise((resolve, reject) => {
        const ytDlpPath = getYtDlpPath();
        let args = [];

        if (type === 'video') {
            // Video download
            const qualityArg = quality === 'best' ? 'bestvideo+bestaudio/best' : `bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]`;
            args = ['-f', qualityArg, '--merge-output-format', format || 'mp4', '--newline', '-o', outputPath, url];
        } else {
            // Audio download
            const qualityArg = quality === 'best' ? '0' : quality;
            args = ['-x', '--audio-format', format || 'mp3', '--audio-quality', qualityArg, '--newline', '-o', outputPath, url];
        }

        const proc = spawn(ytDlpPath, args, { shell: false });

        // Store process for potential cancellation
        if (downloadId) {
            activeDownloads.set(downloadId, proc);
        }

        proc.stdout.on('data', (data) => {
            const output = data.toString();
            const lines = output.split('\n');

            lines.forEach(line => {
                // Improved progress regex to catch [download]  12.3% of 100MiB...
                const match = line.match(/\[download\]\s+(\d+\.?\d*)%/);
                if (match && onProgress) {
                    onProgress(parseFloat(match[1]));
                }
            });
        });

        proc.stderr.on('data', (data) => {
            const output = data.toString();
            const lines = output.split('\n');

            lines.forEach(line => {
                const match = line.match(/\[download\]\s+(\d+\.?\d*)%/);
                if (match && onProgress) {
                    onProgress(parseFloat(match[1]));
                }
            });
        });

        proc.on('close', (code) => {
            if (downloadId) {
                activeDownloads.delete(downloadId);
            }

            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Download failed with code ${code}`));
            }
        });

        proc.on('error', (error) => {
            if (downloadId) {
                activeDownloads.delete(downloadId);
            }
            reject(error);
        });
    });
}

// Download playlist
async function downloadPlaylist(event, id, url, outputDir, format, quality, type) {
    return new Promise((resolve, reject) => {
        const ytDlpPath = getYtDlpPath();
        const dir = path.dirname(outputDir);
        const template = path.join(dir, '%(title)s.%(ext)s');

        let args = [];
        if (type === 'video') {
            args = ['-f', 'bestvideo+bestaudio/best', '--merge-output-format', format || 'mp4', '-o', template, url];
        } else {
            const qualityArg = quality === 'best' ? '0' : quality;
            args = ['-x', '--audio-format', format || 'mp3', '--audio-quality', qualityArg, '-o', template, url];
        }

        const proc = spawn(ytDlpPath, args, { shell: false });

        activeDownloads.set(id, proc);

        proc.stdout.on('data', (data) => {
            console.log('Playlist download:', data.toString());
        });

        proc.stderr.on('data', (data) => {
            console.error('Playlist error:', data.toString());
        });

        proc.on('close', (code) => {
            activeDownloads.delete(id);
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Playlist download failed with code ${code}`));
            }
        });

        proc.on('error', (error) => {
            activeDownloads.delete(id);
            reject(error);
        });
    });
}

// Get yt-dlp path
function getYtDlpPath() {
    // Check if bundled yt-dlp exists
    const bundledPath = path.join(__dirname, 'yt-dlp.exe');
    if (fs.existsSync(bundledPath)) {
        return bundledPath;
    }
    // Fallback to system yt-dlp
    return 'yt-dlp';
}

// Utility functions
function sanitizeFilename(filename) {
    if (!filename) return 'download';
    return filename
        .replace(/[/\\?%*:|"<>]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 200);
}

function formatDuration(seconds) {
    if (!seconds) return '0:00';
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
        return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Auto-updater setup
function setupAutoUpdater() {
    // Check for updates on startup (after 3 seconds)
    setTimeout(() => {
        autoUpdater.checkForUpdates();
    }, 3000);

    // Update available
    autoUpdater.on('update-available', (info) => {
        console.log('Update available:', info.version);
        mainWindow.webContents.send('update-available', {
            version: info.version,
            releaseDate: info.releaseDate,
            releaseNotes: info.releaseNotes
        });
    });

    // Update not available
    autoUpdater.on('update-not-available', (info) => {
        console.log('Update not available');
        mainWindow.webContents.send('update-not-available');
    });

    // Update download progress
    autoUpdater.on('download-progress', (progressObj) => {
        console.log(`Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent}%`);
        mainWindow.webContents.send('update-download-progress', {
            percent: progressObj.percent,
            transferred: progressObj.transferred,
            total: progressObj.total,
            bytesPerSecond: progressObj.bytesPerSecond
        });
    });

    // Update downloaded
    autoUpdater.on('update-downloaded', (info) => {
        console.log('Update downloaded');
        mainWindow.webContents.send('update-downloaded', {
            version: info.version
        });
    });

    // Error handling
    autoUpdater.on('error', (err) => {
        console.error('Update error:', err);
        mainWindow.webContents.send('update-error', {
            message: err.message
        });
    });

    // Checking for update
    autoUpdater.on('checking-for-update', () => {
        console.log('Checking for updates...');
        mainWindow.webContents.send('checking-for-update');
    });
}

app.on('window-all-closed', () => {
    // Cancel all active downloads
    activeDownloads.forEach((process, id) => {
        try {
            process.kill();
        } catch (e) {
            console.error('Error killing process:', e);
        }
    });

    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        // Recreate window if needed (macOS)
    }
});
