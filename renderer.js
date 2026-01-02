// ==================== STATE MANAGEMENT ====================
const state = {
    queue: [],
    history: [],
    settings: {
        theme: 'dark',
        notifications: true,
        keepHistory: true,
        autoPaste: true,
        maxConcurrent: 3
    },
    activeDownloads: 0,
    currentDownloadPath: null,
    lastPastedUrl: '',
    downloadPaths: new Map() // Store paths for completed downloads
};

// ==================== DOM ELEMENTS ====================
let elements = {};

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
    try {
        console.log('DOM loaded, initializing NewSave...');

        initializeElements();
        loadSettings();
        loadHistory();
        setupEventListeners();
        setupKeyboardShortcuts();
        setupDragAndDrop();
        updateUI();

        // Request notification permission
        requestNotificationPermission();

        console.log('✅ NewSave initialized successfully');
    } catch (error) {
        console.error('❌ Initialization error:', error);
        showToast('Error', 'Failed to initialize app', 'error');
    }
});

function initializeElements() {
    elements = {
        // Inputs
        urlInput: document.getElementById('url'),
        downloadBtn: document.getElementById('download'),
        statusEl: document.getElementById('status'),
        pasteBtn: document.getElementById('paste-btn'),
        selectFolderBtn: document.getElementById('select-folder-btn'),

        // Selects
        formatSelect: document.getElementById('format'),
        qualitySelect: document.getElementById('quality'),
        videoFormatSelect: document.getElementById('video-format'),
        videoQualitySelect: document.getElementById('video-quality'),

        // Type radios
        downloadTypeRadios: document.querySelectorAll('input[name="download-type"]'),

        // Tabs
        tabBtns: document.querySelectorAll('.nav-item'),
        tabContents: document.querySelectorAll('.tab-content'),

        // Lists
        queueList: document.getElementById('queue-list'),
        historyList: document.getElementById('download-history'),

        // Badges
        queueBadge: document.getElementById('queue-badge'),
        playlistBadge: document.getElementById('playlist-badge'),

        // Buttons
        settingsBtn: document.getElementById('settings-btn'),
        clearCompleted: document.getElementById('clear-completed'),
        clearHistory: document.getElementById('clear-history'),

        // Modal
        settingsModal: document.getElementById('settings-modal'),
        closeSettings: document.getElementById('close-settings'),

        // Preview
        videoPreview: document.getElementById('video-preview'),
        thumbnail: document.getElementById('thumbnail'),
        videoTitle: document.getElementById('video-title'),
        videoDuration: document.getElementById('video-duration'),

        // Search
        searchResults: document.getElementById('search-results'),

        // Options
        audioOptions: document.getElementById('audio-options'),
        videoOptions: document.getElementById('video-options'),

        // Path
        selectedPath: document.getElementById('selected-path'),

        // Loading
        downloadText: document.getElementById('download-text'),
        loadingSpinner: document.getElementById('loading-spinner'),

        // Drop zone
        dropZone: document.getElementById('drop-zone'),
        inputSection: document.getElementById('input-section'),

        // Toast
        toastContainer: document.getElementById('toast-container')
    };
}

// ==================== SETTINGS ====================
function loadSettings() {
    try {
        const saved = localStorage.getItem('newsave_settings');
        if (saved) {
            state.settings = { ...state.settings, ...JSON.parse(saved) };
        }
        applySettings();
    } catch (err) {
        console.error('Failed to load settings:', err);
    }
}

function saveSettings() {
    try {
        localStorage.setItem('newsave_settings', JSON.stringify(state.settings));
    } catch (err) {
        console.error('Failed to save settings:', err);
    }
}

function applySettings() {
    // Apply theme
    document.body.setAttribute('data-theme', state.settings.theme);

    // Update theme buttons
    document.querySelectorAll('.theme-opt').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === state.settings.theme);
    });

    // Update settings checkboxes
    const settingsMap = {
        'notifications': 'notifications',
        'keep-history': 'keepHistory',
        'auto-paste': 'autoPaste',
        'max-concurrent': 'maxConcurrent'
    };

    Object.entries(settingsMap).forEach(([id, key]) => {
        const el = document.getElementById(id);
        if (el) {
            if (el.type === 'checkbox') {
                el.checked = state.settings[key];
            } else {
                el.value = state.settings[key];
            }
        }
    });
}

// ==================== HISTORY ====================
function loadHistory() {
    try {
        const saved = localStorage.getItem('newsave_history');
        if (saved) {
            state.history = JSON.parse(saved);
        }
    } catch (err) {
        console.error('Failed to load history:', err);
        state.history = [];
    }
}

function saveHistory() {
    if (!state.settings.keepHistory) return;
    try {
        localStorage.setItem('newsave_history', JSON.stringify(state.history));
    } catch (err) {
        console.error('Failed to save history:', err);
    }
}

function addToHistory(item, filePath) {
    const historyItem = {
        ...item,
        date: new Date().toISOString(),
        historyId: Date.now(),
        filePath: filePath || null
    };
    state.history.unshift(historyItem);
    if (state.history.length > 100) state.history.pop();
    saveHistory();
    updateHistoryUI();
}

// ==================== QUEUE MANAGEMENT ====================
function addToQueue(item) {
    const queueItem = {
        id: Date.now(),
        url: item.url,
        title: item.title || 'Unknown',
        type: item.type || 'audio',
        format: item.format,
        quality: item.quality,
        status: 'pending',
        progress: 0,
        error: null,
        retryCount: 0,
        isPlaylist: item.isPlaylist || false,
        filePath: null
    };

    state.queue.push(queueItem);
    updateQueueUI();
    processQueue();

    // Auto-switch to downloads tab
    switchTab('queue');

    showToast('Download Started', truncateText(queueItem.title, 40), 'info');
}

function removeFromQueue(id) {
    state.queue = state.queue.filter(item => item.id !== id);
    updateQueueUI();
}

function updateQueueItem(id, updates) {
    const item = state.queue.find(q => q.id === id);
    if (item) {
        Object.assign(item, updates);
        updateQueueUI();
    }
}

async function processQueue() {
    const pending = state.queue.filter(q => q.status === 'pending');
    const canStart = state.settings.maxConcurrent - state.activeDownloads;

    for (let i = 0; i < Math.min(canStart, pending.length); i++) {
        startDownload(pending[i]);
    }
}

