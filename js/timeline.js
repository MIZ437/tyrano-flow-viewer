/**
 * Timeline Processor
 * TyranoScriptを時間軸ベースのイベントに変換
 * 時間単位: [p]タグ (1クリック = 1時間単位)
 */

class TimelineProcessor {
    constructor() {
        // タイムラインイベント
        this.events = [];
        // トラック情報
        this.tracks = {
            text: [],      // テキストトラック
            bg: [],        // 背景トラック
            image: {},     // 画像レイヤー別 { layer0: [], layer1: [], ... }
            chara: {},     // キャラクター別 { name: [] }
            video: [],     // 動画トラック
            bgm: [],       // BGMトラック
            se: []         // SEトラック
        };
        // 現在の状態
        this.currentTime = 0;
        this.totalTime = 0;
        // アクティブなリソース（終了時間を後で設定するため）
        this.activeBgm = null;
        this.activeImages = new Map(); // layer -> event
        this.activeCharas = new Map(); // name -> event
        this.activeBg = null;
        this.activeVideo = null; // アクティブな動画
    }

    /**
     * 全ファイルをリセット
     */
    clear() {
        this.events = [];
        this.tracks = {
            text: [],
            bg: [],
            image: {},
            chara: {},
            video: [],
            bgm: [],
            se: []
        };
        this.currentTime = 0;
        this.totalTime = 0;
        this.activeBgm = null;
        this.activeImages.clear();
        this.activeCharas.clear();
        this.activeBg = null;
        this.activeVideo = null;
    }

