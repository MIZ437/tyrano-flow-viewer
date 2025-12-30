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

            // 少し遅延させてから中央配置（SVGのサイズが確定するのを待つ）
            setTimeout(() => {
                this.centerContent();
            }, 100);
        }
    }

    /**
     * コンテンツを中央に配置
     */
    centerContent() {
        if (!this.svg) return;

        const containerRect = this.container.getBoundingClientRect();
        const svgBBox = this.svg.getBBox();

        // SVGの実際のサイズを取得
        const svgWidth = svgBBox.width + svgBBox.x * 2;
        const svgHeight = svgBBox.height + svgBBox.y * 2;

        // コンテナに収まるようにスケールを計算
        const padding = 40;
        const scaleX = (containerRect.width - padding * 2) / svgWidth;
        const scaleY = (containerRect.height - padding * 2) / svgHeight;

        // 最大スケールは1（等倍以上にはしない）
        this.scale = Math.min(scaleX, scaleY, 1);

        // 中央に配置
        const scaledWidth = svgWidth * this.scale;
        const scaledHeight = svgHeight * this.scale;
        this.translateX = (containerRect.width - scaledWidth) / 2;
        this.translateY = (containerRect.height - scaledHeight) / 2;

        this.applyTransform();
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
     */
    onWheel(e) {
        e.preventDefault();

        const rect = this.container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // ズーム前のマウス位置（SVG座標系）
        const svgX = (mouseX - this.translateX) / this.scale;
        const svgY = (mouseY - this.translateY) / this.scale;

        // スケール更新
        const delta = -e.deltaY * this.zoomSensitivity;
        const newScale = Math.min(Math.max(this.scale * (1 + delta), this.minScale), this.maxScale);

        // マウス位置を中心にズーム
        this.translateX = mouseX - svgX * newScale;
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