async function startDownload(item) {
    if (state.activeDownloads >= state.settings.maxConcurrent) return;

    state.activeDownloads++;
    updateQueueItem(item.id, { status: 'downloading', progress: 0 });

    try {
        await window.electron.downloadMedia({
            id: item.id,
            url: item.url,
            type: item.type,
            format: item.format,
            quality: item.quality,
            path: state.currentDownloadPath
        });
    } catch (error) {
        handleDownloadError(item, error);
    }
}

function cancelDownload(id) {
    const item = state.queue.find(q => q.id === id);
    if (item && (item.status === 'downloading' || item.status === 'pending')) {
        // Send cancel signal to main process
        if (window.electron.cancelDownload) {
            window.electron.cancelDownload(id);
        }
        updateQueueItem(id, { status: 'cancelled', error: 'Cancelled by user' });
        state.activeDownloads--;
        processQueue();
        showToast('Cancelled', 'Download cancelled', 'info');
    }
}

function handleDownloadError(item, error) {
    if (item.retryCount < 3) {
        updateQueueItem(item.id, {
            status: 'pending',
            retryCount: item.retryCount + 1,
            error: error.message
        });
        setTimeout(() => processQueue(), 2000);
    } else {
        updateQueueItem(item.id, {
            status: 'failed',
            error: error.message
        });
        state.activeDownloads--;
        processQueue();
        showToast('Download Failed', truncateText(item.title, 30), 'error');
    }
}

function retryDownload(id) {
    const item = state.queue.find(q => q.id === id);
    if (item) {
        updateQueueItem(id, { status: 'pending', retryCount: 0, error: null });
        processQueue();
    }
}

function clearCompleted() {
    state.queue = state.queue.filter(q =>
        q.status !== 'completed' &&
        q.status !== 'failed' &&
        q.status !== 'cancelled'
    );
    updateQueueUI();
    showToast('Cleared', 'Completed downloads cleared', 'success');
}

function openFileLocation(id) {
    console.log('openFileLocation called with id:', id);
    const path = state.downloadPaths.get(id);
    console.log('Retrieved path:', path);
    console.log('All paths:', Array.from(state.downloadPaths.entries()));

    if (!path) {
        showToast('Error', 'File path not found', 'error');
        console.error('No path found for id:', id);
        return;
    }

    if (!window.electron.openFileLocation) {
        showToast('Error', 'Function not available', 'error');
        console.error('window.electron.openFileLocation not available');
        return;
    }

    try {
        window.electron.openFileLocation(path);
        console.log('Called openFileLocation with path:', path);
    } catch (error) {
        console.error('Error calling openFileLocation:', error);
        showToast('Error', 'Failed to open folder', 'error');
    }
}

function openFile(id) {
    console.log('openFile called with id:', id);
    const path = state.downloadPaths.get(id);
    console.log('Retrieved path:', path);

    if (!path) {
        showToast('Error', 'File path not found', 'error');
        console.error('No path found for id:', id);
        return;
    }

    if (!window.electron.openFile) {
        showToast('Error', 'Function not available', 'error');
        console.error('window.electron.openFile not available');
        return;
    }

    try {
        window.electron.openFile(path);
        console.log('Called openFile with path:', path);
    } catch (error) {
        console.error('Error calling openFile:', error);
        showToast('Error', 'Failed to open file', 'error');
    }
}

async function deleteFile(id) {
    console.log('deleteFile called with id:', id);
    const item = state.queue.find(q => q.id === id);
    const path = state.downloadPaths.get(id);

    console.log('Item:', item);
    console.log('Path:', path);

    if (!path) {
        showToast('Error', 'File path not found', 'error');
        console.error('No path found for id:', id);
        return;
    }

    const confirmDelete = confirm(`Delete "${item?.title || 'this file'}"?\n\nThis action cannot be undone.`);
    if (!confirmDelete) {
        console.log('Delete cancelled by user');
        return;
    }

    try {
        console.log('Calling deleteFile with path:', path);
        const result = await window.electron.deleteFile(path);
        console.log('Delete result:', result);

        if (result.success) {
            state.downloadPaths.delete(id);
            removeFromQueue(id);
            showToast('Deleted', 'File deleted successfully', 'success');
        } else {
            showToast('Error', result.error || 'Failed to delete file', 'error');
        }
    } catch (error) {
        console.error('Error in deleteFile:', error);
        showToast('Error', 'Failed to delete file', 'error');
    }
}

// ==================== UI UPDATES ====================
function updateUI() {
    updateQueueUI();
    updateHistoryUI();
}