    /**
     * ksファイルの内容を解析してタイムラインイベントを生成
     * @param {string} content - ksファイルの内容
     * @param {string} filename - ファイル名
     */
    processFile(content, filename) {
        // 前のファイルからのアクティブな動画があれば終了させる
        // （[movie]はブロッキングなので、次のファイル開始時点で終了）
        if (this.activeVideo) {
            this.activeVideo.endTime = this.currentTime;
            this.activeVideo = null;
        }

        const lines = content.split('\n');
        let currentSpeaker = null;
        let textBuffer = [];
        let textStartTime = this.currentTime;
        let hasExternalJump = false; // 外部ファイルへのjumpがあったか
        let passedJumpAndStop = false; // jump+[s]の後か
        let hasVisualContent = false; // 視覚的コンテンツが表示されたか
        let firstCmSkipped = false; // 最初の[cm]をスキップしたか

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trim();

            // コメント行をスキップ
            if (trimmedLine.startsWith(';')) continue;

            // [jump storage="xxx.ks"] を検出（外部ファイルへのジャンプ）
            const jumpMatch = trimmedLine.match(/\[jump[^\]]*storage\s*=\s*["']?([^"'\]\s]+)/i);
            if (jumpMatch && jumpMatch[1] && jumpMatch[1].endsWith('.ks')) {
                hasExternalJump = true;
            }
            // @jump storage=xxx.ks の形式も検出
            if (trimmedLine.startsWith('@jump') && trimmedLine.includes('storage=')) {
                const atJumpMatch = trimmedLine.match(/storage\s*=\s*["']?([^"'\s]+)/i);
                if (atJumpMatch && atJumpMatch[1] && atJumpMatch[1].endsWith('.ks')) {
                    hasExternalJump = true;
                }
            }

            // [s]タグ（スクリプト停止）
            if (trimmedLine === '[s]' || trimmedLine.startsWith('[s ')) {
                // 外部ファイルへのジャンプ後の[s]なら、以降は別分岐
                if (hasExternalJump) {
                    passedJumpAndStop = true;
                }
                continue;
            }

            // ラベル行の処理
            if (trimmedLine.startsWith('*')) {
                if (passedJumpAndStop) {
                    // jump+[s]後のラベル = 別の選択肢からの分岐
                    // このラベル以降は処理しない
                    break;
                }
                continue;
            }

            // @形式のコマンドを処理
            if (trimmedLine.startsWith('@')) {
                const atCommand = trimmedLine.substring(1).trim().split(/\s+/)[0].toLowerCase();

                // @s（スクリプト停止）の場合
                if (atCommand === 's') {
                    if (hasExternalJump) {
                        passedJumpAndStop = true;
                    }
                    continue;
                }

                this.processAtCommand(trimmedLine, filename, i + 1);

                // @p, @l, @cm も時間を進める
                if (atCommand === 'p') {
                    // テキストバッファをフラッシュ
                    if (textBuffer.length > 0) {
                        this.addTextEvent(currentSpeaker, textBuffer.join(''), textStartTime, this.currentTime + 1, filename);
                        textBuffer = [];
                    }
                    this.currentTime += 1;
                    textStartTime = this.currentTime;
                    hasVisualContent = true;
                } else if (atCommand === 'l') {
                    this.currentTime += 1;
                    hasVisualContent = true;
                } else if (atCommand === 'cm') {
                    if (textBuffer.length > 0) {
                        this.addTextEvent(currentSpeaker, textBuffer.join(''), textStartTime, this.currentTime + 1, filename);
                        textBuffer = [];
                        hasVisualContent = true;
                    }
                    // ファイル冒頭の@cmは時間を進めない（セットアップ用）
                    if (hasVisualContent || firstCmSkipped) {
                        this.currentTime += 1;
                    } else {
                        firstCmSkipped = true;
                    }
                    textStartTime = this.currentTime;
                }
                continue;
            }

            // 話者指定
            if (trimmedLine.startsWith('#')) {
                // テキストバッファをフラッシュ
                if (textBuffer.length > 0) {
                    this.addTextEvent(currentSpeaker, textBuffer.join(''), textStartTime, this.currentTime, filename);
                    textBuffer = [];
                }
                currentSpeaker = trimmedLine.substring(1).split(':')[0].trim() || null;
                textStartTime = this.currentTime;
                continue;
            }

            // タグを処理
            this.processLineWithTags(trimmedLine, filename, i + 1, (text) => {
                if (text) textBuffer.push(text);
            });

            // [p]タグで時間を進める（[p]、[p cond="..."]など全てに対応）
            const pMatches = trimmedLine.match(/\[p(?:\s[^\]]*)?]/gi);
            if (pMatches) {
                // テキストバッファをフラッシュ
                if (textBuffer.length > 0) {
                    this.addTextEvent(currentSpeaker, textBuffer.join(''), textStartTime, this.currentTime + 1, filename);
                    textBuffer = [];
                }
                this.currentTime += pMatches.length;
                textStartTime = this.currentTime;
                hasVisualContent = true;
            }

            // [l]タグも時間を進める（クリック待ち）
            const lMatches = trimmedLine.match(/\[l(?:\s[^\]]*)?]/gi);
            if (lMatches) {
                this.currentTime += lMatches.length;
                hasVisualContent = true;
            }

            // [cm]タグも時間を進める（メッセージクリア）
            const cmMatches = trimmedLine.match(/\[cm(?:\s[^\]]*)?]/gi);
            if (cmMatches) {
                // テキストバッファをフラッシュ
                if (textBuffer.length > 0) {
                    this.addTextEvent(currentSpeaker, textBuffer.join(''), textStartTime, this.currentTime + 1, filename);
                    textBuffer = [];
                    hasVisualContent = true;
                }
                // ファイル冒頭の[cm]は時間を進めない（セットアップ用）
                if (hasVisualContent || firstCmSkipped) {
                    this.currentTime += cmMatches.length;
                } else {
                    firstCmSkipped = true;
                }
                textStartTime = this.currentTime;
            }

            // [r]タグ（改行のみ、時間は進めないがテキストには含める）
            // - [r]は改行表示なので時間を進めない
        }

        // 残りのテキストバッファをフラッシュ
        if (textBuffer.length > 0) {
            this.addTextEvent(currentSpeaker, textBuffer.join(''), textStartTime, this.currentTime, filename);
        }
    }

    /**
     * @形式のコマンドを処理
     */
    processAtCommand(line, filename, lineNum) {
        const parts = line.substring(1).trim().split(/\s+/);
        const command = parts[0].toLowerCase();

        // パラメータを解析
        const params = {};
        const paramStr = line.substring(1 + command.length);
        const paramPattern = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
        let match;
        while ((match = paramPattern.exec(paramStr)) !== null) {
            params[match[1]] = match[2] || match[3] || match[4];
        }

        this.processCommand(command, params, filename, lineNum);
    }

