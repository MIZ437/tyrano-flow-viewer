/**
 * TyranoFlow Viewer - Main Application
 */

class TyranoFlowApp {
    constructor() {
        this.parser = new TyranoParser();
        this.flowchart = new FlowchartGenerator();
        this.currentProjectPath = null;
        this.fileHandles = new Map();

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

        if (tabFlowchart && tabTimeline) {
            tabFlowchart.addEventListener('click', () => {
                tabFlowchart.classList.add('active');
                tabTimeline.classList.remove('active');
                dropZone.classList.add('active');
                timelineView.classList.remove('active');
            });

            tabTimeline.addEventListener('click', () => {
                tabTimeline.classList.add('active');
                tabFlowchart.classList.remove('active');
                timelineView.classList.add('active');
                dropZone.classList.remove('active');
                // タイムラインを描画
                this.renderTimeline();
            });
        }
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
     * タイムラインを描画
     */
    renderTimeline() {
        const trackText = document.getElementById('track-text');
        const trackImage = document.getElementById('track-image');
        const trackVideo = document.getElementById('track-video');
        const trackBgm = document.getElementById('track-bgm');
        const trackSe = document.getElementById('track-se');

        if (!trackText) return;

        // トラックをクリア
        trackText.innerHTML = '';
        trackImage.innerHTML = '';
        trackVideo.innerHTML = '';
        trackBgm.innerHTML = '';
        trackSe.innerHTML = '';

        if (this.flowchart.parsedFiles.size === 0) {
            trackText.innerHTML = '<div class="timeline-empty">フォルダを読み込んでください</div>';
            return;
        }

        // ストーリーファイルを時系列順に取得
        const storyFiles = this.flowchart.getSortedStoryFiles();

        // クリップ幅の基準を計算（最小幅60px、クリック数に応じて拡大）
        const minWidth = 80;
        const widthPerClick = 3;

        storyFiles.forEach(({ filename, data }) => {
            const clickCount = data.clickCount || 1;
            const clipWidth = Math.max(minWidth, clickCount * widthPerClick);

            // テキストトラック - ファイル単位でクリップを作成
            const textClip = this.createTimelineClip(filename, data, 'text', clipWidth);
            trackText.appendChild(textClip);

            // 画像トラック
            if (data.images.length > 0) {
                const imageClip = this.createTimelineClip(filename, data, 'image', clipWidth, `${data.images.length}枚`);
                trackImage.appendChild(imageClip);
            } else {
                trackImage.appendChild(this.createEmptyClip(clipWidth));
            }

            // 動画トラック
            if (data.videos.length > 0) {
                const videoClip = this.createTimelineClip(filename, data, 'video', clipWidth, `${data.videos.length}本`);
                trackVideo.appendChild(videoClip);
            } else {
                trackVideo.appendChild(this.createEmptyClip(clipWidth));
            }

            // BGMトラック
            const bgmList = data.audio.filter(a => a.type === 'bgm' || a.type === 'playbgm');
            if (bgmList.length > 0) {
                const bgmClip = this.createTimelineClip(filename, data, 'bgm', clipWidth, `${bgmList.length}曲`);
                trackBgm.appendChild(bgmClip);
            } else {
                trackBgm.appendChild(this.createEmptyClip(clipWidth));
            }

            // SEトラック
            const seList = data.audio.filter(a => a.type !== 'bgm' && a.type !== 'playbgm');
            if (seList.length > 0) {
                const seClip = this.createTimelineClip(filename, data, 'se', clipWidth, `${seList.length}個`);
                trackSe.appendChild(seClip);
            } else {
                trackSe.appendChild(this.createEmptyClip(clipWidth));
            }
        });
    }

    /**
     * タイムラインクリップを作成
     */
    createTimelineClip(filename, data, trackType, width, info = null) {
        const clip = document.createElement('div');
        clip.className = 'timeline-clip';
        clip.dataset.track = trackType;
        clip.dataset.filename = filename;
        clip.style.width = `${width}px`;

        const title = document.createElement('div');
        title.className = 'clip-title';
        title.textContent = filename.replace('.ks', '');
        clip.appendChild(title);

        const infoText = document.createElement('div');
        infoText.className = 'clip-info';
        if (trackType === 'text') {
            infoText.textContent = `${data.clickCount}クリック`;
        } else if (info) {
            infoText.textContent = info;
        }
        clip.appendChild(infoText);

        // クリックでファイル詳細を表示
        clip.addEventListener('click', () => {
            // 選択状態を更新
            document.querySelectorAll('.timeline-clip').forEach(c => c.classList.remove('selected'));
            clip.classList.add('selected');
            // ファイル詳細を表示
            this.showFileDetails(filename, data);
        });

        return clip;
    }

    /**
     * 空のクリップ（プレースホルダー）を作成
     */
    createEmptyClip(width) {
        const clip = document.createElement('div');
        clip.style.width = `${width}px`;
        clip.style.flexShrink = '0';
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