function updateQueueUI() {
    if (!elements.queueList) return;

    const activeCount = state.queue.filter(q =>
        q.status === 'pending' || q.status === 'downloading'
    ).length;

    if (elements.queueBadge) {
        elements.queueBadge.textContent = activeCount;
        elements.queueBadge.style.display = activeCount > 0 ? 'inline-flex' : 'none';
    }

    if (state.queue.length === 0) {
        elements.queueList.innerHTML = `
            <div class="empty-state">
                <i data-lucide="inbox"></i>
                <p>No active downloads</p>
            </div>
        `;
        return;
    }

    elements.queueList.innerHTML = state.queue.map(item => `
        <div class="queue-item ${item.status}" data-id="${item.id}">
            <div class="queue-item-header">
                <span class="queue-title">${escapeHtml(item.title)}</span>
                <div class="queue-meta">
                    <span class="badge secondary">${item.format.toUpperCase()}</span>
                </div>
            </div>
            
            ${item.status === 'downloading' || item.status === 'pending' ? `
                <div class="queue-progress-container">
                    <div class="progress-bar-container">
                        <div class="progress-fill" style="width: ${item.progress}%"></div>
                    </div>
                    <div class="progress-stats">
                        <span class="progress-percent">${item.progress}%</span>
                        <span class="status-badge">${item.status}</span>
                    </div>
                </div>
            ` : ''}

            ${item.status === 'completed' ? `
                <div class="queue-status-text success">
                    <i data-lucide="check-circle"></i> Download Complete
                </div>
            ` : ''}

            ${item.error && item.status === 'failed' ? `
                <div class="queue-status-text error">
                    <i data-lucide="alert-circle"></i> ${escapeHtml(item.error)}
                </div>
            ` : ''}

            <div class="queue-actions">
                ${item.status === 'downloading' ? `
                    <button class="ghost-btn sm danger" onclick="cancelDownload(${item.id})" title="Cancel download">
                        <i data-lucide="square"></i> Stop
                    </button>
                ` : ''}
                ${item.status === 'failed' ? `
                    <button class="ghost-btn sm primary" onclick="retryDownload(${item.id})" title="Retry download">
                        <i data-lucide="refresh-cw"></i> Retry
                    </button>
                ` : ''}
                ${item.status === 'completed' ? `
                    ${state.downloadPaths.has(item.id) ? `
                        <button class="ghost-btn sm primary" onclick="openFile(${item.id})" title="Open file">
                            <i data-lucide="play"></i> Open
                        </button>
                        <button class="ghost-btn sm" onclick="openFileLocation(${item.id})" title="Show in folder">
                            <i data-lucide="folder-open"></i> Folder
                        </button>
                        <button class="ghost-btn sm danger" onclick="deleteFile(${item.id})" title="Delete file">
                            <i data-lucide="trash-2"></i> Delete
                        </button>
                    ` : `
                        <span class="text-muted" style="font-size: 0.8rem;">File location unavailable</span>
                    `}
                    <button class="ghost-btn sm" onclick="removeFromQueue(${item.id})" title="Remove from list">
                        <i data-lucide="x"></i> Remove
                    </button>
                ` : ''}
                ${item.status !== 'downloading' && item.status !== 'completed' ? `
                    <button class="ghost-btn sm" onclick="removeFromQueue(${item.id})" title="Remove from list">
                        <i data-lucide="x"></i> Remove
                    </button>
                ` : ''}
            </div>
        </div>
    `).join('');

    // Re-initialize icons
    if (window.lucide) window.lucide.createIcons();
}

async function updateHistoryUI() {
    if (!elements.historyList) return;

    if (state.history.length === 0) {
        elements.historyList.innerHTML = `
            <div class="empty-state">
                <i data-lucide="folder-open"></i>
                <p>No downloads yet</p>
            </div>
        `;
        return;
    }

    // Check file existence for all items
    const itemsWithFileStatus = await Promise.all(
        state.history.map(async (item) => {
            const hasFile = item.filePath ? await window.electron.fileExists(item.filePath) : false;
            return { ...item, hasFile };
        })
    );

    elements.historyList.innerHTML = itemsWithFileStatus.map(item => {
        const date = new Date(item.date);
        const formattedDate = date.toLocaleDateString('en-US', {
            month: 'short', day: 'numeric'
        });

        return `
            <div class="queue-item history" data-history-id="${item.historyId}">
                <div class="queue-item-header">
                    <div style="display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1;">
                        <i data-lucide="${item.type === 'video' ? 'video' : 'music'}"></i>
                        <span class="queue-title">${escapeHtml(item.title)}</span>
                    </div>
                    <div class="queue-meta">
                        <span class="badge secondary">${item.format.toUpperCase()}</span>
                        <span style="font-size: 0.8rem; color: var(--text-muted)">${formattedDate}</span>
                    </div>
                </div>
                
                <div class="queue-actions">
                    ${item.hasFile ? `
                        <button class="ghost-btn sm primary history-open-btn" data-file-path="${escapeHtml(item.filePath)}" title="Open file">
                            <i data-lucide="play"></i> Open
                        </button>
                        <button class="ghost-btn sm history-folder-btn" data-file-path="${escapeHtml(item.filePath)}" title="Show in folder">
                            <i data-lucide="folder-open"></i> Folder
                        </button>
                        <button class="ghost-btn sm danger history-delete-btn" data-file-path="${escapeHtml(item.filePath)}" title="Delete file">
                            <i data-lucide="trash-2"></i> Delete
                        </button>
                    ` : `
                        <button class="ghost-btn sm history-redownload-btn" data-url="${escapeHtml(item.url)}" title="Download again">
                            <i data-lucide="download"></i> Re-download
                        </button>
                    `}
                    <button class="ghost-btn sm history-remove-btn" title="Remove from history">
                        <i data-lucide="x"></i> Remove
                    </button>
                </div>
            </div>
        `;
    }).join('');

    // Re-initialize icons
    if (window.lucide) window.lucide.createIcons();

    // Add event listeners to history buttons
    elements.historyList.querySelectorAll('.history-open-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const filePath = btn.dataset.filePath;
            openHistoryFile(filePath);
        });
    });

    elements.historyList.querySelectorAll('.history-folder-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const filePath = btn.dataset.filePath;
            openHistoryFileLocation(filePath);
        });
    });

    elements.historyList.querySelectorAll('.history-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const historyId = parseInt(btn.closest('[data-history-id]').dataset.historyId);
            const filePath = btn.dataset.filePath;
            deleteHistoryFile(historyId, filePath);
        });
    });

    elements.historyList.querySelectorAll('.history-redownload-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const url = btn.dataset.url;
            redownloadFromHistory(url);
        });
    });

    elements.historyList.querySelectorAll('.history-remove-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const historyId = parseInt(btn.closest('[data-history-id]').dataset.historyId);
            removeFromHistory(historyId);
        });
    });
}


function getStatusIcon(status) {
    const icons = {
        pending: '⏳',
        downloading: '⬇️',
        completed: '✅',
        failed: '❌',
        cancelled: '⏹️'
    };
    return icons[status] || '❓';
}

// ==================== VIDEO PREVIEW ====================
async function fetchVideoInfo(url) {
    try {
        showStatus('Fetching video info...', 'info');
        setButtonLoading(true);

        const info = await window.electron.getVideoInfo(url);

        if (info) {
            displayVideoPreview(info);
            showStatus('', '');
            return info;
        } else {
            showStatus('Could not fetch video info', 'error');
        }
    } catch (error) {
        console.error('Failed to fetch video info:', error);
        showStatus('Failed to fetch video info', 'error');
    } finally {
        setButtonLoading(false);
    }
    return null;
}

