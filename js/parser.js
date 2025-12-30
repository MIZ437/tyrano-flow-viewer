/**
 * TyranoScript Parser
 * ksファイルを解析してデータを抽出する
 */

class TyranoParser {
    constructor() {
        // タグのパターン定義
        this.tagPattern = /\[([^\]]+)\]/g;
        this.labelPattern = /^\*(\S+)/gm;
        this.commentPattern = /^;.*$/gm;
        this.multiCommentPattern = /\/\*[\s\S]*?\*\//g;
    }

    /**
     * ksファイルの内容を解析
     * @param {string} content - ksファイルの内容
     * @param {string} filename - ファイル名
     * @returns {Object} 解析結果
     */
    parse(content, filename) {
        // コメントを除去
        const cleanedContent = this.removeComments(content);

        return {
            filename: filename,
            labels: this.extractLabels(cleanedContent),
            jumps: this.extractJumps(cleanedContent),
            calls: this.extractCalls(cleanedContent),
            branches: this.extractBranches(cleanedContent),
            images: this.extractImages(cleanedContent),
            videos: this.extractVideos(cleanedContent),
            audio: this.extractAudio(cleanedContent),
            clickCount: this.countClicks(cleanedContent),
            links: this.extractLinks(cleanedContent),
            dialogues: this.extractDialogues(cleanedContent)
        };
    }

    /**
     * コメントを除去
     */
    removeComments(content) {
        // 複数行コメントを除去
        let result = content.replace(this.multiCommentPattern, '');
        // 単一行コメントを除去（ただしセミコロンで始まる行全体）
        result = result.replace(this.commentPattern, '');
        return result;
    }

    /**
     * タグのパラメータを解析
     */
    parseTagParams(tagContent) {
        const params = {};
        // タグ名を取得
        const parts = tagContent.trim().split(/\s+/);
        params._tagName = parts[0];

        // パラメータを解析（key=value または key="value" 形式）
        const paramPattern = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
        let match;
        while ((match = paramPattern.exec(tagContent)) !== null) {
            const key = match[1];
            const value = match[2] || match[3] || match[4];
            params[key] = value;
        }

        return params;
    }

    /**
     * ラベルを抽出
     */
    extractLabels(content) {
        const labels = [];
        const lines = content.split('\n');

        lines.forEach((line, index) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('*')) {
                const labelName = trimmed.substring(1).split(/\s/)[0];
                if (labelName) {
                    labels.push({
                        name: labelName,
                        line: index + 1
                    });
                }
            }
        });

        return labels;
    }

    /**
     * jumpタグを抽出
     */
    extractJumps(content) {
        const jumps = [];
        const tagPattern = /\[(jump|@jump)\s+([^\]]*)\]/gi;
        let match;

        while ((match = tagPattern.exec(content)) !== null) {
            const params = this.parseTagParams(match[0].slice(1, -1));
            jumps.push({
                storage: params.storage || null,
                target: params.target || null,
                cond: params.cond || null
            });
        }

        // @jumpの形式も対応
        const atJumpPattern = /^@jump\s+(.*)$/gim;
        while ((match = atJumpPattern.exec(content)) !== null) {
            const params = this.parseTagParams('jump ' + match[1]);
            jumps.push({
                storage: params.storage || null,
                target: params.target || null,
                cond: params.cond || null
            });
        }

        return jumps;
    }

    /**
     * callタグを抽出
     */
    extractCalls(content) {
        const calls = [];
        const tagPattern = /\[call\s+([^\]]*)\]/gi;
        let match;

        while ((match = tagPattern.exec(content)) !== null) {
            const params = this.parseTagParams(match[0].slice(1, -1));
            calls.push({
                storage: params.storage || null,
                target: params.target || null
            });
        }

        return calls;
    }

    /**
     * リンク（選択肢）を抽出
     */
    extractLinks(content) {
        const links = [];

        // [glink]
        const glinkPattern = /\[glink\s+([^\]]*)\]/gi;
        let match;
        while ((match = glinkPattern.exec(content)) !== null) {
            const params = this.parseTagParams(match[0].slice(1, -1));
            links.push({
                type: 'glink',
                text: params.text || '',
                storage: params.storage || null,
                target: params.target || null
            });
        }

        // [link]
        const linkPattern = /\[link\s+([^\]]*)\]/gi;
        while ((match = linkPattern.exec(content)) !== null) {
            const params = this.parseTagParams(match[0].slice(1, -1));
            links.push({
                type: 'link',
                storage: params.storage || null,
                target: params.target || null
            });
        }

        // [button]
        const buttonPattern = /\[button\s+([^\]]*)\]/gi;
        while ((match = buttonPattern.exec(content)) !== null) {
            const params = this.parseTagParams(match[0].slice(1, -1));
            links.push({
                type: 'button',
                graphic: params.graphic || null,
                storage: params.storage || null,
                target: params.target || null
            });
        }

        return links;
    }

    /**
     * 条件分岐を抽出
     */
    extractBranches(content) {
        const branches = [];
        const ifPattern = /\[(if|elsif)\s+([^\]]*)\]/gi;
        let match;

        while ((match = ifPattern.exec(content)) !== null) {
            const params = this.parseTagParams(match[0].slice(1, -1));
            branches.push({
                type: match[1].toLowerCase(),
                exp: params.exp || ''
            });
        }

        return branches;
    }

    /**
     * 画像関連タグを抽出
     */
    extractImages(content) {
        const images = [];

        // [bg]
        const bgPattern = /\[bg\s+([^\]]*)\]/gi;
        let match;
        while ((match = bgPattern.exec(content)) !== null) {
            const params = this.parseTagParams(match[0].slice(1, -1));
            if (params.storage) {
                images.push({
                    type: 'bg',
                    storage: params.storage,
                    folder: 'bgimage'
                });
            }
        }

        // [image]
        const imagePattern = /\[image\s+([^\]]*)\]/gi;
        while ((match = imagePattern.exec(content)) !== null) {
            const params = this.parseTagParams(match[0].slice(1, -1));
            if (params.storage) {
                images.push({
                    type: 'image',
                    storage: params.storage,
                    layer: params.layer || '0',
                    folder: 'fgimage'
                });
            }
        }

        // [chara_new]
        const charaNewPattern = /\[chara_new\s+([^\]]*)\]/gi;
        while ((match = charaNewPattern.exec(content)) !== null) {
            const params = this.parseTagParams(match[0].slice(1, -1));
            if (params.storage) {
                images.push({
                    type: 'chara_new',
                    name: params.name || '',
                    storage: params.storage,
                    folder: 'fgimage'
                });
            }
        }

        // [chara_show]
        const charaShowPattern = /\[chara_show\s+([^\]]*)\]/gi;
        while ((match = charaShowPattern.exec(content)) !== null) {
            const params = this.parseTagParams(match[0].slice(1, -1));
            images.push({
                type: 'chara_show',
                name: params.name || '',
                face: params.face || null,
                storage: params.storage || null,
                folder: 'fgimage'
            });
        }

        // [chara_face]
        const charaFacePattern = /\[chara_face\s+([^\]]*)\]/gi;
        while ((match = charaFacePattern.exec(content)) !== null) {
            const params = this.parseTagParams(match[0].slice(1, -1));
            if (params.storage) {
                images.push({
                    type: 'chara_face',
                    name: params.name || '',
                    face: params.face || '',
                    storage: params.storage,
                    folder: 'fgimage'
                });
            }
        }

        return images;
    }

    /**
     * 動画関連タグを抽出
     */
    extractVideos(content) {
        const videos = [];

        // [video]
        const videoPattern = /\[video\s+([^\]]*)\]/gi;
        let match;
        while ((match = videoPattern.exec(content)) !== null) {
            const params = this.parseTagParams(match[0].slice(1, -1));
            if (params.storage) {
                videos.push({
                    type: 'video',
                    storage: params.storage,
                    folder: 'video'
                });
            }
        }

        // [movie]
        const moviePattern = /\[movie\s+([^\]]*)\]/gi;
        while ((match = moviePattern.exec(content)) !== null) {
            const params = this.parseTagParams(match[0].slice(1, -1));
            if (params.storage) {
                videos.push({
                    type: 'movie',
                    storage: params.storage,
                    folder: 'video'
                });
            }
        }

        // [bgmovie]
        const bgmoviePattern = /\[bgmovie\s+([^\]]*)\]/gi;
        while ((match = bgmoviePattern.exec(content)) !== null) {
            const params = this.parseTagParams(match[0].slice(1, -1));
            if (params.storage) {
                videos.push({
                    type: 'bgmovie',
                    storage: params.storage,
                    folder: 'video'
                });
            }
        }

        return videos;
    }

    /**
     * 音声関連タグを抽出
     */
    extractAudio(content) {
        const audio = [];

        // [playbgm], [fadeinbgm]
        const bgmPattern = /\[(playbgm|fadeinbgm)\s+([^\]]*)\]/gi;
        let match;
        while ((match = bgmPattern.exec(content)) !== null) {
            const params = this.parseTagParams(match[0].slice(1, -1));
            if (params.storage) {
                audio.push({
                    type: 'bgm',
                    tag: match[1].toLowerCase(),
                    storage: params.storage,
                    folder: 'bgm'
                });
            }
        }

        // [playse], [fadeinse]
        const sePattern = /\[(playse|fadeinse)\s+([^\]]*)\]/gi;
        while ((match = sePattern.exec(content)) !== null) {
            const params = this.parseTagParams(match[0].slice(1, -1));
            if (params.storage) {
                audio.push({
                    type: 'se',
                    tag: match[1].toLowerCase(),
                    storage: params.storage,
                    folder: 'sound'
                });
            }
        }

        return audio;
    }

    /**
     * クリック数をカウント（[p]と[l]の数）
     */
    countClicks(content) {
        const pCount = (content.match(/\[p\]/gi) || []).length;
        const lCount = (content.match(/\[l\]/gi) || []).length;
        return pCount + lCount;
    }

    /**
     * セリフ・ナレーションを抽出
     */
    extractDialogues(content) {
        const dialogues = [];
        const lines = content.split('\n');

        let currentSpeaker = null;
        let currentText = [];
        let lineNumber = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            lineNumber = i + 1;

            // 空行はスキップ
            if (!line) continue;

            // ラベル行はスキップ
            if (line.startsWith('*')) continue;

            // タグのみの行はスキップ（ただしテキスト中のタグは除去して処理）
            if (line.startsWith('[') && line.endsWith(']')) continue;
            if (line.startsWith('@')) continue;

            // 話者指定行 (#キャラ名 または #キャラ名:表情)
            if (line.startsWith('#')) {
                // 前のセリフを保存
                if (currentText.length > 0) {
                    dialogues.push({
                        speaker: currentSpeaker,
                        text: currentText.join(''),
                        line: lineNumber - currentText.length
                    });
                    currentText = [];
                }

                // 新しい話者を設定
                const speakerPart = line.substring(1).split(':')[0].trim();
                currentSpeaker = speakerPart || null; // 空の場合はナレーション
                continue;
            }

            // テキスト行
            // タグを除去してテキストのみ抽出
            let textContent = line
                .replace(/\[[^\]]*\]/g, '') // タグを除去
                .replace(/^\s+|\s+$/g, ''); // 前後の空白を除去

            if (textContent) {
                currentText.push(textContent);
            }
        }

        // 最後のセリフを保存
        if (currentText.length > 0) {
            dialogues.push({
                speaker: currentSpeaker,
                text: currentText.join(''),
                line: lineNumber - currentText.length + 1
            });
        }

        return dialogues;
    }
}

// グローバルに公開
window.TyranoParser = TyranoParser;
