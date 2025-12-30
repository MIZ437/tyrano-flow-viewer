/**
 * Flowchart Generator
 * 解析結果からMermaid.jsのフローチャートを生成
 */

class FlowchartGenerator {
    constructor() {
        this.parsedFiles = new Map();
        this.renderCount = 0; // ユニークID用カウンター

        // システムファイルのパターン（フローチャートから除外）
        this.systemFilePatterns = [
            /^_/,           // アンダースコア始まり
            /^config\.ks$/i,
            /^make\.ks$/i,
            /^cg\.ks$/i,
            /^scene\d*\.ks$/i,
            /^replay/i,
            /^first\.ks$/i,
            /^save\.ks$/i,
            /^load\.ks$/i,
            /^backlog\.ks$/i,
            /^menu\.ks$/i
        ];
    }

    /**
     * システムファイルかどうか判定
     */
    isSystemFile(filename) {
        return this.systemFilePatterns.some(pattern => pattern.test(filename));
    }

    /**
     * ファイル名からソート用の優先度を取得（ゲーム時系列順）
     */
    getFileSortPriority(filename) {
        const lower = filename.toLowerCase();

        // タイトル画面（最上位）
        if (lower.includes('title')) {
            return { order: 10, sub: 0 };
        }

        // プロローグ
        if (lower.includes('prologue') || lower.includes('prolog')) {
            const match = lower.match(/(\d+)/);
            return { order: 100, sub: match ? parseInt(match[1]) : 0 };
        }

        // チャプター（chapter1-01, chapter1-02, chapter2-01 など）
        const chapterMatch = lower.match(/chapter(\d+)[_-]?(\d*)/);
        if (chapterMatch) {
            const chapter = parseInt(chapterMatch[1]) || 0;
            const scene = parseInt(chapterMatch[2]) || 0;
            return { order: 200 + chapter * 100, sub: scene };
        }

        // エピローグ
        if (lower.includes('epilogue') || lower.includes('epilog')) {
            const match = lower.match(/(\d+)/);
            return { order: 9000, sub: match ? parseInt(match[1]) : 0 };
        }

        // エンディング
        if (lower.includes('ending') || lower.includes('end')) {
            const match = lower.match(/(\d+)/);
            return { order: 9500, sub: match ? parseInt(match[1]) : 0 };
        }

        // その他（シーン番号があれば使用）
        const numMatch = lower.match(/(\d+)/);
        if (numMatch) {
            return { order: 500, sub: parseInt(numMatch[1]) };
        }

        return { order: 1000, sub: 0 };
    }

    /**
     * ストーリーファイルを時系列順にソート
     */
    getSortedStoryFiles() {
        const storyFiles = [];

        this.parsedFiles.forEach((data, filename) => {
            if (!this.isSystemFile(filename)) {
                const priority = this.getFileSortPriority(filename);
                storyFiles.push({ filename, data, priority });
            }
        });

        // 時系列順にソート
        storyFiles.sort((a, b) => {
            if (a.priority.order !== b.priority.order) {
                return a.priority.order - b.priority.order;
            }
            return a.priority.sub - b.priority.sub;
        });

        return storyFiles;
    }

    /**
     * 解析結果を登録
     */
    addParsedFile(filename, data) {
        this.parsedFiles.set(filename, data);
    }

    /**
     * 全ファイルをクリア
     */
    clear() {
        this.parsedFiles.clear();
    }

    /**
     * ファイル名を安全なID形式に変換
     */
    sanitizeId(filename) {
        // 先頭にプレフィックスを付けて数字始まりを防ぐ
        return 'node_' + filename
            .replace(/\.ks$/i, '')
            .replace(/[^a-zA-Z0-9]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_+|_+$/g, '');
    }