function displayVideoPreview(info) {
    if (!elements.videoPreview) return;

    elements.videoPreview.style.display = 'flex';
    if (elements.thumbnail) elements.thumbnail.src = info.thumbnail || '';
    if (elements.videoTitle) elements.videoTitle.textContent = info.title || 'Unknown';
    if (elements.videoDuration) elements.videoDuration.textContent = `Duration: ${formatDuration(info.duration)}`;

    // Show playlist badge if it's a playlist
    const isPlaylist = info.isPlaylist ||
        info.url?.includes('playlist') ||
        elements.urlInput?.value?.includes('playlist');

    if (elements.playlistBadge) {
        elements.playlistBadge.style.display = isPlaylist ? 'inline-flex' : 'none';
    }
}

function hideVideoPreview() {
    if (elements.videoPreview) {
        elements.videoPreview.style.display = 'none';
    }
    if (elements.playlistBadge) {
        elements.playlistBadge.style.display = 'none';
    }
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

// ==================== EVENT LISTENERS ====================
function setupEventListeners() {
    // Download button
    if (elements.downloadBtn) {
        elements.downloadBtn.addEventListener('click', handleDownload);
    }

    // Paste button
    if (elements.pasteBtn) {
        elements.pasteBtn.addEventListener('click', pasteFromClipboard);
    }

    // Select folder button
    if (elements.selectFolderBtn) {
        elements.selectFolderBtn.addEventListener('click', selectDownloadLocation);
    }

    // URL input
    if (elements.urlInput) {
        elements.urlInput.addEventListener('input', debounce(handleUrlInput, 500));
        elements.urlInput.addEventListener('paste', () => {
            setTimeout(() => handleUrlInput(), 100);
        });
    }

    // Download type radios
    elements.downloadTypeRadios.forEach(radio => {
        radio.addEventListener('change', handleTypeChange);
    });

    // Tabs
    elements.tabBtns.forEach(btn => {
        if (btn.id === 'settings-btn') return; // Handled separately
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Settings
    if (elements.settingsBtn) {
        elements.settingsBtn.addEventListener('click', openSettings);
    }
    if (elements.closeSettings) {
        elements.closeSettings.addEventListener('click', closeSettings);
    }

    // Click outside modal to close
    if (elements.settingsModal) {
        elements.settingsModal.addEventListener('click', (e) => {
            if (e.target === elements.settingsModal) {
                closeSettings();
            }
        });
    }

    // Theme buttons
    document.querySelectorAll('.theme-opt').forEach(btn => {
        btn.addEventListener('click', () => {
            state.settings.theme = btn.dataset.theme;
            saveSettings();
            applySettings();
        });
    });

    // Settings inputs
    const settingsInputs = ['notifications', 'keep-history', 'auto-paste', 'max-concurrent'];
    settingsInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', () => {
                const key = id.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
                state.settings[key] = el.type === 'checkbox' ? el.checked : parseInt(el.value);
                saveSettings();
            });
        }
    });

    // Clear buttons
    if (elements.clearCompleted) {
        elements.clearCompleted.addEventListener('click', clearCompleted);
    }
    if (elements.clearHistory) {
        elements.clearHistory.addEventListener('click', () => {
            if (confirm('Clear all download history?')) {
                state.history = [];
                saveHistory();
                updateHistoryUI();
                showToast('Cleared', 'History cleared', 'success');
            }
        });
    }

    // Window focus for auto-paste
    window.addEventListener('focus', handleWindowFocus);

    // IPC listeners
    setupIPCListeners();
}

function setupIPCListeners() {
    if (!window.electron) {
        console.error('window.electron is not available!');
        return;
    }

    window.electron.onDownloadProgress((data) => {
        updateQueueItem(data.id, {
            progress: Math.round(data.progress),
            status: 'downloading'
        });
    });

    window.electron.onDownloadComplete((data) => {
        console.log('Download complete:', data);

        updateQueueItem(data.id, {
            status: 'completed',
            progress: 100
        });

        // Store file path for "Open Location" button
        if (data.path) {
            state.downloadPaths.set(data.id, data.path);
            console.log('Stored path for ID', data.id, ':', data.path);
            console.log('Total paths stored:', state.downloadPaths.size);
            // Force UI update to show buttons
            updateQueueUI();
        } else {
            console.warn('No path provided for download ID:', data.id);
        }

        const item = state.queue.find(q => q.id === data.id);
        if (item) {
            addToHistory(item, data.path);
        }

        state.activeDownloads--;
        processQueue();

        if (state.settings.notifications) {
            showDownloadCompleteToast(data.id, data.title || 'File downloaded', data.path);
            showSystemNotification('Download Complete', data.title || 'File downloaded', data.id);
        }
    });

    window.electron.onDownloadError((data) => {
        const item = state.queue.find(q => q.id === data.id);
        if (item) {
            handleDownloadError(item, new Error(data.error));
        }
    });

    window.electron.onDirectorySelected((event, path) => {
        if (path) {
            state.currentDownloadPath = path;
            if (elements.selectedPath) {
                elements.selectedPath.textContent = truncatePath(path);
                elements.selectedPath.title = path;
            }
        }
    });

    // Auto-updater listeners
    window.electron.onCheckingForUpdate(() => {
        console.log('Checking for updates...');
    });

    window.electron.onUpdateAvailable((info) => {
        console.log('Update available:', info);
        showUpdateNotification(info);
    });

    window.electron.onUpdateNotAvailable(() => {
        console.log('No updates available');
    });

    window.electron.onUpdateDownloadProgress((progress) => {
        console.log('Update download progress:', progress.percent);
        updateDownloadProgress(progress);
    });

    window.electron.onUpdateDownloaded((info) => {
        console.log('Update downloaded:', info);
        showUpdateReadyNotification(info);
    });

    window.electron.onUpdateError((error) => {
        console.error('Update error:', error);
        showToast('Update Error', 'Failed to check for updates', 'error');
    });
}

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Ctrl+S: Settings
        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            openSettings();
        }

        // Ctrl+V: Paste (when not in input)
        if (e.ctrlKey && e.key === 'v' && document.activeElement !== elements.urlInput) {
            e.preventDefault();
            pasteFromClipboard();
        }

        // Enter: Download (when in input)
        if (e.key === 'Enter' && document.activeElement === elements.urlInput) {
            handleDownload();
        }

        // Escape: Close modal
        if (e.key === 'Escape') {
            closeSettings();
        }

        // Ctrl+1/2/3: Switch tabs
        if (e.ctrlKey && ['1', '2', '3'].includes(e.key)) {
            e.preventDefault();
            const tabs = ['download', 'queue', 'history'];
            switchTab(tabs[parseInt(e.key) - 1]);
        }
    });
}

