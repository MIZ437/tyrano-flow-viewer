/**
 * TyranoFlow Viewer - Main Application
 */

class TyranoFlowApp {
    constructor() {
        this.parser = new TyranoParser();
        this.flowchart = new FlowchartGenerator();
        this.timeline = new TimelineProcessor(); // 新しいタイムラインプロセッサ
        this.currentProjectPath = null;
        this.fileHandles = new Map();
        this.fileContents = new Map(); // ファイル内容のキャッシュ

        // プロジェクトルートとdataフォルダのハンドル
        this.projectRootHandle = null;
        this.dataHandle = null;

        // リソースフォルダのハンドル
        this.resourceHandles = {
            bgimage: null,
            fgimage: null,
            video: null,
            bgm: null,
            sound: null
        };

        // Blob URLのキャッシュ（メモリリーク防止用）
        this.blobUrlCache = new Map();

        // パン・ズームコントローラー
        this.panZoom = null;

        // タイムライン関連（新設計）
        this.timelineZoom = 100; // 100% = 1[p] = 30px
        this.pixelsPerUnit = 30; // 基本スケール
        this.playheadTime = 0; // 再生ヘッドの時間位置（[p]単位）
        this.isDraggingPlayhead = false;
        this.selectedClip = null;
        this.trackLabelWidth = 120; // トラックラベルの幅
        this.selectedTrackId = null; // 選択中のトラックID
        this.selectedTrackType = null; // 選択中のトラックタイプ

        this.init();
    }

    /**
     * 初期化
     */
    init() {
        this.setupEventListeners();
        this.setupDragAndDrop();
        this.setupNodeClickHandler();
        this.setupPanZoom();
        this.setupScrollContainment();
        this.setupViewTabs();
        this.setupTimelineControls();
    }

    /**
     * パン・ズームのセットアップ
     */
    setupPanZoom() {
        const container = document.getElementById('flowchart-container');
        if (container) {
            this.panZoom = new PanZoomController(container);
        }
    }

    /**
     * 表示切替タブのセットアップ
     */
    setupViewTabs() {
        const tabFlowchart = document.getElementById('tab-flowchart');
        const tabTimeline = document.getElementById('tab-timeline');
        const dropZone = document.getElementById('drop-zone');
        const timelineView = document.getElementById('timeline-view');
        const leftPanel = document.querySelector('.left-panel');

        if (tabFlowchart && tabTimeline) {
            tabFlowchart.addEventListener('click', () => {
                tabFlowchart.classList.add('active');
                tabTimeline.classList.remove('active');
                dropZone.classList.add('active');
                timelineView.classList.remove('active');
                // 左パネルを表示
                if (leftPanel) leftPanel.style.display = '';
            });

            tabTimeline.addEventListener('click', () => {
                tabTimeline.classList.add('active');
                tabFlowchart.classList.remove('active');
                timelineView.classList.add('active');
                dropZone.classList.remove('active');
                // 左パネルを非表示
                if (leftPanel) leftPanel.style.display = 'none';
                // タイムラインをビルドして描画
                this.buildAndRenderTimeline();
            });
        }
    }

    /**
     * タイムライン関連コントロールのセットアップ
     */
    setupTimelineControls() {
        // ズームボタン
        const zoomInBtn = document.getElementById('zoom-in-btn');
        const zoomOutBtn = document.getElementById('zoom-out-btn');

        if (zoomInBtn) {
            zoomInBtn.addEventListener('click', () => {
                this.setZoom(this.timelineZoom + 25);
            });
        }

        if (zoomOutBtn) {
            zoomOutBtn.addEventListener('click', () => {
                this.setZoom(this.timelineZoom - 25);
            });
        }

        // 再生ヘッドのドラッグ
        const playhead = document.getElementById('playhead');
        const timelinePanel = document.getElementById('timeline-panel');

        if (playhead && timelinePanel) {
            const handle = playhead.querySelector('.playhead-handle');
            if (handle) {
                handle.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    this.isDraggingPlayhead = true;
                    document.body.style.cursor = 'ew-resize';
                });
            }

            document.addEventListener('mousemove', (e) => {
                if (!this.isDraggingPlayhead) return;

                const panel = document.getElementById('timeline-panel');
                const wrapper = document.getElementById('timeline-tracks-wrapper');
                if (!panel || !wrapper) return;

                const panelRect = panel.getBoundingClientRect();
                const scrollLeft = wrapper.scrollLeft;

                // パネル左端からの視覚的位置 → 時間座標に変換
                const visualX = e.clientX - panelRect.left;
                const pixelX = visualX - this.trackLabelWidth + scrollLeft;
                const time = this.pixelToTime(pixelX);
                this.setPlayheadTime(Math.max(0, Math.min(time, this.timeline.totalTime)));
            });