    /**
     * ラベルをエスケープ（HTMLタグを除去）
     */
    escapeLabel(text) {
        return text
            // HTMLタグを除去
            .replace(/<[^>]*>/g, '')
            // 特殊文字をエスケープ
            .replace(/"/g, "'")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    /**
     * Mermaid記法のフローチャートを生成
     */
    generateMermaidCode() {
        const storyFiles = this.getSortedStoryFiles();

        if (storyFiles.length === 0) {
            return 'graph TD\n    empty[ストーリーファイルがありません]';
        }

        // 上から下へ流れるグラフ（縦長）
        let mermaid = 'graph TD\n';
        const connections = new Set();
        const storyFileNames = new Set(storyFiles.map(f => f.filename));

        // 各ファイルのノードと接続を生成（時系列順）
        storyFiles.forEach(({ filename, data }) => {
            const nodeId = this.sanitizeId(filename);
            const clickCount = data.clickCount || 0;
            // ラベルを安全にエスケープ
            const label = this.escapeLabel(`${filename}\n${clickCount}クリック`);

            mermaid += `    ${nodeId}["${label}"]\n`;

            // jumpによる遷移（ストーリーファイルへのみ）
            data.jumps.forEach(jump => {
                if (jump.storage && storyFileNames.has(jump.storage)) {
                    const targetId = this.sanitizeId(jump.storage);
                    const connectionKey = `${nodeId}->${targetId}`;
                    if (!connections.has(connectionKey)) {
                        connections.add(connectionKey);
                        if (jump.cond) {
                            mermaid += `    ${nodeId} -->|条件付き| ${targetId}\n`;
                        } else {
                            mermaid += `    ${nodeId} --> ${targetId}\n`;
                        }
                    }
                }
            });

            // callによる遷移（ストーリーファイルへのみ）
            data.calls.forEach(call => {
                if (call.storage && storyFileNames.has(call.storage)) {
                    const targetId = this.sanitizeId(call.storage);
                    const connectionKey = `${nodeId}-.call.->${targetId}`;
                    if (!connections.has(connectionKey)) {
                        connections.add(connectionKey);
                        mermaid += `    ${nodeId} -.->|call| ${targetId}\n`;
                    }
                }
            });

            // linkによる遷移（ストーリーファイルへのみ）
            data.links.forEach(link => {
                if (link.storage && storyFileNames.has(link.storage)) {
                    const targetId = this.sanitizeId(link.storage);
                    const connectionKey = `${nodeId}->${targetId}-link`;
                    if (!connections.has(connectionKey)) {
                        connections.add(connectionKey);
                        const linkLabel = link.text ? this.escapeLabel(link.text.substring(0, 8)) : link.type;
                        mermaid += `    ${nodeId} -->|${linkLabel}| ${targetId}\n`;
                    }
                }
            });
        });

        // スタイル定義
        mermaid += '\n    %% スタイル\n';
        mermaid += '    classDef default fill:#3c3c3c,stroke:#0e639c,stroke-width:2px,color:#d4d4d4;\n';

        return mermaid;
    }

    /**
     * フローチャートを描画
     */
    async render(containerId) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.error('Container not found:', containerId);
            return;
        }

        const mermaidCode = this.generateMermaidCode();

        try {
            // ユニークなIDを生成（Mermaidは同じIDを再利用できない）
            this.renderCount++;
            const svgId = `flowchart-svg-${this.renderCount}`;

            // Mermaidで描画
            const { svg } = await mermaid.render(svgId, mermaidCode);
            container.innerHTML = svg;

            // SVGをスクロール可能にするためにスタイル調整
            const svgElement = container.querySelector('svg');
            if (svgElement) {
                svgElement.style.maxWidth = 'none';
                svgElement.style.height = 'auto';
            }

            // ノードにクリックイベントを追加
            this.attachClickEvents(container);
        } catch (error) {
            console.error('Mermaid render error:', error);
            console.error('Mermaid code:', mermaidCode);
            container.innerHTML = `<pre class="error">フローチャート生成エラー:\n${error.message}\n\nコード:\n${mermaidCode}</pre>`;
        }
    }

    /**
     * ノードにクリックイベントを追加
     */
    attachClickEvents(container) {
        const nodes = container.querySelectorAll('.node');
        nodes.forEach(node => {
            node.style.cursor = 'pointer';
            node.addEventListener('click', (e) => {
                const nodeId = node.id;
                // ノードIDからファイル名を逆引き
                const filename = this.findFilenameByNodeId(nodeId);
                if (filename) {
                    // カスタムイベントを発火
                    const event = new CustomEvent('nodeClick', {
                        detail: { filename, data: this.parsedFiles.get(filename) }
                    });
                    document.dispatchEvent(event);
                }
            });
        });
    }

    /**
     * ノードIDからファイル名を逆引き
     */
    findFilenameByNodeId(nodeId) {
        // nodeIdは "flowchart-xxx-0" のような形式
        for (const [filename, data] of this.parsedFiles) {
            const sanitizedName = this.sanitizeId(filename);
            if (nodeId.includes(sanitizedName)) {
                return filename;
            }
        }
        return null;
    }

    /**
     * ファイル一覧を取得（時系列順、システムファイルは末尾）
     */
    getFileList() {
        const storyFiles = [];
        const systemFiles = [];

        this.parsedFiles.forEach((data, filename) => {
            // BGMとSEを分けてカウント
            const bgmCount = data.audio.filter(a => a.type === 'bgm' || a.type === 'playbgm').length;
            const seCount = data.audio.filter(a => a.type !== 'bgm' && a.type !== 'playbgm').length;

            const fileInfo = {
                filename,
                clickCount: data.clickCount,
                jumpCount: data.jumps.length,
                imageCount: data.images.length,
                bgmCount: bgmCount,
                seCount: seCount,
                videoCount: data.videos.length,
                isSystem: this.isSystemFile(filename),
                priority: this.getFileSortPriority(filename)
            };

            if (fileInfo.isSystem) {
                systemFiles.push(fileInfo);
            } else {
                storyFiles.push(fileInfo);
            }
        });

        // ストーリーファイルは時系列順
        storyFiles.sort((a, b) => {
            if (a.priority.order !== b.priority.order) {
                return a.priority.order - b.priority.order;
            }
            return a.priority.sub - b.priority.sub;
        });

        // システムファイルはアルファベット順
        systemFiles.sort((a, b) => a.filename.localeCompare(b.filename));

        // ストーリーファイルの後にシステムファイル
        return [...storyFiles, ...systemFiles];
    }
}

// グローバルに公開
window.FlowchartGenerator = FlowchartGenerator;