function setupDragAndDrop() {
    const dropTarget = elements.inputSection || document.body;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropTarget.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropTarget.addEventListener(eventName, () => {
            if (elements.dropZone) {
                elements.dropZone.classList.add('active');
            }
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropTarget.addEventListener(eventName, () => {
            if (elements.dropZone) {
                elements.dropZone.classList.remove('active');
            }
        }, false);
    });

    dropTarget.addEventListener('drop', handleDrop, false);
}

function handleDrop(e) {
    const data = e.dataTransfer;
    let url = '';

    // Try to get URL from dropped data
    if (data.types.includes('text/uri-list')) {
        url = data.getData('text/uri-list');
    } else if (data.types.includes('text/plain')) {
        url = data.getData('text/plain');
    }

    url = url.trim();

    if (isValidYouTubeURL(url)) {
        if (elements.urlInput) {
            elements.urlInput.value = url;
        }
        handleUrlInput();
        showToast('Link Added', 'YouTube link detected', 'success');
    } else {
        showToast('Invalid Link', 'Please drop a valid YouTube link', 'error');
    }
}

// ==================== HANDLERS ====================
async function handleDownload() {
    const url = elements.urlInput?.value.trim();

    if (!url) {
        showStatus('Please paste a YouTube link', 'error');
        elements.urlInput?.focus();
        shakeElement(elements.urlInput);
        return;
    }

    if (!isValidYouTubeURL(url)) {
        showStatus('Please enter a valid YouTube link', 'error');
        shakeElement(elements.urlInput);
        return;
    }

    const type = document.querySelector('input[name="download-type"]:checked')?.value || 'audio';
    const format = type === 'video' ? elements.videoFormatSelect?.value : elements.formatSelect?.value;
    const quality = type === 'video' ? elements.videoQualitySelect?.value : elements.qualitySelect?.value;

    // Show loading
    setButtonLoading(true);
    showStatus('Preparing download...', 'info');

    // Fetch video info first
    let info = null;
    try {
        info = await window.electron.getVideoInfo(url);
    } catch (err) {
        console.log('Could not fetch video info, continuing anyway...');
    }

    const isPlaylist = url.includes('playlist');

    addToQueue({
        url,
        title: info?.title || extractVideoId(url) || 'Download',
        type,
        format: format || 'mp3',
        quality: quality || 'best',
        isPlaylist
    });

    showStatus('Download added to queue!', 'success');
    setButtonLoading(false);

    // Clear input
    if (elements.urlInput) elements.urlInput.value = '';
    hideVideoPreview();
}

async function handleUrlInput() {
    const input = elements.urlInput?.value.trim();

    if (!input) {
        hideVideoPreview();
        hideSearchResults();
        return;
    }

    // Check if input looks like a URL
    if (isValidYouTubeURL(input)) {
        hideSearchResults();
        fetchVideoInfo(input);
    } else if (input.length >= 3) {
        // Trigger YouTube search for non-URL input
        hideVideoPreview();
        performYouTubeSearch(input);
    }
}

// YouTube Search functionality
let searchAbortController = null;
let isSearching = false;

async function performYouTubeSearch(query) {
    if (isSearching) return;

    // Show search results container with loading state
    showSearchLoading();
    isSearching = true;

    try {
        const results = await window.electron.searchYouTube(query);

        if (results && results.length > 0) {
            displaySearchResults(results, query);
        } else {
            showNoSearchResults(query);
        }
    } catch (error) {
        console.error('Search failed:', error);
        showSearchError();
    } finally {
        isSearching = false;
    }
}

function showSearchLoading() {
    if (!elements.searchResults) return;

    elements.searchResults.style.display = 'block';

    // Skeleton items
    const skeletonItems = Array(5).fill(0).map(() => `
        <div class="search-result-item skeleton">
            <div class="skeleton-thumb"></div>
            <div class="search-result-info">
                <div class="skeleton-text title"></div>
                <div class="skeleton-text meta"></div>
            </div>
        </div>
    `).join('');

    elements.searchResults.innerHTML = `
        <div class="search-results-header">
            <h4><i data-lucide="search"></i> Searching YouTube...</h4>
        </div>
        <div class="search-results-list">
            ${skeletonItems}
        </div>
    `;

    // Add searching class to input wrapper
    document.querySelector('.url-input-wrapper')?.classList.add('searching');

    if (window.lucide) window.lucide.createIcons();
}

function displaySearchResults(results, query) {
    if (!elements.searchResults) return;

    elements.searchResults.style.display = 'block';
    elements.searchResults.innerHTML = `
        <div class="search-results-header">
            <h4><i data-lucide="youtube"></i> Results for "${escapeHtml(truncateText(query, 30))}"</h4>
            <button class="search-results-close" onclick="hideSearchResults()">
                <i data-lucide="x"></i>
            </button>
        </div>
        ${results.map((result, index) => `
            <div class="search-result-item" data-url="${escapeHtml(result.url)}" data-index="${index}">
                ${result.thumbnail ? `
                    <img class="search-result-thumbnail" 
                         src="${result.thumbnail}" 
                         alt="${escapeHtml(result.title)}"
                         loading="lazy"
                         onerror="this.parentElement.innerHTML='<div class=\'search-result-thumbnail placeholder\'><i data-lucide=\'music\'></i></div>'">
                ` : `
                    <div class="search-result-thumbnail placeholder">
                        <i data-lucide="music"></i>
                    </div>
                `}
                <div class="search-result-info">
                    <div class="search-result-title" title="${escapeHtml(result.title)}">${escapeHtml(result.title)}</div>
                    <div class="search-result-meta">
                        <span><i data-lucide="clock"></i> ${result.duration || '0:00'}</span>
                        <span><i data-lucide="user"></i> ${escapeHtml(truncateText(result.channel || 'Unknown', 25))}</span>
                    </div>
                </div>
                <div class="search-result-actions">
                    <button class="search-action-btn" onclick="downloadFromSearch(event, '${escapeHtml(result.url)}', '${escapeHtml(result.title)}', 'audio')">
                        <i data-lucide="music"></i> MP3
                    </button>
                    <button class="search-action-btn secondary" onclick="downloadFromSearch(event, '${escapeHtml(result.url)}', '${escapeHtml(result.title)}', 'video')">
                        <i data-lucide="video"></i> MP4
                    </button>
                </div>
            </div>
        `).join('')}
        <div class="search-tip">
            <i data-lucide="lightbulb"></i>
            Click on a result to select it, or use the quick download buttons
        </div>
    `;

    // Add click handlers for result items
    elements.searchResults.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', (e) => {
            // Don't trigger if clicking on action buttons
            if (e.target.closest('.search-action-btn')) return;

            const url = item.dataset.url;
            if (url) {
                selectSearchResult(url);
            }
        });
    });

    if (window.lucide) window.lucide.createIcons();
}