            document.addEventListener('mouseup', () => {
                if (this.isDraggingPlayhead) {
                    this.isDraggingPlayhead = false;
                    document.body.style.cursor = '';
                }
            });
        }

        // ルーラークリックで再生ヘッド移動
        const rulerContent = document.getElementById('ruler-content');
        const ruler = document.getElementById('timeline-ruler');
        if (ruler) {
            ruler.addEventListener('click', (e) => {
                const panel = document.getElementById('timeline-panel');
                const wrapper = document.getElementById('timeline-tracks-wrapper');
                if (!panel || !wrapper) return;

                const panelRect = panel.getBoundingClientRect();
                const scrollLeft = wrapper.scrollLeft;

                // パネル左端からの視覚的位置 → 時間座標に変換
                const visualX = e.clientX - panelRect.left;
                const pixelX = visualX - this.trackLabelWidth + scrollLeft;
                const time = this.pixelToTime(pixelX);
                this.setPlayheadTime(Math.max(0, Math.min(time, this.timeline.totalTime)));
            });
        }

        // タイムラインスクロール同期
        const tracksWrapper = document.getElementById('timeline-tracks-wrapper');
        if (tracksWrapper && rulerContent) {
            tracksWrapper.addEventListener('scroll', () => {
                rulerContent.style.transform = `translateX(-${tracksWrapper.scrollLeft}px)`;
                this.updatePlayheadVisual();
            });

            // トラックエリアのクリックで再生ヘッド移動
            tracksWrapper.addEventListener('click', (e) => {
                // クリップやラベルのクリックは除外（それぞれ独自のハンドラがある）
                if (e.target.closest('.timeline-clip') || e.target.closest('.track-label')) {
                    return;
                }

                const panel = document.getElementById('timeline-panel');
                if (!panel) return;

                const panelRect = panel.getBoundingClientRect();
                const scrollLeft = tracksWrapper.scrollLeft;

                const visualX = e.clientX - panelRect.left;
                const pixelX = visualX - this.trackLabelWidth + scrollLeft;
                const time = this.pixelToTime(pixelX);
                this.setPlayheadTime(Math.max(0, Math.min(time, this.timeline.totalTime)));
            });
        }

        // キーボードナビゲーション
        document.addEventListener('keydown', (e) => {
            // タイムラインビューがアクティブでない場合は無視
            const timelineView = document.getElementById('timeline-view');
            if (!timelineView || !timelineView.classList.contains('active')) return;

            // 入力フォーカス中は無視
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            switch (e.key) {
                case 'ArrowUp':
                    e.preventDefault();
                    this.navigateToClipEdge('prev');
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    this.navigateToClipEdge('next');
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    this.setPlayheadTime(Math.max(0, this.playheadTime - 1));
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    this.setPlayheadTime(Math.min(this.timeline.totalTime, this.playheadTime + 1));
                    break;
            }
        });
    }

    /**
     * クリップの端へ移動（上キー: 前のクリップ端、下キー: 次のクリップ端）
     */
    navigateToClipEdge(direction) {
        if (!this.selectedTrackId) return;

        const trackList = this.timeline.getTrackList();
        const track = trackList.find(t => t.id === this.selectedTrackId);
        if (!track || track.events.length === 0) return;

        // 全てのクリップ境界（開始・終了時間）を収集してソート
        const edges = new Set();
        track.events.forEach(event => {
            edges.add(event.startTime);
            edges.add(event.endTime);
        });
        const sortedEdges = Array.from(edges).sort((a, b) => a - b);

        const currentTime = this.playheadTime;

        if (direction === 'next') {
            // 現在位置より後の最初の境界を見つける
            const nextEdge = sortedEdges.find(t => t > currentTime + 0.001);
            if (nextEdge !== undefined) {
                this.setPlayheadTime(nextEdge);
            }
        } else {
            // 現在位置より前の最後の境界を見つける
            const prevEdges = sortedEdges.filter(t => t < currentTime - 0.001);
            if (prevEdges.length > 0) {
                this.setPlayheadTime(prevEdges[prevEdges.length - 1]);
            }
        }
    }

    /**
     * ズームレベルを設定
     */
    setZoom(zoom) {
        this.timelineZoom = Math.max(25, Math.min(400, zoom));
        const zoomLabel = document.getElementById('zoom-level');
        if (zoomLabel) {
            zoomLabel.textContent = `${this.timelineZoom}%`;
        }
        // タイムラインを再描画
        this.renderTimelineTracks();
    }

    /**
     * 時間をピクセルに変換
     */
    timeToPixel(time) {
        return time * this.pixelsPerUnit * (this.timelineZoom / 100);
    }

    /**
     * ピクセルを時間に変換
     */
    pixelToTime(pixel) {
        return pixel / (this.pixelsPerUnit * (this.timelineZoom / 100));
    }

    /**
     * 再生ヘッドの時間位置を設定
     */
    setPlayheadTime(time) {
        this.playheadTime = time;
        this.updatePlayheadVisual();
        this.updatePreviewAtTime(time);

        // プレビュー時間表示を更新
        const previewTime = document.getElementById('preview-time');
        if (previewTime) {
            previewTime.textContent = `[${Math.floor(time)}p]`;
        }
    }

    /**
     * 再生ヘッドの表示を更新
     */
    updatePlayheadVisual() {
        const playhead = document.getElementById('playhead');
        const tracksWrapper = document.getElementById('timeline-tracks-wrapper');

        if (!playhead || !tracksWrapper) return;

        const scrollLeft = tracksWrapper.scrollLeft;
        const pixelX = this.timeToPixel(this.playheadTime);
        const visualX = this.trackLabelWidth + pixelX - scrollLeft;

        playhead.style.left = `${visualX}px`;
    }

    /**
     * 指定時間のプレビューを更新
     */
    updatePreviewAtTime(time) {
        const events = this.timeline.getEventsAtTime(time);
        if (events.length === 0) {
            this.clearPreview();
            return;
        }

        let targetEvent = null;

        // 選択中のトラックがある場合、そのトラックのイベントを優先
        if (this.selectedTrackId) {
            const trackList = this.timeline.getTrackList();
            const selectedTrack = trackList.find(t => t.id === this.selectedTrackId);
            if (selectedTrack) {
                // 選択トラックのイベントから現在時間に該当するものを探す
                targetEvent = selectedTrack.events.find(e =>
                    e.startTime <= time && e.endTime > time
                );
            }
        }

        // 選択トラックにイベントがない場合はフォールバック
        if (!targetEvent) {
            // 優先順位: テキスト > キャラ > 画像 > 背景 > BGM > SE
            targetEvent = events.find(e => e.type === 'text') ||
                          events.find(e => e.type === 'chara') ||
                          events.find(e => e.type === 'image') ||
                          events.find(e => e.type === 'bg') ||
                          events.find(e => e.type === 'bgm') ||
                          events.find(e => e.type === 'se') ||
                          events[0];
        }

        if (targetEvent) {
            this.showEventPreview(targetEvent);
        } else {
            this.clearPreview();
        }
    }

    /**
     * プレビューをクリア
     */
    clearPreview() {
        const placeholder = document.getElementById('preview-placeholder');
        const content = document.getElementById('preview-content');
        if (placeholder) placeholder.style.display = 'flex';
        if (content) content.style.display = 'none';
    }

    /**
     * イベントのプレビューを表示
     */
    async showEventPreview(event) {
        const placeholder = document.getElementById('preview-placeholder');
        const content = document.getElementById('preview-content');
        const filenameEl = document.getElementById('preview-filename');
        const previewBody = document.getElementById('preview-body');

        if (!content || !filenameEl || !previewBody) return;

        placeholder.style.display = 'none';
        content.style.display = 'flex';

        filenameEl.textContent = event.filename || '';

        let html = '';

        switch (event.type) {
            case 'text':
                html = `<div class="preview-text-content">
                    ${event.speaker ? `<div class="preview-speaker">${this.escapeHtml(event.speaker)}</div>` : ''}
                    <div class="preview-dialogue">${this.escapeHtml(event.text)}</div>
                </div>`;
                break;

            case 'bg':
                if (event.storage) {
                    const blobUrl = await this.getResourceBlobUrl(event.storage, 'bgimage');
                    if (blobUrl) {
                        html = `<div class="preview-image-container">
                            <img src="${blobUrl}" alt="${event.storage}" class="preview-image-fit">
                        </div>`;
                    } else {
                        html = `<div class="preview-info">背景: ${event.storage}</div>`;
                    }
                }
                break;

            case 'image':
                if (event.storage) {
                    const blobUrl = await this.getResourceBlobUrl(event.storage, 'fgimage');
                    if (blobUrl) {
                        html = `<div class="preview-image-container">
                            <img src="${blobUrl}" alt="${event.storage}" class="preview-image-fit">
                        </div>`;
                    } else {
                        html = `<div class="preview-info">画像: ${event.storage} (レイヤー${event.layer})</div>`;
                    }
                }
                break;

            case 'chara':
                html = `<div class="preview-info">
                    <div>キャラ: ${event.name}</div>
                    ${event.face ? `<div>表情: ${event.face}</div>` : ''}
                </div>`;
                break;

            case 'bgm':
                if (event.storage) {
                    const blobUrl = await this.getResourceBlobUrl(event.storage, 'bgm');
                    if (blobUrl) {
                        html = `<div class="preview-audio-container">
                            <div class="preview-audio-label">BGM: ${event.storage}</div>
                            <audio controls class="preview-audio">
                                <source src="${blobUrl}">
                            </audio>
                        </div>`;
                    } else {
                        html = `<div class="preview-info">BGM: ${event.storage}</div>`;
                    }
                }
                break;

            case 'se':
                if (event.storage) {
                    const blobUrl = await this.getResourceBlobUrl(event.storage, 'sound');
                    if (blobUrl) {
                        html = `<div class="preview-audio-container">
                            <div class="preview-audio-label">SE: ${event.storage}</div>
                            <audio controls class="preview-audio">
                                <source src="${blobUrl}">
                            </audio>
                        </div>`;
                    } else {
                        html = `<div class="preview-info">SE: ${event.storage}</div>`;
                    }
                }
                break;

            case 'video':
                html = `<div class="preview-info">動画: ${event.storage || '(不明)'}</div>`;
                break;
        }

        previewBody.innerHTML = html;
    }

    /**
     * スクロール制御のセットアップ
     * ファイル一覧・ファイル詳細のスクロールが画面全体に伝播しないようにする
     */
    setupScrollContainment() {
        const fileList = document.getElementById('file-list');
        const fileDetails = document.getElementById('file-details');

        const handleWheel = (e) => {
            // ネストされたスクロール可能な要素をチェック
            const target = e.target;
            const scrollableParent = target.closest('.dialogue-list, .resource-list');

            if (scrollableParent) {
                // ネストされたスクロール要素内の場合
                const scrollTop = scrollableParent.scrollTop;
                const scrollHeight = scrollableParent.scrollHeight;
                const clientHeight = scrollableParent.clientHeight;
                const hasScroll = scrollHeight > clientHeight;

                if (hasScroll) {
                    // スクロール可能な場合は伝播を止めてデフォルト動作を許可
                    e.stopPropagation();

                    // 境界チェック
                    if (scrollTop <= 0 && e.deltaY < 0) {
                        e.preventDefault();
                    } else if (scrollTop + clientHeight >= scrollHeight - 1 && e.deltaY > 0) {
                        e.preventDefault();
                    }
                    return;
                }
            }

            // 通常のパネルスクロール処理
            const element = e.currentTarget;
            const scrollTop = element.scrollTop;
            const scrollHeight = element.scrollHeight;
            const clientHeight = element.clientHeight;
            const deltaY = e.deltaY;

            // スクロール可能な範囲があるかチェック
            const hasScroll = scrollHeight > clientHeight;

            // イベント伝播を常に停止
            e.stopPropagation();

            if (hasScroll) {
                // 上端でさらに上にスクロールしようとした場合
                if (scrollTop <= 0 && deltaY < 0) {
                    e.preventDefault();
                    return;
                }
                // 下端でさらに下にスクロールしようとした場合
                if (scrollTop + clientHeight >= scrollHeight - 1 && deltaY > 0) {
                    e.preventDefault();
                    return;
                }
            } else {
                // スクロール可能な範囲がない場合は常にデフォルト動作を防ぐ
                e.preventDefault();
            }
        };

        if (fileList) {
            fileList.addEventListener('wheel', handleWheel, { passive: false });
        }
        if (fileDetails) {
            fileDetails.addEventListener('wheel', handleWheel, { passive: false });
        }
    }

    /**
     * イベントリスナーのセットアップ
     */
    setupEventListeners() {
        // フォルダ選択ボタン
        const selectBtn = document.getElementById('select-folder-btn');
        if (selectBtn) {
            selectBtn.addEventListener('click', () => this.selectFolder());
        }

        // 更新ボタン
        const refreshBtn = document.getElementById('refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.refresh());
        }

        // 検索ボタン
        const searchBtn = document.getElementById('search-btn');
        const searchInput = document.getElementById('search-input');
        if (searchBtn && searchInput) {
            searchBtn.addEventListener('click', () => this.performSearch());
            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.performSearch();
                }
            });
        }

        // 検索モーダルを閉じる
        const searchModalClose = document.getElementById('search-modal-close');
        const searchModal = document.getElementById('search-modal');
        if (searchModalClose && searchModal) {
            searchModalClose.addEventListener('click', () => {
                searchModal.classList.remove('active');
            });
            searchModal.addEventListener('click', (e) => {
                if (e.target === searchModal) {
                    searchModal.classList.remove('active');
                }
            });
        }
    }

    /**
     * ドラッグ&ドロップのセットアップ
     */
    setupDragAndDrop() {
        const dropZone = document.getElementById('drop-zone');
        if (!dropZone) return;

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });

        dropZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
        });

        dropZone.addEventListener('drop', async (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');

            const items = e.dataTransfer.items;
            if (items.length > 0) {
                const item = items[0];
                if (item.kind === 'file') {
                    const handle = await item.getAsFileSystemHandle();
                    if (handle.kind === 'directory') {
                        await this.loadFromDirectoryHandle(handle);
                    } else {
                        this.showError('フォルダをドロップしてください');
                    }
                }
            }
        });
    }

    /**
     * ノードクリックハンドラのセットアップ
     */
    setupNodeClickHandler() {
        document.addEventListener('nodeClick', (e) => {
            const { filename, data } = e.detail;
            this.showFileDetails(filename, data);
        });
    }

    /**
     * フォルダ選択ダイアログを開く
     */
    async selectFolder() {
        try {
            // File System Access API
            const handle = await window.showDirectoryPicker();
            await this.loadFromDirectoryHandle(handle);
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('Folder selection error:', error);
                this.showError('フォルダの選択に失敗しました');
            }
        }
    }

    /**
     * DirectoryHandleからファイルを読み込む
     */
    async loadFromDirectoryHandle(dirHandle) {
        this.showLoading(true);
        this.flowchart.clear();
        this.fileHandles.clear();
        this.clearBlobCache();

        try {
            // プロジェクトルートを特定
            this.projectRootHandle = dirHandle;

            // dataフォルダを探す
            let scenarioHandle = null;

            try {
                // まず data/scenario の構造を試す
                this.dataHandle = await dirHandle.getDirectoryHandle('data');
                scenarioHandle = await this.dataHandle.getDirectoryHandle('scenario');

                // リソースフォルダのハンドルを取得
                await this.loadResourceHandles();
            } catch {
                // dataフォルダがない場合 - dirHandleがdataフォルダ自体かもしれない
                if (dirHandle.name === 'data') {
                    // dataフォルダを直接ドロップした場合
                    this.dataHandle = dirHandle;
                    try {
                        scenarioHandle = await dirHandle.getDirectoryHandle('scenario');
                        // リソースフォルダのハンドルを取得
                        await this.loadResourceHandles();
                    } catch {
                        scenarioHandle = dirHandle;
                    }
                } else if (dirHandle.name === 'scenario') {
                    // scenarioフォルダを直接ドロップした場合
                    scenarioHandle = dirHandle;
                } else {
                    // その他のフォルダ構造
                    try {
                        scenarioHandle = await dirHandle.getDirectoryHandle('scenario');
                    } catch {
                        scenarioHandle = dirHandle;
                    }
                }
            }

            // .ksファイルを読み込む（systemフォルダを除外）
            const ksFiles = [];
            await this.collectKsFiles(scenarioHandle, ksFiles, '');

            if (ksFiles.length === 0) {
                this.showError('ksファイルが見つかりません');
                this.showLoading(false);
                return;
            }

            // 各ファイルを解析
            for (const {handle, relativePath} of ksFiles) {
                const file = await handle.getFile();
                const content = await file.text();
                const parsed = this.parser.parse(content, handle.name);
                this.flowchart.addParsedFile(handle.name, parsed);
                this.fileHandles.set(handle.name, handle);
            }

            // フローチャートを描画
            await this.flowchart.render('flowchart-container');

            // パン・ズームをSVGにアタッチ
            if (this.panZoom) {
                this.panZoom.attachToSvg();
            }

            // ファイル一覧を表示
            this.renderFileList();

            // プロジェクトパスを保存
            this.currentProjectPath = dirHandle.name;
            const storyCount = this.flowchart.getSortedStoryFiles().length;
            this.updateStatus(`${ksFiles.length}個のksファイル（ストーリー: ${storyCount}個）を読み込みました`);

        } catch (error) {
            console.error('Load error:', error);
            this.showError('ファイルの読み込みに失敗しました: ' + error.message);
        }

        this.showLoading(false);
    }

    /**
     * リソースフォルダのハンドルを取得
     */
    async loadResourceHandles() {
        if (!this.dataHandle) return;

        const folders = ['bgimage', 'fgimage', 'video', 'bgm', 'sound'];

        for (const folder of folders) {
            try {
                this.resourceHandles[folder] = await this.dataHandle.getDirectoryHandle(folder);
            } catch {
                this.resourceHandles[folder] = null;
            }
        }
    }

    /**
     * ksファイルを再帰的に収集（systemフォルダを除外）
     */
    async collectKsFiles(dirHandle, files, path) {
        for await (const entry of dirHandle.values()) {
            if (entry.kind === 'file' && entry.name.endsWith('.ks')) {
                files.push({ handle: entry, relativePath: path + entry.name });
            } else if (entry.kind === 'directory' && entry.name !== 'system') {
                // systemフォルダは除外
                await this.collectKsFiles(entry, files, path + entry.name + '/');
            }
        }
    }

    /**
     * ファイル一覧を描画（時系列順、システムファイルは末尾で薄く表示）
     */
    renderFileList() {
        const container = document.getElementById('file-list');
        if (!container) return;

        const files = this.flowchart.getFileList();

        let html = '<table class="file-table">';
        html += '<thead><tr><th>ファイル名</th><th>クリック回数</th><th>画像</th><th>動画</th><th>BGM</th><th>SE</th></tr></thead>';
        html += '<tbody>';

        let lastWasStory = true;
        files.forEach(file => {
            // システムファイルの区切り
            if (lastWasStory && file.isSystem) {
                html += '<tr class="file-separator"><td colspan="6">--- システムファイル ---</td></tr>';
                lastWasStory = false;
            }

            const rowClass = file.isSystem ? 'file-row system-file' : 'file-row story-file';
            html += `<tr class="${rowClass}" data-filename="${file.filename}">`;
            html += `<td>${file.filename}</td>`;
            html += `<td>${file.clickCount}</td>`;
            html += `<td>${file.imageCount}</td>`;
            html += `<td>${file.videoCount}</td>`;
            html += `<td>${file.bgmCount}</td>`;
            html += `<td>${file.seCount}</td>`;
            html += '</tr>';
        });

        html += '</tbody></table>';
        container.innerHTML = html;

        // 行クリックイベント
        container.querySelectorAll('.file-row').forEach(row => {
            row.addEventListener('click', () => {
                const filename = row.dataset.filename;
                const data = this.flowchart.parsedFiles.get(filename);
                this.showFileDetails(filename, data);
            });
        });
    }

    /**
     * ファイル詳細を表示
     */
    async showFileDetails(filename, data) {
        const container = document.getElementById('file-details');
        if (!container || !data) return;

        let html = `<h3>${filename}</h3>`;
        html += `<p class="click-count">クリック数: ${data.clickCount}</p>`;

        // ラベル
        if (data.labels.length > 0) {
            html += '<div class="section"><h4>ラベル</h4><ul>';
            data.labels.forEach(label => {
                html += `<li>*${label.name} (行: ${label.line})</li>`;
            });
            html += '</ul></div>';
        }

        // 遷移先（jump）
        if (data.jumps.length > 0) {
            html += '<div class="section"><h4>ジャンプ先</h4><ul>';
            data.jumps.forEach(jump => {
                const target = jump.storage || '(同一ファイル)';
                const label = jump.target ? ` → ${jump.target}` : '';
                const cond = jump.cond ? ` [条件: ${jump.cond}]` : '';
                html += `<li>${target}${label}${cond}</li>`;
            });
            html += '</ul></div>';
        }

        // 選択肢（link/glink）
        if (data.links.length > 0) {
            html += '<div class="section"><h4>選択肢・リンク</h4><ul>';
            data.links.forEach(link => {
                const text = link.text ? `"${link.text}"` : link.type;
                const target = link.storage || '(同一ファイル)';
                const label = link.target ? ` → ${link.target}` : '';
                html += `<li>[${link.type}] ${text}: ${target}${label}</li>`;
            });
            html += '</ul></div>';
        }

        // 条件分岐
        if (data.branches.length > 0) {
            html += '<div class="section"><h4>条件分岐</h4><ul>';
            data.branches.forEach(branch => {
                html += `<li>[${branch.type}] ${branch.exp}</li>`;
            });
            html += '</ul></div>';
        }

        // 画像（プレビュー付き）
        if (data.images.length > 0) {
            html += '<div class="section"><h4>画像</h4><div class="resource-list">';
            for (const img of data.images) {
                html += await this.createImagePreviewHtml(img);
            }
            html += '</div></div>';
        }

        // BGM（再生ボタン付き）
        const bgmList = data.audio.filter(a => a.type === 'bgm' || a.type === 'playbgm');
        if (bgmList.length > 0) {
            html += '<div class="section"><h4>BGM</h4><div class="resource-list">';
            for (const audio of bgmList) {
                html += await this.createAudioPreviewHtml(audio);
            }
            html += '</div></div>';
        }

        // SE（再生ボタン付き）
        const seList = data.audio.filter(a => a.type !== 'bgm' && a.type !== 'playbgm');
        if (seList.length > 0) {
            html += '<div class="section"><h4>SE</h4><div class="resource-list">';
            for (const audio of seList) {
                html += await this.createAudioPreviewHtml(audio);
            }
            html += '</div></div>';
        }

        // 動画（再生ボタン付き）
        if (data.videos.length > 0) {
            html += '<div class="section"><h4>動画</h4><div class="resource-list">';
            for (const video of data.videos) {
                html += await this.createVideoPreviewHtml(video);
            }
            html += '</div></div>';
        }

        // テキスト（セリフ・ナレーション）
        if (data.dialogues && data.dialogues.length > 0) {
            html += '<div class="section"><h4>テキスト</h4><div class="dialogue-list">';
            for (const dialogue of data.dialogues) {
                const speakerClass = dialogue.speaker ? 'dialogue-speaker' : 'dialogue-narrator';
                const speakerName = dialogue.speaker || 'ナレーション';
                html += `<div class="dialogue-item">`;
                html += `<span class="${speakerClass}">${this.escapeHtml(speakerName)}</span>`;
                html += `<span class="dialogue-text">${this.escapeHtml(dialogue.text)}</span>`;
                html += `</div>`;
            }
            html += '</div></div>';
        }

        container.innerHTML = html;

        // ハイライト
        document.querySelectorAll('.file-row').forEach(row => {
            row.classList.remove('selected');
            if (row.dataset.filename === filename) {
                row.classList.add('selected');
            }
        });
    }

    /**
     * 画像プレビューHTMLを生成
     */
    async createImagePreviewHtml(img) {
        const storage = img.storage;
        if (!storage) {
            return `<div class="resource-item">
                <div class="resource-info">[${img.type}] (動的指定)</div>
            </div>`;
        }

        const blobUrl = await this.getResourceBlobUrl(storage, img.folder || 'fgimage');

        if (blobUrl) {
            return `<div class="resource-item">
                <div class="resource-preview">
                    <img src="${blobUrl}" alt="${storage}" class="preview-image"
                         onclick="window.app.showImageModal('${blobUrl}', '${storage}')">
                </div>
                <div class="resource-info">[${img.type}] ${storage}</div>
            </div>`;
        } else {
            return `<div class="resource-item">
                <div class="resource-preview no-preview">プレビュー不可</div>
                <div class="resource-info">[${img.type}] ${storage}</div>
            </div>`;
        }
    }

    /**
     * 音声プレビューHTMLを生成
     */
    async createAudioPreviewHtml(audio) {
        const storage = audio.storage;
        const folder = audio.type === 'bgm' ? 'bgm' : 'sound';
        const typeLabel = audio.type === 'bgm' ? 'BGM' : 'SE';

        const blobUrl = await this.getResourceBlobUrl(storage, folder);

        if (blobUrl) {
            return `<div class="resource-item audio-item">
                <div class="resource-preview">
                    <audio controls class="preview-audio">
                        <source src="${blobUrl}">
                    </audio>
                </div>
                <div class="resource-info">[${typeLabel}] ${storage}</div>
            </div>`;
        } else {
            return `<div class="resource-item">
                <div class="resource-preview no-preview">再生不可</div>
                <div class="resource-info">[${typeLabel}] ${storage}</div>
            </div>`;
        }
    }

    /**
     * 動画プレビューHTMLを生成
     */
    async createVideoPreviewHtml(video) {
        const storage = video.storage;

        const blobUrl = await this.getResourceBlobUrl(storage, 'video');

        if (blobUrl) {
            return `<div class="resource-item video-item">
                <div class="resource-preview">
                    <video controls class="preview-video">
                        <source src="${blobUrl}">
                    </video>
                </div>
                <div class="resource-info">[${video.type}] ${storage}</div>
            </div>`;
        } else {
            return `<div class="resource-item">
                <div class="resource-preview no-preview">再生不可</div>
                <div class="resource-info">[${video.type}] ${storage}</div>
            </div>`;
        }
    }

    /**
     * リソースファイルのBlob URLを取得
     */
    async getResourceBlobUrl(storagePath, folderType) {
        // キャッシュをチェック
        const cacheKey = `${folderType}/${storagePath}`;
        if (this.blobUrlCache.has(cacheKey)) {
            return this.blobUrlCache.get(cacheKey);
        }

        try {
            const folderHandle = this.resourceHandles[folderType];
            if (!folderHandle) return null;

            // パスを分解してファイルを取得
            const pathParts = storagePath.split('/');
            let currentHandle = folderHandle;

            for (let i = 0; i < pathParts.length - 1; i++) {
                currentHandle = await currentHandle.getDirectoryHandle(pathParts[i]);
            }

            const fileName = pathParts[pathParts.length - 1];
            const fileHandle = await currentHandle.getFileHandle(fileName);
            const file = await fileHandle.getFile();
            const blobUrl = URL.createObjectURL(file);

            // キャッシュに保存
            this.blobUrlCache.set(cacheKey, blobUrl);

            return blobUrl;
        } catch (error) {
            console.warn(`Resource not found: ${folderType}/${storagePath}`, error);
            return null;
        }
    }

    /**
     * Blobキャッシュをクリア
     */
    clearBlobCache() {
        for (const url of this.blobUrlCache.values()) {
            URL.revokeObjectURL(url);
        }
        this.blobUrlCache.clear();
    }

    /**
     * 画像モーダルを表示
     */
    showImageModal(blobUrl, filename) {
        const modal = document.getElementById('image-modal');
        const modalImage = document.getElementById('modal-image');
        const modalFilename = document.getElementById('modal-filename');
        const modalClose = modal.querySelector('.modal-close');

        if (!modal || !modalImage) return;

        // 画像とファイル名をセット
        modalImage.src = blobUrl;
        modalImage.alt = filename;
        if (modalFilename) {
            modalFilename.textContent = filename;
        }

        // モーダルを表示
        modal.classList.add('active');

        // 閉じるボタンのイベント
        const closeHandler = () => {
            modal.classList.remove('active');
            modalClose.removeEventListener('click', closeHandler);
        };
        modalClose.addEventListener('click', closeHandler);

        // 背景クリックで閉じる
        const backdropHandler = (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
                modal.removeEventListener('click', backdropHandler);
            }
        };
        modal.addEventListener('click', backdropHandler);

        // Escキーで閉じる
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                modal.classList.remove('active');
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    }

    /**
     * 更新
     */
    async refresh() {
        if (this.fileHandles.size === 0) {
            this.showError('先にフォルダを選択してください');
            return;
        }

        this.showLoading(true);
        this.flowchart.clear();
        this.clearBlobCache();

        try {
            for (const [filename, handle] of this.fileHandles) {
                const file = await handle.getFile();
                const content = await file.text();
                const parsed = this.parser.parse(content, filename);
                this.flowchart.addParsedFile(filename, parsed);
            }

            await this.flowchart.render('flowchart-container');

            // パン・ズームをSVGにアタッチ
            if (this.panZoom) {
                this.panZoom.attachToSvg();
            }

            this.renderFileList();
            this.updateStatus('更新しました');
        } catch (error) {
            console.error('Refresh error:', error);
            this.showError('更新に失敗しました');
        }

        this.showLoading(false);
    }

    /**
     * ローディング表示
     */
    showLoading(show) {
        const loader = document.getElementById('loading');
        if (loader) {
            loader.style.display = show ? 'flex' : 'none';
        }
    }

    /**
     * エラー表示
     */
    showError(message) {
        const status = document.getElementById('status-message');
        if (status) {
            status.textContent = message;
            status.classList.add('error');
            setTimeout(() => status.classList.remove('error'), 3000);
        }
    }

    /**
     * ステータス更新
     */
    updateStatus(message) {
        const status = document.getElementById('status-message');
        if (status) {
            status.textContent = message;
            status.classList.remove('error');
        }
    }

    /**
     * HTMLエスケープ
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * 検索を実行
     */
    performSearch() {
        const searchInput = document.getElementById('search-input');
        const query = searchInput.value.trim();

        if (!query) {
            this.showError('検索キーワードを入力してください');
            return;
        }

        if (this.flowchart.parsedFiles.size === 0) {
            this.showError('先にフォルダを読み込んでください');
            return;
        }

        const results = this.searchInFiles(query);
        this.showSearchResults(query, results);
    }

    /**
     * 全ファイルを検索
     */
    searchInFiles(query) {
        const results = [];
        const lowerQuery = query.toLowerCase();

        this.flowchart.parsedFiles.forEach((data, filename) => {
            // セリフ・ナレーションを検索
            if (data.dialogues) {
                data.dialogues.forEach(dialogue => {
                    if (dialogue.text.toLowerCase().includes(lowerQuery) ||
                        (dialogue.speaker && dialogue.speaker.toLowerCase().includes(lowerQuery))) {
                        results.push({
                            filename: filename,
                            type: 'dialogue',
                            speaker: dialogue.speaker,
                            text: dialogue.text,
                            line: dialogue.line
                        });
                    }
                });
            }

            // ラベルを検索
            data.labels.forEach(label => {
                if (label.name.toLowerCase().includes(lowerQuery)) {
                    results.push({
                        filename: filename,
                        type: 'label',
                        text: `*${label.name}`,
                        line: label.line
                    });
                }
            });

            // ジャンプ先を検索
            data.jumps.forEach(jump => {
                const jumpText = `${jump.storage || ''} ${jump.target || ''}`;
                if (jumpText.toLowerCase().includes(lowerQuery)) {
                    results.push({
                        filename: filename,
                        type: 'jump',
                        text: `[jump] → ${jump.storage || ''}${jump.target ? ' *' + jump.target : ''}`
                    });
                }
            });

            // 選択肢を検索
            data.links.forEach(link => {
                if ((link.text && link.text.toLowerCase().includes(lowerQuery)) ||
                    (link.storage && link.storage.toLowerCase().includes(lowerQuery))) {
                    results.push({
                        filename: filename,
                        type: 'link',
                        text: `[${link.type}] ${link.text || ''} → ${link.storage || ''}`
                    });
                }
            });
        });

        return results;
    }

    /**
     * 検索結果を表示
     */
    showSearchResults(query, results) {
        const modal = document.getElementById('search-modal');
        const queryDisplay = document.getElementById('search-query-display');
        const resultsContainer = document.getElementById('search-results');

        if (!modal || !resultsContainer) return;

        queryDisplay.textContent = `"${query}" (${results.length}件)`;

        if (results.length === 0) {
            resultsContainer.innerHTML = '<div class="search-no-results">検索結果がありません</div>';
        } else {
            let html = '';
            results.forEach((result, index) => {
                const highlightedText = this.highlightText(result.text, query);
                html += `<div class="search-result-item" data-index="${index}" data-filename="${result.filename}">`;
                html += `<div class="search-result-file">${result.filename}</div>`;
                if (result.speaker !== undefined) {
                    html += `<div class="search-result-speaker">${result.speaker || 'ナレーション'}</div>`;
                }
                html += `<div class="search-result-text">${highlightedText}</div>`;
                html += `</div>`;
            });
            resultsContainer.innerHTML = html;

            // クリックでファイル詳細を表示
            resultsContainer.querySelectorAll('.search-result-item').forEach(item => {
                item.addEventListener('click', () => {
                    const filename = item.dataset.filename;
                    const data = this.flowchart.parsedFiles.get(filename);
                    if (data) {
                        this.showFileDetails(filename, data);
                        modal.classList.remove('active');
                    }
                });
            });
        }

        modal.classList.add('active');
    }

    /**
     * テキスト内のキーワードをハイライト
     */
    highlightText(text, query) {
        const escaped = this.escapeHtml(text);
        const regex = new RegExp(`(${this.escapeRegex(query)})`, 'gi');
        return escaped.replace(regex, '<mark>$1</mark>');
    }

    /**
     * 正規表現用エスケープ
     */
    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * タイムラインをビルドして描画
     */
    async buildAndRenderTimeline() {
        // タイムラインプロセッサをクリア
        this.timeline.clear();

        // トラック選択をリセット（最初のトラックが自動選択される）
        this.selectedTrackId = null;
        this.selectedTrackType = null;

        if (this.flowchart.parsedFiles.size === 0) {
            const tracksContainer = document.getElementById('timeline-tracks');
            if (tracksContainer) {
                tracksContainer.innerHTML = '<div class="timeline-empty">フォルダを読み込んでください</div>';
            }
            return;
        }

        // ストーリーファイルを時系列順に取得して処理
        const storyFiles = this.flowchart.getSortedStoryFiles();

        console.log('=== Building Timeline ===');
        console.log(`Processing ${storyFiles.length} story files...`);

        for (const { filename, data } of storyFiles) {
            // ファイル内容を取得
            const handle = this.fileHandles.get(filename);
            if (handle) {
                try {
                    const file = await handle.getFile();
                    const content = await file.text();
                    this.fileContents.set(filename, content);

                    // [p]タグと@pコマンドの数をカウント（デバッグ用）
                    const bracketPCount = (content.match(/\[p(?:\s[^\]]*)?]/gi) || []).length;
                    const atPCount = (content.match(/^@p(?:\s|$)/gim) || []).length;
                    const timeBeforeFile = this.timeline.currentTime;

                    // TimelineProcessorで処理
                    this.timeline.processFile(content, filename);

                    console.log(`  ${filename}: [p]=${bracketPCount} @p=${atPCount}, time ${timeBeforeFile}→${this.timeline.currentTime}`);
                } catch (error) {
                    console.warn(`Failed to read file: ${filename}`, error);
                }
            }
        }

        // 処理を完了（未終了イベントを閉じる）
        this.timeline.finalize();

        // 統計を更新
        this.updateTimelineStats();

        // トラックを描画
        this.renderTimelineTracks();

        // 再生ヘッドを先頭に
        this.setPlayheadTime(0);
    }

    /**
     * タイムライン統計を更新
     */
    updateTimelineStats() {
        const stats = this.timeline.getStats();
        const statsEl = document.getElementById('timeline-stats');
        if (statsEl) {
            statsEl.textContent = `トラック: ${stats.trackCount} | イベント: ${stats.totalEvents} | 総時間: ${stats.totalTime} [p]`;
        }
    }

    /**
     * タイムライントラックを描画
     */
    renderTimelineTracks() {
        const tracksContainer = document.getElementById('timeline-tracks');
        const rulerContent = document.getElementById('ruler-content');

        if (!tracksContainer) return;

        tracksContainer.innerHTML = '';
        if (rulerContent) rulerContent.innerHTML = '';

        const trackList = this.timeline.getTrackList();

        if (trackList.length === 0) {
            tracksContainer.innerHTML = '<div class="timeline-empty">タイムラインデータがありません</div>';
            return;
        }

        // デバッグ: レンダリング設定を出力
        console.log('=== Render Timeline Tracks ===');
        console.log(`pixelsPerUnit: ${this.pixelsPerUnit}, timelineZoom: ${this.timelineZoom}%`);
        console.log(`totalTime: ${this.timeline.totalTime}, tracks: ${trackList.length}`);

        // 総時間からタイムラインの幅を計算
        const totalWidth = this.timeToPixel(this.timeline.totalTime) + 100;
        console.log(`totalWidth: ${totalWidth}px`);

        // ルーラーを生成
        if (rulerContent) {
            this.renderRuler(rulerContent, this.timeline.totalTime);
        }

        // 各トラックを生成
        trackList.forEach(track => {
            const trackEl = this.createTrackElement(track, totalWidth);
            tracksContainer.appendChild(trackEl);
        });

        // 再生ヘッドの表示を更新
        this.updatePlayheadVisual();
    }

    /**
     * ルーラーを生成
     */
    renderRuler(container, totalTime) {
        container.innerHTML = '';

        // 目盛り間隔を計算（ズームに応じて調整）
        let interval = 1;
        if (this.timelineZoom < 50) interval = 10;
        else if (this.timelineZoom < 100) interval = 5;
        else if (this.timelineZoom > 200) interval = 1;
        else interval = 2;

        for (let t = 0; t <= totalTime; t += interval) {
            const marker = document.createElement('div');
            marker.className = 'ruler-marker';
            marker.style.left = `${this.timeToPixel(t)}px`;

            // 5の倍数は大きめのマーカー
            if (t % 5 === 0) {
                marker.classList.add('major');
                marker.innerHTML = `<span>${t}</span>`;
            }

            container.appendChild(marker);
        }

        container.style.width = `${this.timeToPixel(totalTime) + 100}px`;
    }

    /**
     * トラック要素を作成
     */
    createTrackElement(track, totalWidth) {
        const trackEl = document.createElement('div');
        trackEl.className = 'timeline-track';
        trackEl.dataset.trackId = track.id;
        trackEl.dataset.trackType = track.type;

        // トラックラベル
        const label = document.createElement('div');
        label.className = 'track-label';
        label.textContent = track.name;

        // 最初のトラックを自動選択
        if (!this.selectedTrackId) {
            this.selectedTrackId = track.id;
            this.selectedTrackType = track.type;
            label.classList.add('selected');
        } else if (this.selectedTrackId === track.id) {
            label.classList.add('selected');
        }

        label.addEventListener('click', () => {
            // 選択状態を更新
            document.querySelectorAll('.track-label').forEach(l => l.classList.remove('selected'));
            label.classList.add('selected');

            // 選択トラックを記憶
            this.selectedTrackId = track.id;
            this.selectedTrackType = track.type;

            // 現在の再生ヘッド位置でプレビューを更新
            this.updatePreviewAtTime(this.playheadTime);
        });
        trackEl.appendChild(label);

        // トラックコンテンツ（クリップ配置エリア）
        const content = document.createElement('div');
        content.className = 'track-content';
        content.style.width = `${totalWidth}px`;

        // クリップを配置
        track.events.forEach(event => {
            const clip = this.createClipElement(event, track);
            content.appendChild(clip);
        });

        trackEl.appendChild(content);
        return trackEl;
    }

    /**
     * クリップ要素を作成
     */
    createClipElement(event, track) {
        const clip = document.createElement('div');
        clip.className = 'timeline-clip';
        clip.dataset.type = event.type;

        // デバッグ用データ属性
        clip.dataset.startTime = event.startTime;
        clip.dataset.endTime = event.endTime;

        // 位置とサイズを計算（NaN対策）
        const startTime = typeof event.startTime === 'number' ? event.startTime : 0;
        const endTime = typeof event.endTime === 'number' ? event.endTime : startTime + 0.5;
        const left = this.timeToPixel(startTime);
        const duration = Math.max(endTime - startTime, 0.5); // 最小0.5単位
        const width = Math.max(this.timeToPixel(duration), 20);

        clip.style.left = `${left}px`;
        clip.style.width = `${width}px`;

        // クリップ内容
        let title = '';
        let subtitle = '';

        switch (event.type) {
            case 'text':
                title = event.speaker || 'ナレーション';
                subtitle = event.text.substring(0, 30) + (event.text.length > 30 ? '...' : '');
                break;
            case 'bg':
                title = '背景';
                subtitle = event.storage || '';
                break;
            case 'image':
                title = `画像 L${event.layer}`;
                subtitle = event.storage || '';
                break;
            case 'chara':
                title = event.name;
                subtitle = event.face || '';
                break;
            case 'video':
                title = '動画';
                subtitle = event.storage || '';
                break;
            case 'bgm':
                title = 'BGM';
                subtitle = event.storage || '';
                break;
            case 'se':
                title = 'SE';
                subtitle = event.storage || '';
                break;
        }

        clip.innerHTML = `
            <div class="clip-title">${this.escapeHtml(title)}</div>
            <div class="clip-subtitle">${this.escapeHtml(subtitle)}</div>
        `;

        // クリックでプレビューとトラック選択
        clip.addEventListener('click', (e) => {
            e.stopPropagation();

            // クリップ選択状態を更新
            document.querySelectorAll('.timeline-clip').forEach(c => c.classList.remove('selected'));
            clip.classList.add('selected');

            // トラック選択状態も更新
            document.querySelectorAll('.track-label').forEach(l => l.classList.remove('selected'));
            const trackEl = clip.closest('.timeline-track');
            if (trackEl) {
                const label = trackEl.querySelector('.track-label');
                if (label) label.classList.add('selected');
            }

            // 選択トラックを記憶
            this.selectedTrackId = track.id;
            this.selectedTrackType = track.type;

            // プレビューを表示
            this.showEventPreview(event);

            // 再生ヘッドをクリップの開始位置に移動
            this.setPlayheadTime(event.startTime);
        });

        return clip;
    }
}

// アプリ起動
document.addEventListener('DOMContentLoaded', () => {
    // Mermaidの初期化
    mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        flowchart: {
            useMaxWidth: false,
            htmlLabels: true,
            curve: 'basis',
            nodeSpacing: 50,
            rankSpacing: 80,
            padding: 20
        },
        themeVariables: {
            primaryColor: '#3c3c3c',
            primaryTextColor: '#d4d4d4',
            primaryBorderColor: '#0e639c',
            lineColor: '#808080',
            secondaryColor: '#2d2d2d',
            tertiaryColor: '#252526'
        }
    });

    // アプリ起動
    window.app = new TyranoFlowApp();
});
