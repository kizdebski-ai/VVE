// server/src/yjs/boardDoc.ts

import * as Y from 'yjs';
import { BoardSnapshot, BoardObject, BoardPatch } from '../models/boardSnapshot';

const DEFAULT_ARRAY_NAME = 'drawings'; // musi być spójne z frontendem (yDrawings)

export class BoardDoc {
    constructor(
        private readonly doc: Y.Doc,
        private readonly arrayName: string = DEFAULT_ARRAY_NAME,
    ) { }

    /**
     * Normalizuje wartość z Yjs (Y.Array lub zwykły Array) do zwykłej tablicy JS.
     */
    private normalizeYArray<T = unknown>(value: any): T[] | null {
        if (!value) return null;
        if (Array.isArray(value)) return value as T[];
        if (typeof value === 'object' && typeof value.toArray === 'function') {
            return (value.toArray() as T[]) ?? null;
        }
        return null;
    }

    /**
     * Zwraca aktualny snapshot tablicy w formacie BoardSnapshot
     * na podstawie Y.Doc.
     */
    public getSnapshot(): BoardSnapshot {
        const arr = this.doc.getArray<Y.Map<unknown>>(this.arrayName);
        const objects: BoardObject[] = [];

        arr.forEach((m) => {
            if (!m) return;

            const id = String(m.get('id') ?? '');
            const type = String(m.get('type') ?? '');
            if (!id || !type) return; // ignorujemy śmieciowe / uszkodzone wpisy

            const obj: BoardObject = {
                id,
                type,
                x: Number(m.get('x') ?? 0),
                y: Number(m.get('y') ?? 0),
            };

            const assignIfHas = (key: keyof BoardObject, yKey?: string) => {
                const yName = yKey ?? (key as string);
                if (m.has(yName)) {
                    (obj as any)[key] = m.get(yName) as any;
                }
            };

            // Podstawowe propsy
            assignIfHas('width');
            assignIfHas('height');
            assignIfHas('rotation');
            assignIfHas('text');
            assignIfHas('latex');
            assignIfHas('expression');
            assignIfHas('xRange');
            assignIfHas('selected');

            // Styl
            assignIfHas('lineWidth');
            assignIfHas('lineStyle');
            assignIfHas('arrowStyle');
            assignIfHas('strokeColor');
            assignIfHas('fillColor');
            assignIfHas('color');
            assignIfHas('fillOpacity');
            assignIfHas('fillStyle');
            assignIfHas('roughness');
            assignIfHas('hachureGap');
            assignIfHas('strokeMode');

            // Start / end (np. dla line z arrow)
            assignIfHas('start');
            assignIfHas('end');

            // Pen / odręczne
            assignIfHas('penStyle');
            assignIfHas('penConfig');
            assignIfHas('timestamp');

            // Points
            if (m.has('points')) {
                const raw = this.normalizeYArray<any>(m.get('points'));
                if (raw) {
                    obj.points = raw.map((p) => ({
                        x: Number(p.x),
                        y: Number(p.y),
                    }));
                }
            }

            if (m.has('rawPoints')) {
                const raw = this.normalizeYArray<any>(m.get('rawPoints'));
                if (raw) {
                    obj.rawPoints = raw.map((p) => ({
                        x: Number(p.x),
                        y: Number(p.y),
                        ...(p.t !== undefined ? { t: Number(p.t) } : {}),
                    }));
                }
            }

            if (m.has('smoothedPoints')) {
                const raw = this.normalizeYArray<any>(m.get('smoothedPoints'));
                if (raw) {
                    obj.smoothedPoints = raw.map((p) => ({
                        x: Number(p.x),
                        y: Number(p.y),
                    }));
                }
            }

            // Ogólne style / metadane (mogą być zwykłym obiektem lub Y.Map)
            if (m.has('style')) {
                const styleVal = m.get('style') as any;
                if (styleVal && typeof styleVal === 'object') {
                    if (typeof styleVal.toJSON === 'function') {
                        obj.style = styleVal.toJSON();
                    } else {
                        obj.style = { ...(styleVal as object) };
                    }
                }
            }

            objects.push(obj);
        });

        return { objects };
    }

    /**
     * Aplikuje BoardPatch do Y.Doc:
     * - updates: zmienia istniejące obiekty
     * - creates: dodaje nowe obiekty
     * - deletes: usuwa obiekty po ID z Y.Array
     */
    public applyPatch(patch: BoardPatch): void {
        const arr = this.doc.getArray<Y.Map<unknown>>(this.arrayName);

        this.doc.transact(() => {
            // Mapowanie ID -> Y.Map + ID -> index w Y.Array
            const idToMap = new Map<string, Y.Map<unknown>>();
            const idToIndex = new Map<string, number>();

            arr.forEach((m, index) => {
                const idVal = m.get('id');
                if (!idVal) return;
                const id = String(idVal);
                idToMap.set(id, m);
                idToIndex.set(id, index);
            });

            // --- UPDATES ---
            for (const upd of patch.updates ?? []) {
                const target = idToMap.get(upd.id);
                if (!target) continue;

                for (const [key, value] of Object.entries(upd.props)) {
                    // Nie zapisujemy undefined – to „brak zmiany”
                    if (value === undefined) continue;
                    target.set(key, value as unknown);
                }
            }

            // --- CREATES ---
            for (const obj of patch.creates ?? []) {
                const m = new Y.Map<unknown>();

                // Jeżeli agent nie podał ID – generujemy proste losowe
                if (!obj.id) {
                    obj.id = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                }

                for (const [key, value] of Object.entries(obj)) {
                    if (value === undefined) continue;
                    m.set(key, value as unknown);
                }

                arr.push([m]);
            }

            // --- DELETES ---
            const deleteIds = patch.deletes ?? [];
            if (deleteIds.length > 0) {
                const indicesToDelete: number[] = [];

                for (const id of deleteIds) {
                    const idx = idToIndex.get(id);
                    if (idx !== undefined) {
                        indicesToDelete.push(idx);
                    }
                }

                // Usuwamy od największego indexu, żeby nie popsuć offsetów
                indicesToDelete.sort((a, b) => b - a);

                for (const idx of indicesToDelete) {
                    arr.delete(idx, 1);
                }
            }
        });
    }
}