function showNoSearchResults(query) {
    if (!elements.searchResults) return;

    elements.searchResults.style.display = 'block';
    elements.searchResults.innerHTML = `
        <div class="search-results-header">
            <h4><i data-lucide="search"></i> Search Results</h4>
            <button class="search-results-close" onclick="hideSearchResults()">
                <i data-lucide="x"></i>
            </button>
        </div>
        <div class="search-no-results">
            <i data-lucide="frown"></i>
            <p>No results found for "${escapeHtml(truncateText(query, 40))}"</p>
            <span style="font-size: 0.8rem">Try different keywords or paste a YouTube URL directly</span>
        </div>
    `;

    if (window.lucide) window.lucide.createIcons();
}

function showSearchError() {
    if (!elements.searchResults) return;

    elements.searchResults.style.display = 'block';
    elements.searchResults.innerHTML = `
        <div class="search-results-header">
            <h4><i data-lucide="alert-circle"></i> Search Error</h4>
            <button class="search-results-close" onclick="hideSearchResults()">
                <i data-lucide="x"></i>
            </button>
        </div>
        <div class="search-no-results">
            <i data-lucide="wifi-off"></i>
            <p>Failed to search YouTube</p>
            <span style="font-size: 0.8rem">Check your connection or try again</span>
        </div>
    `;

    if (window.lucide) window.lucide.createIcons();
}

function hideSearchResults() {
    if (elements.searchResults) {
        elements.searchResults.style.display = 'none';
    }
    document.querySelector('.url-input-wrapper')?.classList.remove('searching');
}

function selectSearchResult(url) {
    if (elements.urlInput) {
        elements.urlInput.value = url;
    }
    hideSearchResults();
    fetchVideoInfo(url);
    showToast('Video Selected', 'Ready to download!', 'success');
}

async function downloadFromSearch(event, url, title, type) {
    event.stopPropagation();

    const format = type === 'video' ?
        (elements.videoFormatSelect?.value || 'mp4') :
        (elements.formatSelect?.value || 'mp3');
    const quality = type === 'video' ?
        (elements.videoQualitySelect?.value || 'best') :
        (elements.qualitySelect?.value || 'best');

    addToQueue({
        url,
        title: title || 'YouTube Download',
        type,
        format,
        quality,
        isPlaylist: false
    });

    hideSearchResults();

    // Clear input
    if (elements.urlInput) elements.urlInput.value = '';
    hideVideoPreview();

    showToast('Download Started', truncateText(title, 40), 'success');
}

function handleTypeChange(e) {
    const type = e.target.value;

    if (elements.audioOptions) {
        elements.audioOptions.style.display = type === 'audio' ? 'flex' : 'none';
    }
    if (elements.videoOptions) {
        elements.videoOptions.style.display = type === 'video' ? 'flex' : 'none';
    }

    if (elements.downloadText) {
        const text = type === 'video' ? '⬇️ Download Video' : '⬇️ Start Download';
        elements.downloadText.textContent = text;
    }
}

async function handleWindowFocus() {
    if (!state.settings.autoPaste) return;

    try {
        const text = await navigator.clipboard.readText();
        const url = text?.trim();

        // Only auto-paste if it's a new YouTube URL and input is empty
        if (url &&
            isValidYouTubeURL(url) &&
            url !== state.lastPastedUrl &&
            !elements.urlInput?.value) {

            state.lastPastedUrl = url;
            elements.urlInput.value = url;
            handleUrlInput();
            showToast('Auto-pasted', 'YouTube link detected', 'info');
        }
    } catch (err) {
        // Clipboard access denied, ignore
    }
}

function redownloadFromHistory(url) {
    if (elements.urlInput) {
        elements.urlInput.value = url;
    }
    switchTab('download');
    handleUrlInput();
}

function openHistoryFile(filePath) {
    console.log('openHistoryFile called with filePath:', filePath);

    if (!filePath) {
        showToast('Error', 'File path not provided', 'error');
        console.error('No file path provided');
        return;
    }

    if (!window.electron.openFile) {
        showToast('Error', 'Function not available', 'error');
        console.error('window.electron.openFile not available');
        return;
    }

    try {
        window.electron.openFile(filePath);
        console.log('Called openFile with path:', filePath);
    } catch (error) {
        console.error('Error calling openFile:', error);
        showToast('Error', 'Failed to open file', 'error');
    }
}

function openHistoryFileLocation(filePath) {
    console.log('openHistoryFileLocation called with filePath:', filePath);

    if (!filePath) {
        showToast('Error', 'File path not provided', 'error');
        console.error('No file path provided');
        return;
    }

    if (!window.electron.openFileLocation) {
        showToast('Error', 'Function not available', 'error');
        console.error('window.electron.openFileLocation not available');
        return;
    }

    try {
        window.electron.openFileLocation(filePath);
        console.log('Called openFileLocation with path:', filePath);
    } catch (error) {
        console.error('Error calling openFileLocation:', error);
        showToast('Error', 'Failed to open folder', 'error');
    }
}

