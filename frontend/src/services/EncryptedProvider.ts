import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import { encryptData, decryptData, createIV, IV_LENGTH_BYTES } from '../lib/crypto';

// Message types
const messageSync = 0;
const messageAwareness = 1;

export class EncryptedProvider {
    public ydoc: Y.Doc;
    public awareness: Awareness;
    public socket: WebSocket | null = null;
    public yDrawings: Y.Array<any>;

    private url: string;
    private roomKey: CryptoKey;
    private reconnectTimeout = 1000;
    private maxReconnectTimeout = 10000;
    private reconnectTimer: number | null = null;
    private explicitlyDisconnected = false;
    private listenersAttached = false;

    constructor(url: string, roomKey: CryptoKey, doc: Y.Doc) {
        this.url = url;
        this.roomKey = roomKey;
        this.ydoc = doc;
        this.awareness = new Awareness(doc);
        this.yDrawings = doc.getArray('drawings');

        this.connect();
    }

    private connect() {
        if (this.explicitlyDisconnected) return;

        this.socket = new WebSocket(this.url);
        this.socket.binaryType = 'arraybuffer';

        this.socket.onopen = () => {
            this.reconnectTimeout = 1000;
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }

            // Send initial awareness
            const awarenessState = encodeAwarenessUpdate(this.awareness, [this.awareness.clientID]);
            this.sendEncryptedMessage(messageAwareness, awarenessState);

            if (!this.listenersAttached) {
                this.ydoc.on('update', this.handleYDocUpdate);
                this.awareness.on('update', this.handleAwarenessUpdate);
                this.listenersAttached = true;
            }
        };

        this.socket.onmessage = async (event) => {
            if (event.data instanceof ArrayBuffer) {
                try {
                    const { type, data } = await this.decryptMessage(event.data);

                    if (type === messageSync) {
                        Y.applyUpdate(this.ydoc, data, 'websocketProvider');
                    } else if (type === messageAwareness) {
                        applyAwarenessUpdate(this.awareness, data, 'websocketProvider');
                    }
                } catch (error) {
                    console.error('[EncryptedProvider] Failed to decrypt/handle message:', error);
                }
            }
        };

        this.socket.onclose = () => {
            this.socket = null;
            this.cleanupAwareness();

            if (!this.explicitlyDisconnected) {
                this.reconnectTimer = window.setTimeout(() => {
                    this.connect();
                }, this.reconnectTimeout);
                this.reconnectTimeout = Math.min(this.reconnectTimeout * 2, this.maxReconnectTimeout);
            }
        };
    }

    private handleYDocUpdate = (update: Uint8Array, origin: any) => {
        if (origin !== 'websocketProvider' && this.socket?.readyState === WebSocket.OPEN) {
            this.sendEncryptedMessage(messageSync, update);
        }
    };

    private handleAwarenessUpdate = ({ added, updated, removed }: any, origin: any) => {
        if (origin !== 'websocketProvider' && this.socket?.readyState === WebSocket.OPEN) {
            const changedClients = added.concat(updated, removed);
            const update = encodeAwarenessUpdate(this.awareness, changedClients);
            this.sendEncryptedMessage(messageAwareness, update);
        }
    };

    private async sendEncryptedMessage(type: number, data: Uint8Array) {
        if (!this.socket) return;

        // Pack type + data
        const payload = new Uint8Array(1 + data.length);
        payload[0] = type;
        payload.set(data, 1);

        // Encrypt
        const { ciphertext, iv } = await encryptData(this.roomKey, payload);

        // Pack IV + Ciphertext
        // IV is fixed length (12 bytes)
        const message = new Uint8Array(IV_LENGTH_BYTES + ciphertext.byteLength);
        message.set(iv, 0);
        message.set(new Uint8Array(ciphertext), IV_LENGTH_BYTES);

        this.socket.send(message);
    }

    private async decryptMessage(buffer: ArrayBuffer): Promise<{ type: number, data: Uint8Array }> {
        // Unpack IV + Ciphertext
        const iv = new Uint8Array(buffer.slice(0, IV_LENGTH_BYTES));
        const ciphertext = buffer.slice(IV_LENGTH_BYTES);

        // Decrypt
        const decryptedBuffer = await decryptData(this.roomKey, ciphertext, iv);
        const decrypted = new Uint8Array(decryptedBuffer);

        // Unpack Type + Data
        const type = decrypted[0];
        const data = decrypted.slice(1);

        return { type, data };
    }

    private cleanupAwareness() {
        const knownClientIds = Array.from(this.awareness.getStates().keys());
        removeAwarenessStates(this.awareness, knownClientIds, 'websocketProvider');
    }

    public disconnect() {
        this.explicitlyDisconnected = true;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

        if (this.listenersAttached) {
            this.ydoc.off('update', this.handleYDocUpdate);
            this.awareness.off('update', this.handleAwarenessUpdate);
            this.listenersAttached = false;
        }

        this.cleanupAwareness();
        this.socket?.close();
        this.socket = null;
    }
}