    /**
     * タグを含む行を処理
     */
    processLineWithTags(line, filename, lineNum, textCallback) {
        const tagPattern = /\[([^\]]+)\]/g;
        let lastIndex = 0;
        let match;

        while ((match = tagPattern.exec(line)) !== null) {
            // タグ前のテキスト
            const textBefore = line.substring(lastIndex, match.index);
            if (textBefore.trim()) {
                textCallback(textBefore);
            }

            // タグを処理
            const tagContent = match[1];
            const parts = tagContent.trim().split(/\s+/);
            const tagName = parts[0].toLowerCase();

            // パラメータを解析
            const params = {};
            const paramPattern = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
            let paramMatch;
            while ((paramMatch = paramPattern.exec(tagContent)) !== null) {
                params[paramMatch[1]] = paramMatch[2] || paramMatch[3] || paramMatch[4];
            }

            this.processCommand(tagName, params, filename, lineNum);
            lastIndex = match.index + match[0].length;
        }

        // 残りのテキスト
        const textAfter = line.substring(lastIndex);
        const cleanText = textAfter.replace(/\[.*?\]/g, '').trim();
        if (cleanText) {
            textCallback(cleanText);
        }
    }

    /**
     * コマンド（タグ）を処理
     */
    processCommand(command, params, filename, lineNum) {
        switch (command) {
            // 背景
            case 'bg':
                this.processBg(params, filename, lineNum);
                break;

            // 画像
            case 'image':
                this.processImage(params, filename, lineNum);
                break;
            case 'freeimage':
                this.processFreeImage(params, filename, lineNum);
                break;

            // キャラクター
            case 'chara_show':
                this.processCharaShow(params, filename, lineNum);
                break;
            case 'chara_hide':
                this.processCharaHide(params, filename, lineNum);
                break;
            case 'chara_hide_all':
                this.processCharaHideAll(filename, lineNum);
                break;

            // 動画
            case 'video':
            case 'movie':
            case 'bgmovie':
                this.processVideo(command, params, filename, lineNum);
                break;
            case 'wait_video':
                this.processWaitVideo(filename, lineNum);
                break;
            case 'free_video':
                this.processFreeVideo(filename, lineNum);
                break;

            // BGM
            case 'playbgm':
            case 'fadeinbgm':
                this.processBgmStart(command, params, filename, lineNum);
                break;
            case 'stopbgm':
            case 'fadeoutbgm':
                this.processBgmStop(filename, lineNum);
                break;

            // SE
            case 'playse':
            case 'fadeinse':
                this.processSe(command, params, filename, lineNum);
                break;
        }
    }

    /**
     * 背景を処理
     */
    processBg(params, filename, lineNum) {
        // 前の背景を終了
        if (this.activeBg) {
            this.activeBg.endTime = this.currentTime;
        }

        const event = {
            type: 'bg',
            storage: params.storage,
            startTime: this.currentTime,
            endTime: null, // 次の背景まで
            filename: filename,
            line: lineNum
        };
        this.tracks.bg.push(event);
        this.activeBg = event;
        this.events.push(event);
    }

    /**
     * 画像を処理
     */
    processImage(params, filename, lineNum) {
        const layer = params.layer || '0';

        // このレイヤーの前の画像を終了
        if (this.activeImages.has(layer)) {
            this.activeImages.get(layer).endTime = this.currentTime;
        }

        const event = {
            type: 'image',
            layer: layer,
            storage: params.storage,
            startTime: this.currentTime,
            endTime: null,
            filename: filename,
            line: lineNum,
            x: params.x,
            y: params.y
        };

        if (!this.tracks.image[`layer${layer}`]) {
            this.tracks.image[`layer${layer}`] = [];
        }
        this.tracks.image[`layer${layer}`].push(event);
        this.activeImages.set(layer, event);
        this.events.push(event);
    }

    /**
     * 画像解放を処理
     */
    processFreeImage(params, filename, lineNum) {
        const layer = params.layer || params.name;
        if (layer && this.activeImages.has(layer)) {
            this.activeImages.get(layer).endTime = this.currentTime;
            this.activeImages.delete(layer);
        }
    }

    /**
     * キャラクター表示を処理
     */
    processCharaShow(params, filename, lineNum) {
        const name = params.name;
        if (!name) return;

        // 同じキャラの前の表示を終了
        if (this.activeCharas.has(name)) {
            this.activeCharas.get(name).endTime = this.currentTime;
        }

        const event = {
            type: 'chara',
            name: name,
            face: params.face,
            storage: params.storage,
            startTime: this.currentTime,
            endTime: null,
            filename: filename,
            line: lineNum
        };

        if (!this.tracks.chara[name]) {
            this.tracks.chara[name] = [];
        }
        this.tracks.chara[name].push(event);
        this.activeCharas.set(name, event);
        this.events.push(event);
    }

    /**
     * キャラクター非表示を処理
     */
    processCharaHide(params, filename, lineNum) {
        const name = params.name;
        if (name && this.activeCharas.has(name)) {
            this.activeCharas.get(name).endTime = this.currentTime;
            this.activeCharas.delete(name);
        }
    }

    /**
     * 全キャラクター非表示を処理
     */
    processCharaHideAll(filename, lineNum) {
        this.activeCharas.forEach((event, name) => {
            event.endTime = this.currentTime;
        });
        this.activeCharas.clear();
    }

    /**
     * 動画を処理
     * - [movie] / [bgmovie]: ブロッキング呼び出し（その場で完結）
     * - [video]: 非ブロッキング（wait_video まで継続）
     */
    processVideo(command, params, filename, lineNum) {
        // 前の動画があれば終了
        if (this.activeVideo) {
            this.activeVideo.endTime = this.currentTime;
            this.activeVideo = null;
        }

        const event = {
            type: 'video',
            command: command,
            storage: params.storage,
            startTime: this.currentTime,
            endTime: null,
            filename: filename,
            line: lineNum
        };
        this.tracks.video.push(event);
        this.events.push(event);

        // [movie] と [bgmovie] はブロッキング呼び出し
        // 動画再生が終わってから次に進むので、時間を1単位進める
        if (command === 'movie' || command === 'bgmovie') {
            // 動画再生には時間がかかるので、最低1単位進める
            this.currentTime += 1;
            event.endTime = this.currentTime;
            // ブロッキングなのでactiveVideoには設定しない
        } else {
            // [video] は非ブロッキング、wait_video まで継続
            this.activeVideo = event;
        }
    }

    /**
     * 動画待機を処理（wait_video）
     * 動画再生完了を待つ - ここで動画の終了時間を設定
     */
    processWaitVideo(filename, lineNum) {
        if (this.activeVideo) {
            this.activeVideo.endTime = this.currentTime;
            this.activeVideo = null;
        }
    }

    /**
     * 動画解放を処理（free_video）
     */
    processFreeVideo(filename, lineNum) {
        if (this.activeVideo) {
            this.activeVideo.endTime = this.currentTime;
            this.activeVideo = null;
        }
    }

    /**
     * BGM開始を処理
     */
    processBgmStart(command, params, filename, lineNum) {
        // 前のBGMを終了
        if (this.activeBgm) {
            this.activeBgm.endTime = this.currentTime;
        }

        const event = {
            type: 'bgm',
            command: command,
            storage: params.storage,
            startTime: this.currentTime,
            endTime: null, // stopbgmまで継続
            filename: filename,
            line: lineNum,
            loop: params.loop !== 'false'
        };
        this.tracks.bgm.push(event);
        this.activeBgm = event;
        this.events.push(event);
    }

    /**
     * BGM停止を処理
     */
    processBgmStop(filename, lineNum) {
        if (this.activeBgm) {
            this.activeBgm.endTime = this.currentTime;
            this.activeBgm = null;
        }
    }

    /**
     * SE を処理
     */
    processSe(command, params, filename, lineNum) {
        const event = {
            type: 'se',
            command: command,
            storage: params.storage,
            startTime: this.currentTime,
            endTime: this.currentTime + 0.5, // SEは短い
            filename: filename,
            line: lineNum,
            buf: params.buf || '0'
        };
        this.tracks.se.push(event);
        this.events.push(event);
    }

    /**
     * テキストイベントを追加
     */
    addTextEvent(speaker, text, startTime, endTime, filename) {
        if (!text.trim()) return;

        const event = {
            type: 'text',
            speaker: speaker,
            text: text.trim(),
            startTime: startTime,
            endTime: endTime,
            filename: filename
        };
        this.tracks.text.push(event);
        this.events.push(event);
    }

    /**
     * 全ての処理を完了（未終了のイベントを閉じる）
     */
    finalize() {
        this.totalTime = this.currentTime;

        // 未終了のイベントを終了
        if (this.activeBgm) {
            this.activeBgm.endTime = this.totalTime;
        }
        if (this.activeBg) {
            this.activeBg.endTime = this.totalTime;
        }
        if (this.activeVideo) {
            this.activeVideo.endTime = this.totalTime;
        }
        this.activeImages.forEach(event => {
            if (!event.endTime) event.endTime = this.totalTime;
        });
        this.activeCharas.forEach(event => {
            if (!event.endTime) event.endTime = this.totalTime;
        });

        // 全イベントの終了時間を設定
        this.events.forEach(event => {
            if (event.endTime === null) {
                event.endTime = this.totalTime;
            }
        });

        // デバッグ: タイムライン統計を出力
        console.log('=== Timeline Debug ===');
        console.log(`Total Time: ${this.totalTime} [p]`);
        console.log(`Total Events: ${this.events.length}`);
        console.log(`Text Events: ${this.tracks.text.length}`);
        console.log(`BGM Events: ${this.tracks.bgm.length}`);
        console.log(`SE Events: ${this.tracks.se.length}`);

        // イベントの時間分布を確認
        if (this.events.length > 0) {
            const timeDistribution = {};
            this.events.forEach(e => {
                const t = Math.floor(e.startTime);
                timeDistribution[t] = (timeDistribution[t] || 0) + 1;
            });
            console.log('Event distribution by start time:', timeDistribution);
        }
    }

    /**
     * トラック一覧を取得（UI表示用）
     */
    getTrackList() {
        const trackList = [];

        // テキストトラック
        if (this.tracks.text.length > 0) {
            trackList.push({ id: 'text', name: 'テキスト', type: 'text', events: this.tracks.text });
        }

        // 背景トラック
        if (this.tracks.bg.length > 0) {
            trackList.push({ id: 'bg', name: '背景', type: 'bg', events: this.tracks.bg });
        }

        // キャラクタートラック（名前別）
        Object.keys(this.tracks.chara).sort().forEach(name => {
            if (this.tracks.chara[name].length > 0) {
                trackList.push({
                    id: `chara_${name}`,
                    name: `キャラ: ${name}`,
                    type: 'chara',
                    events: this.tracks.chara[name]
                });
            }
        });

        // 画像レイヤートラック
        Object.keys(this.tracks.image).sort().forEach(layer => {
            if (this.tracks.image[layer].length > 0) {
                trackList.push({
                    id: layer,
                    name: `画像 ${layer}`,
                    type: 'image',
                    events: this.tracks.image[layer]
                });
            }
        });

        // 動画トラック
        if (this.tracks.video.length > 0) {
            trackList.push({ id: 'video', name: '動画', type: 'video', events: this.tracks.video });
        }

        // BGMトラック
        if (this.tracks.bgm.length > 0) {
            trackList.push({ id: 'bgm', name: 'BGM', type: 'bgm', events: this.tracks.bgm });
        }

        // SEトラック
        if (this.tracks.se.length > 0) {
            trackList.push({ id: 'se', name: 'SE', type: 'se', events: this.tracks.se });
        }

        return trackList;
    }

    /**
     * 指定時間のイベントを取得
     */
    getEventsAtTime(time) {
        return this.events.filter(e => e.startTime <= time && e.endTime > time);
    }

    /**
     * 統計情報を取得
     */
    getStats() {
        return {
            totalTime: this.totalTime,
            totalEvents: this.events.length,
            trackCount: this.getTrackList().length,
            bgmCount: this.tracks.bgm.length,
            seCount: this.tracks.se.length,
            imageCount: Object.values(this.tracks.image).reduce((sum, arr) => sum + arr.length, 0),
            charaCount: Object.values(this.tracks.chara).reduce((sum, arr) => sum + arr.length, 0),
            textCount: this.tracks.text.length
        };
    }
}

// グローバルに公開
window.TimelineProcessor = TimelineProcessor;