async function deleteHistoryFile(historyId, filePath) {
    console.log('deleteHistoryFile called with historyId:', historyId, 'filePath:', filePath);
    const item = state.history.find(h => h.historyId === historyId);
    console.log('Found history item:', item);

    if (!filePath) {
        showToast('Error', 'File path not found', 'error');
        console.error('No file path provided');
        return;
    }

    const confirmDelete = confirm(`Delete "${item?.title || 'this file'}"?\n\nThis action cannot be undone.`);
    if (!confirmDelete) {
        console.log('Delete cancelled by user');
        return;
    }

    try {
        console.log('Calling deleteFile with path:', filePath);
        const result = await window.electron.deleteFile(filePath);
        console.log('Delete result:', result);

        if (result.success) {
            // Update history item to mark file as deleted
            const historyItem = state.history.find(h => h.historyId === historyId);
            if (historyItem) {
                historyItem.filePath = null;
            }
            saveHistory();
            updateHistoryUI();
            showToast('Deleted', 'File deleted successfully', 'success');
        } else {
            showToast('Error', result.error || 'Failed to delete file', 'error');
        }
    } catch (error) {
        console.error('Error in deleteHistoryFile:', error);
        showToast('Error', 'Failed to delete file', 'error');
    }
}

function removeFromHistory(historyId) {
    console.log('removeFromHistory called with historyId:', historyId);
    const beforeCount = state.history.length;
    state.history = state.history.filter(item => item.historyId !== historyId);
    const afterCount = state.history.length;
    console.log(`Removed ${beforeCount - afterCount} items from history`);

    saveHistory();
    updateHistoryUI();
    showToast('Removed', 'Item removed from history', 'info');
}

// ==================== UTILITIES ====================
function switchTab(tabId) {
    if (!tabId) return;

    elements.tabContents.forEach(content => {
        content.classList.toggle('active', content.id === `${tabId}-tab`);
    });

    elements.tabBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
}

function openSettings() {
    if (elements.settingsModal) {
        elements.settingsModal.style.display = 'flex';
    }
}

function closeSettings() {
    if (elements.settingsModal) {
        elements.settingsModal.style.display = 'none';
    }
}

async function pasteFromClipboard() {
    try {
        const text = await navigator.clipboard.readText();
        if (elements.urlInput) {
            elements.urlInput.value = text.trim();
            state.lastPastedUrl = text.trim();
            handleUrlInput();
        }
    } catch (err) {
        showStatus('Failed to paste from clipboard', 'error');
    }
}

function selectDownloadLocation() {
    window.electron.selectDirectory();
}

function isValidYouTubeURL(url) {
    if (!url) return false;
    const patterns = [
        /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\/.+$/,
        /^(https?:\/\/)?(www\.)?youtube\.com\/watch\?v=[\w-]+/,
        /^(https?:\/\/)?(www\.)?youtu\.be\/[\w-]+/,
        /^(https?:\/\/)?(www\.)?youtube\.com\/playlist\?list=[\w-]+/,
        /^(https?:\/\/)?music\.youtube\.com\/watch\?v=[\w-]+/,
        /^(https?:\/\/)?music\.youtube\.com\/playlist\?list=[\w-]+/,
        /^(https?:\/\/)?(www\.)?youtube\.com\/shorts\/[\w-]+/
    ];
    return patterns.some(pattern => pattern.test(url));
}

function extractVideoId(url) {
    const regex = /(?:v=|\/)([\w-]{11})(?:\?|&|$)/;
    const match = url?.match(regex);
    return match ? match[1] : null;
}

function showStatus(message, type = 'info') {
    if (!elements.statusEl) return;

    elements.statusEl.textContent = message;
    elements.statusEl.className = type;

    if (type === 'success') {
        setTimeout(() => {
            if (elements.statusEl.textContent === message) {
                elements.statusEl.textContent = '';
                elements.statusEl.className = '';
            }
        }, 3000);
    }
}

function setButtonLoading(loading) {
    if (elements.downloadBtn) {
        elements.downloadBtn.disabled = loading;
    }
    if (elements.downloadText) {
        elements.downloadText.style.display = loading ? 'none' : 'inline';
    }
    if (elements.loadingSpinner) {
        elements.loadingSpinner.style.display = loading ? 'inline' : 'none';
    }
}

