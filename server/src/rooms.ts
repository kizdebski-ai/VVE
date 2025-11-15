import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import WebSocket from 'ws';

export interface RoomContext {
  id: string;
  doc: Y.Doc;
  awareness: Awareness;
  connections: Map<WebSocket, Set<number>>;
  lastActive: number;
  initialized?: boolean;
}

export interface RoomLookup {
  room: RoomContext;
  created: boolean;
}

export class RoomManager {
  private rooms = new Map<string, RoomContext>();

  get(roomId: string): RoomLookup {
    let room = this.rooms.get(roomId);
    let created = false;
    if (!room) {
      const doc = new Y.Doc();
      const awareness = new Awareness(doc);
      room = {
        id: roomId,
        doc,
        awareness,
        connections: new Map(),
        lastActive: Date.now(),
        initialized: false
      };
      this.rooms.set(roomId, room);
      created = true;
    } else {
      room.lastActive = Date.now();
    }
    return { room: room!, created };
  }

  delete(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    room.doc.destroy();
    this.rooms.delete(roomId);
    return true;
  }

  cleanup(ttlMs: number) {
    const now = Date.now();
    for (const [roomId, room] of this.rooms.entries()) {
      if (room.connections.size === 0 && now - room.lastActive > ttlMs) {
        this.delete(roomId);
      }
    }
  }

  size() {
    return this.rooms.size;
  }

  snapshot() {
    return Array.from(this.rooms.values()).map((room) => ({
      id: room.id,
      clients: room.connections.size,
      lastActive: room.lastActive
    }));
  }
}

export const roomManager = new RoomManager();
