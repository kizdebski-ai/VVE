"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const rooms_1 = require("../src/rooms");
(0, vitest_1.describe)('RoomManager', () => {
    let manager;
    (0, vitest_1.beforeEach)(() => {
        manager = new rooms_1.RoomManager();
    });
    (0, vitest_1.it)('creates rooms and returns owner secrets', () => {
        const room = manager.createRoom({ roomId: 'room_a', displayName: 'Design' });
        (0, vitest_1.expect)(room.roomId).toBe('room_a');
        (0, vitest_1.expect)(room.displayName).toBe('Design');
        (0, vitest_1.expect)(room.ownerSecret).toBeTypeOf('string');
        (0, vitest_1.expect)(room.isArchived).toBe(false);
        const listed = manager.listRooms();
        (0, vitest_1.expect)(listed).toHaveLength(1);
        (0, vitest_1.expect)(listed[0].roomId).toBe('room_a');
    });
    (0, vitest_1.it)('enforces owner secrets when updating rooms', () => {
        const room = manager.createRoom({ roomId: 'secured', ownerName: 'Alice' });
        (0, vitest_1.expect)(() => manager.updateRoom('secured', 'fake-secret', {
            displayName: 'Fail'
        })).toThrow('Invalid owner secret.');
        const updated = manager.updateRoom('secured', room.ownerSecret, {
            displayName: 'All Hands',
            metadata: { topic: 'weekly' }
        });
        (0, vitest_1.expect)(updated.displayName).toBe('All Hands');
        (0, vitest_1.expect)(updated.metadata).toMatchObject({ topic: 'weekly' });
    });
    (0, vitest_1.it)('archives and cleans up inactive rooms', () => {
        const room = manager.createRoom({ roomId: 'to-archive' });
        manager.archiveRoom('to-archive', room.ownerSecret);
        const visible = manager.listRooms();
        (0, vitest_1.expect)(visible).toHaveLength(0);
        const includeArchived = manager.listRooms({ includeArchived: true });
        (0, vitest_1.expect)(includeArchived).toHaveLength(1);
        const lookup = manager.get('stale');
        lookup.room.connections.clear();
        lookup.room.lastActive = 0;
        lookup.room.meta.lastActiveAt = 0;
        manager.cleanup(1);
        const afterCleanup = manager.listRooms({ includeArchived: true });
        (0, vitest_1.expect)(afterCleanup.find((r) => r.roomId === 'stale')).toBeUndefined();
    });
});
//# sourceMappingURL=roomManager.test.js.map