function showToast(title, message, type = 'info') {
    if (!elements.toastContainer) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
        success: '✅',
        error: '❌',
        info: 'ℹ️',
        warning: '⚠️'
    };

    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <div class="toast-content">
            <div class="toast-title">${escapeHtml(title)}</div>
            <div class="toast-message">${escapeHtml(message)}</div>
        </div>
        <button class="toast-close" onclick="this.parentElement.remove()">✕</button>
    `;

    elements.toastContainer.appendChild(toast);

    // Auto remove after 4 seconds
    setTimeout(() => {
        toast.style.animation = 'toastSlideOut 0.3s ease-out forwards';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function showSystemNotification(title, body, downloadId) {
    if (!state.settings.notifications) return;

    if ('Notification' in window && Notification.permission === 'granted') {
        const notification = new Notification(title, {
            body,
            icon: 'icon.png',
            requireInteraction: false,
            tag: downloadId ? `download-${downloadId}` : undefined
        });

        // Make notification clickable to open the file
        if (downloadId) {
            notification.onclick = () => {
                openFile(downloadId);
                notification.close();
            };
        }
    }
}

function showDownloadCompleteToast(id, title, filePath) {
    if (!elements.toastContainer) return;

    const toast = document.createElement('div');
    toast.className = 'toast success interactive';

    toast.innerHTML = `
        <span class="toast-icon">✅</span>
        <div class="toast-content">
            <div class="toast-title">Download Complete</div>
            <div class="toast-message">${escapeHtml(truncateText(title, 40))}</div>
        </div>
        <div class="toast-actions">
            <button class="toast-action-btn" onclick="openFile(${id}); this.closest('.toast').remove();" title="Open file">
                <i data-lucide="play"></i>
            </button>
            <button class="toast-action-btn" onclick="openFileLocation(${id}); this.closest('.toast').remove();" title="Show in folder">
                <i data-lucide="folder-open"></i>
            </button>
        </div>
        <button class="toast-close" onclick="this.parentElement.remove()">✕</button>
    `;

    elements.toastContainer.appendChild(toast);

    // Re-initialize icons
    if (window.lucide) window.lucide.createIcons();

    // Auto remove after 8 seconds (longer for interactive toast)
    setTimeout(() => {
        if (toast.parentElement) {
            toast.style.animation = 'toastSlideOut 0.3s ease-out forwards';
            setTimeout(() => toast.remove(), 300);
        }
    }, 8000);
}

function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

function shakeElement(element) {
    if (!element) return;
    element.style.animation = 'none';
    element.offsetHeight; // Trigger reflow
    element.style.animation = 'shake 0.5s ease-in-out';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function truncateText(text, maxLength) {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}

function truncatePath(path) {
    if (!path) return '';
    const parts = path.split(/[/\\]/);
    if (parts.length <= 3) return path;
    return `.../${parts.slice(-2).join('/')}`;
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    }
}

// ==================== AUTO-UPDATER FUNCTIONS ====================
let updateNotificationElement = null;

function showUpdateNotification(info) {
    // Remove existing notification if any
    if (updateNotificationElement) {
        updateNotificationElement.remove();
    }

    // Create update notification
    updateNotificationElement = document.createElement('div');
    updateNotificationElement.className = 'update-notification';
    updateNotificationElement.innerHTML = `
        <div class="update-notification-content">
            <div class="update-icon">
                <i data-lucide="download-cloud"></i>
            </div>
            <div class="update-info">
                <h3>Update Available</h3>
                <p>Version ${info.version} is now available</p>
                ${info.releaseNotes ? `<small class="release-notes">${truncateText(info.releaseNotes, 100)}</small>` : ''}
            </div>
            <div class="update-actions">
                <button class="ghost-btn sm" onclick="dismissUpdateNotification()">
                    <i data-lucide="x"></i> Later
                </button>
                <button class="primary-btn sm" onclick="downloadUpdate()">
                    <i data-lucide="download"></i> Download
                </button>
            </div>
        </div>
        <div class="update-progress" style="display: none;">
            <div class="progress-bar-container">
                <div class="progress-fill" id="update-progress-fill"></div>
            </div>
            <div class="progress-stats">
                <span id="update-progress-text">Downloading update...</span>
                <span id="update-progress-percent">0%</span>
            </div>
        </div>
    `;

    document.body.appendChild(updateNotificationElement);

    // Re-initialize icons
    if (window.lucide) window.lucide.createIcons();

    // Show toast as well
    showToast('Update Available', `Version ${info.version} is ready to download`, 'info');
}

function downloadUpdate() {
    if (!updateNotificationElement) return;

    // Hide action buttons, show progress
    const content = updateNotificationElement.querySelector('.update-notification-content');
    const progress = updateNotificationElement.querySelector('.update-progress');
    const actions = updateNotificationElement.querySelector('.update-actions');

    if (actions) actions.style.display = 'none';
    if (progress) progress.style.display = 'block';

    // Trigger download
    window.electron.downloadUpdate();
    showToast('Downloading Update', 'Update is being downloaded in the background', 'info');
}

function updateDownloadProgress(progressInfo) {
    if (!updateNotificationElement) return;

    const progressFill = document.getElementById('update-progress-fill');
    const progressPercent = document.getElementById('update-progress-percent');
    const progressText = document.getElementById('update-progress-text');

    if (progressFill) {
        progressFill.style.width = `${progressInfo.percent}%`;
    }
    if (progressPercent) {
        progressPercent.textContent = `${Math.round(progressInfo.percent)}%`;
    }
    if (progressText) {
        const mbTransferred = (progressInfo.transferred / 1024 / 1024).toFixed(1);
        const mbTotal = (progressInfo.total / 1024 / 1024).toFixed(1);
        progressText.textContent = `Downloading... ${mbTransferred}MB / ${mbTotal}MB`;
    }
}

function showUpdateReadyNotification(info) {
    // Remove existing notification
    if (updateNotificationElement) {
        updateNotificationElement.remove();
    }

    // Create ready notification
    updateNotificationElement = document.createElement('div');
    updateNotificationElement.className = 'update-notification ready';
    updateNotificationElement.innerHTML = `
        <div class="update-notification-content">
            <div class="update-icon success">
                <i data-lucide="check-circle"></i>
            </div>
            <div class="update-info">
                <h3>Update Ready</h3>
                <p>Version ${info.version} has been downloaded</p>
                <small>The app will restart to install the update</small>
            </div>
            <div class="update-actions">
                <button class="ghost-btn sm" onclick="dismissUpdateNotification()">
                    <i data-lucide="x"></i> Later
                </button>
                <button class="primary-btn sm" onclick="installUpdate()">
                    <i data-lucide="refresh-cw"></i> Restart & Install
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(updateNotificationElement);

    // Re-initialize icons
    if (window.lucide) window.lucide.createIcons();

    // Show toast
    showToast('Update Ready', 'Click to restart and install', 'success');
}

function installUpdate() {
    window.electron.installUpdate();
}

function dismissUpdateNotification() {
    if (updateNotificationElement) {
        updateNotificationElement.style.animation = 'slideOutUp 0.3s ease-out';
        setTimeout(() => {
            if (updateNotificationElement) {
                updateNotificationElement.remove();
                updateNotificationElement = null;
            }
        }, 300);
    }
}

// Add shake animation via CSS
const style = document.createElement('style');
style.textContent = `
    @keyframes shake {
        0%, 100% { transform: translateX(0); }
        20%, 60% { transform: translateX(-5px); }
        40%, 80% { transform: translateX(5px); }
    }
`;
document.head.appendChild(style);

// ==================== GLOBAL FUNCTIONS ====================
// Make functions globally accessible for onclick handlers
window.pasteFromClipboard = pasteFromClipboard;
window.selectDownloadLocation = selectDownloadLocation;
window.retryDownload = retryDownload;
window.removeFromQueue = removeFromQueue;
window.cancelDownload = cancelDownload;
window.openFileLocation = openFileLocation;
window.openFile = openFile;
window.deleteFile = deleteFile;
window.redownloadFromHistory = redownloadFromHistory;
window.openHistoryFile = openHistoryFile;
window.openHistoryFileLocation = openHistoryFileLocation;
window.deleteHistoryFile = deleteHistoryFile;
window.removeFromHistory = removeFromHistory;
window.hideSearchResults = hideSearchResults;
window.downloadFromSearch = downloadFromSearch;
window.selectSearchResult = selectSearchResult;
window.downloadUpdate = downloadUpdate;
window.installUpdate = installUpdate;
window.dismissUpdateNotification = dismissUpdateNotification;

