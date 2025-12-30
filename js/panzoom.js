/**
 * Pan and Zoom Controller
 * SVGをドラッグで移動、マウスホイールで拡大縮小
 */

class PanZoomController {
    constructor(container) {
        this.container = container;
        this.svg = null;

        // 変換状態
        this.scale = 1;
        this.translateX = 0;
        this.translateY = 0;

        // ドラッグ状態
        this.isDragging = false;
        this.startX = 0;
        this.startY = 0;
        this.startTranslateX = 0;
        this.startTranslateY = 0;

        // 設定
        this.minScale = 0.1;
        this.maxScale = 3;
        this.zoomSensitivity = 0.001;

        this.init();
    }

    init() {
        // マウスイベント
        this.container.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.container.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.container.addEventListener('mouseup', (e) => this.onMouseUp(e));
        this.container.addEventListener('mouseleave', (e) => this.onMouseUp(e));

        // ホイールイベント
        this.container.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

        // タッチイベント（モバイル対応）
        this.container.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
        this.container.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
        this.container.addEventListener('touchend', (e) => this.onTouchEnd(e));

        // ウィンドウリサイズ時に再配置
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                if (this.svg) {
                    this.centerContent();
                }
            }, 200);
        });
    }

    /**
     * SVGが更新されたら呼び出す
     */
    attachToSvg() {
        this.svg = this.container.querySelector('svg');
        if (this.svg) {
            // SVGのスタイル設定
            this.svg.style.transformOrigin = '0 0';
            this.svg.style.cursor = 'grab';

            // レイアウトが確定するまで少し待ってから自動フィット
            requestAnimationFrame(() => {
                setTimeout(() => {
                    this.centerContent();
                }, 50);
            });
        }
    }

    /**
     * コンテンツを中央に配置（フィットさせる）
     * 最初のノードを水平中央に配置する
     */
    centerContent() {
        if (!this.svg) return;

        const containerRect = this.container.getBoundingClientRect();
        if (containerRect.width < 50 || containerRect.height < 50) {
            return;
        }

        try {
            const svgBBox = this.svg.getBBox();
            const svgWidth = svgBBox.width || 500;
            const svgHeight = svgBBox.height || 500;

            // コンテナに収まるようにスケールを計算
            const padding = 40;
            const availableWidth = containerRect.width - padding * 2;
            const availableHeight = containerRect.height - padding * 2;

            const scaleX = availableWidth / svgWidth;
            const scaleY = availableHeight / svgHeight;
            this.scale = Math.min(scaleX, scaleY, 1.5);
            this.scale = Math.max(this.scale, 0.3);

            // 初期位置を設定（後で調整）
            this.translateX = 0;
            this.translateY = padding - svgBBox.y * this.scale;
            this.applyTransform();

            // 最初のノードを見つけて、実際の画面位置で水平センタリング
            const firstNode = this.svg.querySelector('.node');

            if (firstNode) {
                // 現在のノードの画面上の位置を取得
                const nodeRect = firstNode.getBoundingClientRect();
                const nodeCenterScreenX = nodeRect.left + nodeRect.width / 2;

                // コンテナの中央の画面位置
                const containerCenterScreenX = containerRect.left + containerRect.width / 2;

                // 必要なオフセットを計算して適用
                const offsetNeeded = containerCenterScreenX - nodeCenterScreenX;
                this.translateX = offsetNeeded;
            }

            // 垂直：上部に余白を残して配置
            this.translateY = padding - svgBBox.y * this.scale;

            this.applyTransform();
        } catch (e) {
            console.warn('centerContent error:', e);
        }
    }

    /**
     * 変換を適用
     */
    applyTransform() {
        if (this.svg) {
            this.svg.style.transform = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;
        }
    }

    /**
     * マウスダウン
     */
    onMouseDown(e) {
        if (e.button !== 0) return; // 左クリックのみ

        // ノードクリックは除外
        if (e.target.closest('.node')) return;

        this.isDragging = true;
        this.startX = e.clientX;
        this.startY = e.clientY;
        this.startTranslateX = this.translateX;
        this.startTranslateY = this.translateY;

        if (this.svg) {
            this.svg.style.cursor = 'grabbing';
        }
        e.preventDefault();
    }

    /**
     * マウス移動
     */
    onMouseMove(e) {
        if (!this.isDragging) return;

        const dx = e.clientX - this.startX;
        const dy = e.clientY - this.startY;

        this.translateX = this.startTranslateX + dx;
        this.translateY = this.startTranslateY + dy;

        this.applyTransform();
    }

    /**
     * マウスアップ
     */
    onMouseUp(e) {
        if (this.isDragging) {
            this.isDragging = false;
            if (this.svg) {
                this.svg.style.cursor = 'grab';
            }
        }
    }

    /**
     * ホイール（ズーム）
     * コンテナの中央を基準にズーム（水平位置を固定）
     */
    onWheel(e) {
        e.preventDefault();

        const rect = this.container.getBoundingClientRect();

        // ズームの中心点：水平はコンテナ中央、垂直はマウス位置
        const centerX = rect.width / 2;
        const mouseY = e.clientY - rect.top;

        // ズーム前の中心位置（SVG座標系）
        const svgX = (centerX - this.translateX) / this.scale;
        const svgY = (mouseY - this.translateY) / this.scale;

        // スケール更新
        const delta = -e.deltaY * this.zoomSensitivity;
        const newScale = Math.min(Math.max(this.scale * (1 + delta), this.minScale), this.maxScale);

        // コンテナ中央を基準にズーム（水平位置固定）
        this.translateX = centerX - svgX * newScale;
        this.translateY = mouseY - svgY * newScale;
        this.scale = newScale;

        this.applyTransform();
    }

    /**
     * タッチ開始
     */
    onTouchStart(e) {
        if (e.touches.length === 1) {
            // シングルタッチ（パン）
            const touch = e.touches[0];
            this.isDragging = true;
            this.startX = touch.clientX;
            this.startY = touch.clientY;
            this.startTranslateX = this.translateX;
            this.startTranslateY = this.translateY;
        }
    }

    /**
     * タッチ移動
     */
    onTouchMove(e) {
        if (e.touches.length === 1 && this.isDragging) {
            e.preventDefault();
            const touch = e.touches[0];
            const dx = touch.clientX - this.startX;
            const dy = touch.clientY - this.startY;

            this.translateX = this.startTranslateX + dx;
            this.translateY = this.startTranslateY + dy;

            this.applyTransform();
        }
    }

    /**
     * タッチ終了
     */
    onTouchEnd(e) {
        this.isDragging = false;
    }

    /**
     * リセット（中央配置に戻す）
     */
    reset() {
        this.centerContent();
    }
}

// グローバルに公開
window.PanZoomController = PanZoomController;
