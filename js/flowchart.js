/**
 * Flowchart Generator
 * 解析結果からMermaid.jsのフローチャートを生成
 */

class FlowchartGenerator {
    constructor() {
        this.parsedFiles = new Map();
        this.renderCount = 0; // ユニークID用カウンター
        this.storySummary = {}; // ストーリー要約（story-summary.jsonから読み込み）
        this.displayMode = 'simple'; // 'simple' | 'detail'

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
     * 表示モードを設定
     */
    setDisplayMode(mode) {
        this.displayMode = mode;
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
     * ストーリー要約を設定
     */
    setStorySummary(summary) {
        this.storySummary = summary || {};
    }

    /**
     * ストーリー要約JSONファイルを読み込み
     * @param {FileSystemDirectoryHandle} dirHandle - プロジェクトのディレクトリハンドル
     */
    async loadStorySummaryFromDir(dirHandle) {
        try {
            const fileHandle = await dirHandle.getFileHandle('story-summary.json');
            const file = await fileHandle.getFile();
            const content = await file.text();
            this.storySummary = JSON.parse(content);
            console.log('Loaded story summary:', Object.keys(this.storySummary).length, 'entries');
            return true;
        } catch (error) {
            // ファイルが存在しない場合は空のオブジェクトのまま
            console.log('No story-summary.json found, using filenames as labels');
            this.storySummary = {};
            return false;
        }
    }

    /**
     * ファイル名に対応する要約ラベルを取得
     */
    getSummaryLabel(filename) {
        return this.storySummary[filename] || null;
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
            // Mermaidの特殊文字をエスケープ
            .replace(/"/g, "'")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\[/g, "&#91;")
            .replace(/\]/g, "&#93;")
            .replace(/\{/g, "&#123;")
            .replace(/\}/g, "&#125;");
    }

    /**
     * 簡易表示用のラベルを生成（ファイル名のみ）
     */
    generateSimpleLabel(filename, data) {
        // ファイル名をそのまま表示
        return this.escapeLabel(filename);
    }

    /**
     * 詳細表示用のラベルを生成
     */
    generateDetailLabel(filename, data) {
        const summaryData = this.getSummaryLabel(filename);

        let lines = [filename];

        if (summaryData && typeof summaryData === 'object') {
            // 舞台
            if (summaryData.scene) {
                lines.push(`舞台：${summaryData.scene}`);
            }

            // 登場人物（全員表示）
            if (summaryData.characters && summaryData.characters.length > 0) {
                summaryData.characters.forEach(c => {
                    lines.push(`登場人物：${c.name}`);
                });
            }

            // 状況（summary）
            if (summaryData.summary) {
                lines.push(`状況：${summaryData.summary}`);
            }

            // ユーザーに与える感情
            if (summaryData.emotion) {
                lines.push(`ユーザーに与える感情：${summaryData.emotion}`);
            }
        } else if (summaryData && typeof summaryData === 'string') {
            lines.push(`状況：${summaryData}`);
        }

        return this.escapeLabel(lines.join('\\n'));
    }

    /**
     * Mermaid記法のフローチャートを生成
     */
    generateMermaidCode() {
        const storyFiles = this.getSortedStoryFiles();

        if (storyFiles.length === 0) {
            return 'flowchart TD\n    empty[ストーリーファイルがありません]';
        }

        // 上から下へ流れるグラフ（縦長）
        let mermaid = 'flowchart TD\n';
        const connections = new Set();
        const storyFileNames = new Set(storyFiles.map(f => f.filename));

        // 各ファイルのノードと接続を生成（時系列順）
        storyFiles.forEach(({ filename, data }) => {
            const nodeId = this.sanitizeId(filename);

            // 表示モードに応じてラベルを生成
            const label = this.displayMode === 'detail'
                ? this.generateDetailLabel(filename, data)
                : this.generateSimpleLabel(filename, data);

            mermaid += `    ${nodeId}["${label}"]\n`;

            // jumpによる遷移（ストーリーファイルへのみ）
            data.jumps.forEach(jump => {
                if (jump.storage && storyFileNames.has(jump.storage)) {
                    const targetId = this.sanitizeId(jump.storage);
                    const connectionKey = `${nodeId}->${targetId}`;
                    if (!connections.has(connectionKey)) {
                        connections.add(connectionKey);
                        // タイトルへの遷移は太矢印（ラベルなし）
                        const isToTitle = jump.storage.toLowerCase().includes('title');
                        if (isToTitle) {
                            mermaid += `    ${nodeId} ==> ${targetId}\n`;
                        } else if (jump.cond) {
                            const condLabel = this.escapeLabel(jump.cond);
                            mermaid += `    ${nodeId} -->|${condLabel}| ${targetId}\n`;
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
                        // タイトルへの遷移、またはラベルに「タイトル」「戻る」を含む場合はラベルなし＆太矢印
                        const isToTitle = link.storage.toLowerCase().includes('title');
                        const labelHasTitle = link.text && (link.text.includes('タイトル') || link.text.includes('戻る'));
                        if (isToTitle || labelHasTitle) {
                            mermaid += `    ${nodeId} ==> ${targetId}\n`;
                        } else {
                            const linkLabel = link.text ? this.escapeLabel(link.text) : '選択';
                            mermaid += `    ${nodeId} -->|${linkLabel}| ${targetId}\n`;
                        }
                    }
                }
            });
        });

        // スタイル定義
        mermaid += '\n    %% スタイル\n';
        mermaid += '    classDef default fill:#3c3c3c,stroke:#0e639c,stroke-width:2px,color:#d4d4d4;\n';

        // デバッグ：生成されたMermaidコードを出力
        console.log('=== Generated Mermaid Code ===');
        console.log(mermaid);
        console.log('=== End Mermaid Code ===');

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
        console.log('Mermaid code length:', mermaidCode.length);

        try {
            // ユニークなIDを生成（Mermaidは同じIDを再利用できない）
            this.renderCount++;
            const svgId = `flowchart-svg-${this.renderCount}`;

            // Mermaidで描画
            const { svg } = await mermaid.render(svgId, mermaidCode);
            container.innerHTML = svg;

            // SVGのスタイル調整
            const svgElement = container.querySelector('svg');
            if (svgElement) {
                // viewBoxはそのまま維持（Mermaidのレイアウトを尊重）
                svgElement.style.maxWidth = 'none';
                svgElement.style.maxHeight = 'none';
                svgElement.style.overflow = 'visible';

                // ノードのサイズを統一
                this.equalizeNodeSizes(svgElement);

                // タイトルへ戻る線を太くする
                this.styleBackEdge(svgElement);
            }

            // ノードにクリックイベントを追加
            this.attachClickEvents(container);
        } catch (error) {
            console.error('Mermaid render error:', error);
            console.error('Mermaid code:', mermaidCode);
            container.innerHTML = `<pre class="error">フローチャート生成エラー:\n${error.message}</pre>`;
        }
    }

    /**
     * ノードのサイズを統一（最大サイズに合わせる）
     */
    equalizeNodeSizes(svgElement) {
        const nodes = svgElement.querySelectorAll('.node');
        if (nodes.length === 0) return;

        // 全ノードのrect要素を収集し、最大幅・最大高さを計算
        let maxWidth = 0;
        let maxHeight = 0;
        const nodeData = [];

        nodes.forEach(node => {
            const rect = node.querySelector('rect');
            if (rect) {
                const width = parseFloat(rect.getAttribute('width')) || 0;
                const height = parseFloat(rect.getAttribute('height')) || 0;
                if (width > maxWidth) maxWidth = width;
                if (height > maxHeight) maxHeight = height;
                nodeData.push({ node, rect });
            }
        });

        // 全ノードを最大サイズに統一（追加マージンを含む）
        const extraPadding = 40; // 追加の余白
        maxWidth += extraPadding;
        maxHeight += extraPadding;

        if (maxWidth > 0 && maxHeight > 0) {
            nodeData.forEach(({ node, rect }) => {
                const currentWidth = parseFloat(rect.getAttribute('width')) || 0;
                const currentHeight = parseFloat(rect.getAttribute('height')) || 0;
                const widthDiff = maxWidth - currentWidth;
                const heightDiff = maxHeight - currentHeight;

                // rectの現在位置
                const currentX = parseFloat(rect.getAttribute('x')) || 0;
                const currentY = parseFloat(rect.getAttribute('y')) || 0;

                // rectの新しい位置（中央を維持）
                const newRectX = currentX - widthDiff / 2;
                const newRectY = currentY - heightDiff / 2;

                // rectのサイズと位置を更新
                rect.setAttribute('width', maxWidth);
                rect.setAttribute('height', maxHeight);
                rect.setAttribute('x', newRectX);
                rect.setAttribute('y', newRectY);

                // labelグループ（foreignObjectの親）を取得
                const labelGroup = node.querySelector('g.label');
                if (labelGroup) {
                    // labelグループのtransformをrectの左上に合わせる
                    labelGroup.setAttribute('transform', `translate(${newRectX}, ${newRectY})`);

                    // foreignObjectをlabelグループ内で(0,0)から開始し、rect全体をカバー
                    const foreignObject = labelGroup.querySelector('foreignObject');
                    if (foreignObject) {
                        foreignObject.setAttribute('x', 0);
                        foreignObject.setAttribute('y', 0);
                        foreignObject.setAttribute('width', maxWidth);
                        foreignObject.setAttribute('height', maxHeight);

                        // 内部のdivを中央揃え
                        const outerDiv = foreignObject.querySelector('div');
                        if (outerDiv) {
                            outerDiv.style.cssText = `
                                display: flex !important;
                                align-items: center !important;
                                justify-content: center !important;
                                width: ${maxWidth}px !important;
                                height: ${maxHeight}px !important;
                                text-align: center !important;
                                box-sizing: border-box !important;
                                padding: 15px !important;
                                line-height: 1.4 !important;
                            `;

                            // 内部のspan(nodeLabel)
                            const nodeLabel = outerDiv.querySelector('.nodeLabel, span');
                            if (nodeLabel) {
                                nodeLabel.style.cssText = `
                                    text-align: center !important;
                                    display: block !important;
                                    width: 100% !important;
                                `;
                            }
                        }
                    }
                }
            });
        }
    }

    /**
     * 全ての線のスタイルを整える
     */
    styleBackEdge(svgElement) {
        // Mermaidが生成したマーカーを探す
        const markers = svgElement.querySelectorAll('marker');
        let mermaidMarkerId = null;

        markers.forEach(marker => {
            const id = marker.getAttribute('id') || '';
            if (id.includes('flowchart') && id.includes('pointEnd')) {
                mermaidMarkerId = id;
                // マーカーのサイズを調整
                marker.setAttribute('markerWidth', '12');
                marker.setAttribute('markerHeight', '12');
                marker.setAttribute('refX', '10');
                marker.setAttribute('refY', '6');
            }
        });

        console.log('Mermaidマーカー:', mermaidMarkerId);

        // flowchart-linkクラスを持つパス（エッジ）を取得
        const edgePaths = svgElement.querySelectorAll('path.flowchart-link');

        if (edgePaths.length > 0) {
            edgePaths.forEach(path => {
                path.style.strokeWidth = '2.5px';
                path.style.stroke = '#0e639c';
                // Mermaidのマーカーが存在すれば使用
                if (mermaidMarkerId) {
                    path.setAttribute('marker-end', `url(#${mermaidMarkerId})`);
                }
            });
            console.log('エッジをスタイル設定:', edgePaths.length, '本');
            return;
        }

        // flowchart-linkがない場合、全path要素から線を探す
        const allPaths = svgElement.querySelectorAll('path');
        let edgeCount = 0;

        // カスタムマーカーを作成
        let defs = svgElement.querySelector('defs');
        if (!defs) {
            defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            svgElement.insertBefore(defs, svgElement.firstChild);
        }

        const customMarkerId = 'custom-arrow';
        if (!defs.querySelector(`#${customMarkerId}`)) {
            const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
            marker.setAttribute('id', customMarkerId);
            marker.setAttribute('viewBox', '0 0 10 10');
            marker.setAttribute('refX', '10');
            marker.setAttribute('refY', '5');
            marker.setAttribute('markerWidth', '8');
            marker.setAttribute('markerHeight', '8');
            marker.setAttribute('orient', 'auto');

            const arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            arrowPath.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
            arrowPath.setAttribute('fill', '#0e639c');

            marker.appendChild(arrowPath);
            defs.appendChild(marker);
        }

        allPaths.forEach(path => {
            // マーカー内やノード内のパスを除外
            if (path.closest('marker') || path.closest('.node')) return;

            const fill = path.getAttribute('fill');
            const d = path.getAttribute('d') || '';

            // 線と判定
            if ((fill === 'none' || !fill) && d.length > 20) {
                path.style.strokeWidth = '2.5px';
                path.style.stroke = '#0e639c';
                path.setAttribute('marker-end', `url(#${customMarkerId})`);
                edgeCount++;
            }
        });

        console.log('エッジをスタイル設定（フォールバック）:', edgeCount, '本');
    }

    /**
     * 「タイトルへ戻る」線（バックエッジ）を左側に再描画（無効化）
     */
    adjustBackEdge(svgElement) {
        const nodes = svgElement.querySelectorAll('.node');
        if (nodes.length === 0) return;

        // ノード情報を収集
        const nodeInfos = [];
        let minLeft = Infinity;

        nodes.forEach(node => {
            const rect = node.querySelector('rect');
            if (!rect) return;

            const transform = node.getAttribute('transform');
            let tx = 0, ty = 0;
            if (transform) {
                const match = transform.match(/translate\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/);
                if (match) {
                    tx = parseFloat(match[1]);
                    ty = parseFloat(match[2]);
                }
            }

            const rectX = parseFloat(rect.getAttribute('x')) || 0;
            const rectY = parseFloat(rect.getAttribute('y')) || 0;
            const rectW = parseFloat(rect.getAttribute('width')) || 0;
            const rectH = parseFloat(rect.getAttribute('height')) || 0;

            const left = tx + rectX;
            const centerY = ty + rectY + rectH / 2;

            if (left < minLeft) minLeft = left;

            // ノードIDからファイル名を推測
            const nodeId = node.id || '';
            nodeInfos.push({
                node,
                id: nodeId,
                left,
                centerX: tx + rectX + rectW / 2,
                centerY,
                top: ty + rectY,
                bottom: ty + rectY + rectH
            });
        });

        console.log('ノード数:', nodeInfos.length);

        // タイトルノード（最も上にある）を探す
        let titleNode = null;
        let minY = Infinity;
        nodeInfos.forEach(info => {
            if (info.top < minY) {
                minY = info.top;
                titleNode = info;
            }
        });

        // エンディングノード（最も下にある）を探す - IDではなく位置で判定
        let endingNode = null;
        let maxY = -Infinity;
        nodeInfos.forEach(info => {
            if (info.bottom > maxY) {
                maxY = info.bottom;
                endingNode = info;
            }
        });

        console.log('タイトルノード:', titleNode ? titleNode.id : 'null', 'top:', titleNode?.top);
        console.log('エンディングノード:', endingNode ? endingNode.id : 'null', 'bottom:', endingNode?.bottom);

        // ノードが2つ以上あり、タイトルとエンディングが異なる場合のみ処理
        if (!titleNode || !endingNode || nodeInfos.length < 2) {
            console.log('ノードが不十分です');
            return;
        }

        // タイトルとエンディングが同じ場合（フローチャートが一直線の場合など）は処理しない
        if (titleNode === endingNode) {
            console.log('タイトルとエンディングが同じノードです');
            return;
        }

        // バックエッジラベルを探す
        const edgeLabels = svgElement.querySelectorAll('.edgeLabel');
        const edgePaths = svgElement.querySelectorAll('.edgePath');

        let backEdgeLabel = null;
        let backEdgeLabelY = 0;

        edgeLabels.forEach((label) => {
            const text = label.textContent || '';
            if (text.includes('タイトル') || text.includes('戻る')) {
                backEdgeLabel = label;
                const transform = label.getAttribute('transform');
                if (transform) {
                    const match = transform.match(/translate\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/);
                    if (match) {
                        backEdgeLabelY = parseFloat(match[2]);
                    }
                }
            }
        });

        if (!backEdgeLabel) {
            console.log('バックエッジラベルが見つかりません');
            return;
        }

        // 対応する元のパスを探して非表示にする
        // ラベルのY座標に最も近いパスで、かつ高さが大きいもの（上下に長い線）
        let originalPath = null;
        let bestMatch = { path: null, score: -Infinity };

        edgePaths.forEach((edgePath) => {
            const path = edgePath.querySelector('path');
            if (!path) return;

            try {
                const bbox = path.getBBox();
                // バックエッジは縦に長い（高さが大きい）
                const heightScore = bbox.height;
                // ラベルのY座標がパスの範囲内にある
                const labelInRange = backEdgeLabelY >= bbox.y && backEdgeLabelY <= bbox.y + bbox.height;

                if (labelInRange && heightScore > bestMatch.score) {
                    bestMatch = { path: edgePath, score: heightScore, bbox };
                }
            } catch (e) {}
        });

        if (bestMatch.path) {
            originalPath = bestMatch.path;
            // 元のパスを非表示
            originalPath.style.display = 'none';
            console.log('元のバックエッジパスを非表示:', bestMatch.bbox);
        }

        // 新しいパスを作成（左側を通る）
        const leftX = minLeft - 100; // ノードの左端より100px左
        const startY = endingNode.centerY;
        const endY = titleNode.centerY;
        const midY = (startY + endY) / 2;

        // シンプルな折れ線パス（エンディング→左→タイトル）
        const pathD = `M ${endingNode.left} ${startY} L ${leftX} ${startY} L ${leftX} ${endY} L ${titleNode.left} ${endY}`;

        console.log('新しいパス:', pathD);

        // 新しいパス要素を作成
        const newPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        newPath.setAttribute('d', pathD);
        newPath.setAttribute('class', 'back-edge-path');
        newPath.setAttribute('fill', 'none');
        newPath.setAttribute('stroke', '#0e639c');
        newPath.setAttribute('stroke-width', '2');

        // マーカーを探して設定（Mermaidのマーカーを再利用）
        const existingMarker = svgElement.querySelector('marker[id*="flowchart"]');
        if (existingMarker) {
            newPath.setAttribute('marker-end', `url(#${existingMarker.id})`);
            console.log('マーカー使用:', existingMarker.id);
        }

        // SVGに追加
        const edgePathsGroup = svgElement.querySelector('.edgePaths');
        if (edgePathsGroup) {
            edgePathsGroup.appendChild(newPath);
            console.log('edgePathsグループに追加');
        } else {
            // edgePathsがなければ直接SVGに追加
            const firstG = svgElement.querySelector('g');
            if (firstG) {
                firstG.appendChild(newPath);
                console.log('最初のgに追加');
            } else {
                svgElement.appendChild(newPath);
                console.log('SVGに直接追加');
            }
        }

        // ラベルを新しいパスの中央（左側）に移動
        backEdgeLabel.setAttribute('transform', `translate(${leftX - 80}, ${midY})`);

        console.log('新しいバックエッジパスを作成:', { leftX, startY, endY, midY });
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
