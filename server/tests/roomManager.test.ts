import { describe, expect, it, beforeEach } from 'vitest';

import { RoomManager } from '../src/rooms';

describe('RoomManager', () => {
  let manager: RoomManager;

  beforeEach(() => {
    manager = new RoomManager();
  });

  it('creates rooms and returns owner secrets', () => {
    const room = manager.createRoom({ roomId: 'room_a', displayName: 'Design' });
    expect(room.roomId).toBe('room_a');
    expect(room.displayName).toBe('Design');
    expect(room.ownerSecret).toBeTypeOf('string');
    expect(room.isArchived).toBe(false);

    const listed = manager.listRooms();
    expect(listed).toHaveLength(1);
    expect(listed[0].roomId).toBe('room_a');
  });

  it('enforces owner secrets when updating rooms', () => {
    const room = manager.createRoom({ roomId: 'secured', ownerName: 'Alice' });
    expect(() =>
      manager.updateRoom('secured', 'fake-secret', {
        displayName: 'Fail'
      })
    ).toThrow('Invalid owner secret.');

    const updated = manager.updateRoom('secured', room.ownerSecret, {
      displayName: 'All Hands',
      metadata: { topic: 'weekly' }
    });
    expect(updated.displayName).toBe('All Hands');
    expect(updated.metadata).toMatchObject({ topic: 'weekly' });
  });

  it('archives and cleans up inactive rooms', () => {
    const room = manager.createRoom({ roomId: 'to-archive' });
    manager.archiveRoom('to-archive', room.ownerSecret);
    const visible = manager.listRooms();
    expect(visible).toHaveLength(0);
    const includeArchived = manager.listRooms({ includeArchived: true });
    expect(includeArchived).toHaveLength(1);

    const lookup = manager.get('stale');
    lookup.room.connections.clear();
    lookup.room.lastActive = 0;
    lookup.room.meta.lastActiveAt = 0;
    manager.cleanup(1);
    const afterCleanup = manager.listRooms({ includeArchived: true });
    expect(afterCleanup.find((r) => r.roomId === 'stale')).toBeUndefined();
  });
});
