import fs from 'fs/promises';
import path from 'path';
import * as Y from 'yjs';
import { RoomMetadata } from './rooms';
import { logger } from './logger';

export interface PersistenceLayer {
    saveRoom(roomId: string, doc: Y.Doc, meta: RoomMetadata): Promise<void>;
    loadRoom(roomId: string): Promise<{ doc: Y.Doc; meta: RoomMetadata } | null>;
    listRooms(): Promise<RoomMetadata[]>;
    deleteRoom(roomId: string): Promise<void>;
}

export class FilePersistence implements PersistenceLayer {
    private dataDir: string;

    constructor(dataDir: string) {
        this.dataDir = dataDir;
    }

    private async ensureDir() {
        try {
            await fs.mkdir(this.dataDir, { recursive: true });
        } catch (error) {
            logger.error('Failed to create data directory', { error });
        }
    }

    private getFilePath(roomId: string, ext: string) {
        // Sanitize roomId to prevent directory traversal
        const safeId = roomId.replace(/[^a-zA-Z0-9_-]/g, '');
        return path.join(this.dataDir, `${safeId}.${ext}`);
    }

    async saveRoom(roomId: string, doc: Y.Doc, meta: RoomMetadata): Promise<void> {
        try {
            await this.ensureDir();
            const docState = Y.encodeStateAsUpdate(doc);
            const metaJson = JSON.stringify(meta, null, 2);

            await fs.writeFile(this.getFilePath(roomId, 'bin'), Buffer.from(docState));
            await fs.writeFile(this.getFilePath(roomId, 'json'), metaJson, 'utf-8');

            logger.debug('Saved room to disk', { roomId });
        } catch (error) {
            logger.error('Failed to save room', { roomId, error });
        }
    }

    async loadRoom(roomId: string): Promise<{ doc: Y.Doc; meta: RoomMetadata } | null> {
        try {
            await this.ensureDir();
            const metaPath = this.getFilePath(roomId, 'json');
            const binPath = this.getFilePath(roomId, 'bin');

            // Check if files exist
            try {
                await fs.access(metaPath);
                await fs.access(binPath);
            } catch {
                return null;
            }

            const metaContent = await fs.readFile(metaPath, 'utf-8');
            const meta = JSON.parse(metaContent) as RoomMetadata;

            const binContent = await fs.readFile(binPath);
            const doc = new Y.Doc();
            Y.applyUpdate(doc, new Uint8Array(binContent));

            return { doc, meta };
        } catch (error) {
            logger.error('Failed to load room', { roomId, error });
            return null;
        }
    }

    async listRooms(): Promise<RoomMetadata[]> {
        try {
            await this.ensureDir();
            const files = await fs.readdir(this.dataDir);
            const jsonFiles = files.filter(f => f.endsWith('.json'));
            const rooms: RoomMetadata[] = [];

            for (const file of jsonFiles) {
                try {
                    const content = await fs.readFile(path.join(this.dataDir, file), 'utf-8');
                    const meta = JSON.parse(content) as RoomMetadata;
                    rooms.push(meta);
                } catch (err) {
                    logger.warn('Failed to parse room metadata', {
                        file,
                        message: (err as Error).message,
                        error: err
                    });
                }
            }

            return rooms;
        } catch (error) {
            logger.error('Failed to list rooms', { error });
            return [];
        }
    }

    async deleteRoom(roomId: string): Promise<void> {
        try {
            await fs.unlink(this.getFilePath(roomId, 'json')).catch(() => { });
            await fs.unlink(this.getFilePath(roomId, 'bin')).catch(() => { });
        } catch (error) {
            logger.error('Failed to delete room files', { roomId, error });
        }
    }
}
