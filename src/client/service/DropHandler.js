import { loadVideoFromFile, loadVideoFromUrl, loadVideoFromYoutube, loadSubtitle, completeVideoFromFile } from '@client/store/player';
import HeadRequest from '@client/http/HeadRequest';

const FILENAME_MATCHER = /^\/?(.+)\.(\w+)$/i;

const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'mkv'];
const VTT_TYPES = ['text/vtt'];
const SRT_TYPES = ['text/srt', 'application/x-subrip'];

export default class DropHandler {
    constructor(store, converter, youtube) {
        this.store = store;
        this.converter = converter;
        this.youtube = youtube;

        this.onDragOver = this.onDragOver.bind(this);
        this.onDrop = this.onDrop.bind(this);
        this.onPaste = this.onPaste.bind(this);
        this.handleDrop = this.handleDrop.bind(this);
        this.handleFile = this.handleFile.bind(this);
        this.handleText = this.handleText.bind(this);
        this.handleVideo = this.handleVideo.bind(this);
        this.handleSubtitle = this.handleSubtitle.bind(this);
    }

    start() {
        document.addEventListener('dragover', this.onDragOver);
        document.addEventListener('drop', this.onDrop);
        document.addEventListener('paste', this.onPaste);
    }

    onDragOver(event) {
        event.preventDefault();
    }

    onDrop(event) {
        event.preventDefault();

        const { items } = event.dataTransfer;

        Array.from(items).forEach(this.handleDrop);
    }

    onPaste(event) {
        const content = (event.clipboardData || window.clipboardData).getData('text');

        content.split('\n').forEach(line => this.handleText(line.trim()));
    }

    handleDrop(item) {
        const { kind, type } = item;

        switch (kind) {
            case 'file':
                this.handleFile(item.getAsFile());
                break;

            case 'string':
                item.getAsString(this.handleText);
                break;

            default:
                console.info(`Could not handle drop ${kind} ${type}`);
                break;
        }

    }

    handleFile(file) {
        const { name, type } = file;
        const kind = this.resolveFileKind(file);

        switch (kind) {
            case 'video':
                this.handleVideo(file);
                break;

            case 'vtt':
                this.handleSubtitle(file);
                break;

            case 'srt':
                this.handleSrtSubtitle(file);
                break;

            default:
                console.info(`File "${name}" of type "${type}" not supported.`);
                break;
        }
    }

    handleVideo(file) {
        const { player } = this.store.getState();
        const isFileFromServer = player.source === 'file' && player.fromServer;
        const action = isFileFromServer ? completeVideoFromFile : loadVideoFromFile;

        this.store.dispatch(
            action(URL.createObjectURL(file), file.name, file.type)
        );
    }

    handleSubtitle(file) {
        this.store.dispatch(loadSubtitle(URL.createObjectURL(file), file.name));
    }

    handleSrtSubtitle(file) {
        this.converter.srtFileToVttFile(file, this.handleSubtitle);
    }

    handleVideoUrl(url, name, type) {
        this.store.dispatch(loadVideoFromUrl(url, name, type));
    }

    handleSubtitleUrl(url, name, type) {
        this.store.dispatch(loadSubtitle(url, name, type));
    }

    handleSrtSubtitleUrl(url) {
        this.converter.srtUrlToVttFile(url, this.handleSubtitle);
    }

    handleText(value) {
        const id = this.youtube.getVideoId(value);

        if (id) {
            return this.store.dispatch(loadVideoFromYoutube(id));
        }

        const { href, pathname } = this.getUrl(value);

        if (href) {
            return new HeadRequest(href, ['Content-Type', 'Content-Length'], ([type]) => {
                const kind = this.resolveUrlKind(pathname, type);

                switch (kind) {
                    case 'video':
                        this.handleVideoUrl(href, pathname, type);
                        break;

                    case 'vtt':
                        this.handleSubtitleUrl(href, pathname, type);
                        break;

                    case 'srt':
                        this.handleSrtSubtitleUrl(href);
                        break;

                    default:
                        console.info(`Url "${value}" of type "${type}" not supported.`);
                        break;
                }
            }, error => console.error(error));
        }
    }

    /**
     * Determine how a local file should be handled.
     * The extension takes precedence over the MIME type reported by the browser:
     * browsers often report .mkv or .srt files as application/octet-stream or
     * another generic type. The MIME type is only used as a fallback when the
     * extension is unknown.
     */
    resolveFileKind(file) {
        const extensionKind = this.getExtensionKind(this.getExtention(file.name));

        if (extensionKind) {
            return extensionKind;
        }

        return this.getTypeKind(file.type);
    }

    /**
     * Determine how a pasted URL should be handled.
     * Content-Type returned by a HEAD request is frequently wrong for subtitles
     * (text/plain, application/octet-stream, ...), so the URL path extension
     * takes precedence. A generic binary type is only used as a video fallback
     * when the URL has no known extension.
     */
    resolveUrlKind(pathname, type) {
        const extensionKind = this.getExtensionKind(this.getExtention(pathname));

        if (extensionKind) {
            return extensionKind;
        }

        return this.getTypeKind(type, true);
    }

    getExtensionKind(extension) {
        if (VIDEO_EXTENSIONS.includes(extension)) {
            return 'video';
        }

        if (extension === 'vtt') {
            return 'vtt';
        }

        if (extension === 'srt') {
            return 'srt';
        }

        return null;
    }

    getTypeKind(type, allowGenericBinary = false) {
        const mime = this.normalizeType(type);

        if (!mime) {
            return null;
        }

        if (mime.startsWith('video/') || (allowGenericBinary && mime === 'application/octet-stream')) {
            return 'video';
        }

        if (VTT_TYPES.includes(mime)) {
            return 'vtt';
        }

        if (SRT_TYPES.includes(mime)) {
            return 'srt';
        }

        return null;
    }

    normalizeType(type) {
        if (typeof type !== 'string') {
            return null;
        }

        const mime = type.split(';')[0].trim().toLowerCase();

        return mime || null;
    }

    getExtention(filename) {
        if (typeof filename !== 'string') {
            return null;
        }

        const matches = filename.match(FILENAME_MATCHER);

        if (!matches) {
            return null;
        }

        return matches[2].toLowerCase();
    }

    getUrl(value) {
        try {
            return new URL(value);
        } catch (error) {
            return {};
        }
    }
}
