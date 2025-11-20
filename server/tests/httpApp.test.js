"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const vitest_1 = require("vitest");
const httpApp_1 = require("../src/httpApp");
const rooms_1 = require("../src/rooms");
class StubSolver {
    constructor(responses = {}, shouldThrow = false) {
        this.responses = responses;
        this.shouldThrow = shouldThrow;
    }
    async solveEquation(equation) {
        if (this.shouldThrow) {
            throw new Error('solver offline');
        }
        return this.responses[equation] ?? '42';
    }
}
const createTestApp = (solver) => (0, httpApp_1.createHttpApp)({
    roomManager: new rooms_1.RoomManager(),
    aiSolver: solver ?? new StubSolver()
});
(0, vitest_1.describe)('HTTP API', () => {
    (0, vitest_1.it)('exposes health endpoint', async () => {
        const app = createTestApp();
        const res = await (0, supertest_1.default)(app).get('/health');
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.status).toBe('ok');
    });
    (0, vitest_1.it)('creates and retrieves rooms', async () => {
        const app = createTestApp();
        const createRes = await (0, supertest_1.default)(app).post('/api/rooms/').send({ roomId: 'demo', displayName: 'Demo' });
        (0, vitest_1.expect)(createRes.status).toBe(201);
        (0, vitest_1.expect)(createRes.body.ownerSecret).toBeTypeOf('string');
        const listRes = await (0, supertest_1.default)(app).get('/api/rooms?limit=5');
        (0, vitest_1.expect)(listRes.status).toBe(200);
        (0, vitest_1.expect)(listRes.body.rooms).toHaveLength(1);
        const detailRes = await (0, supertest_1.default)(app).get('/api/rooms/demo');
        (0, vitest_1.expect)(detailRes.status).toBe(200);
        (0, vitest_1.expect)(detailRes.body.roomId).toBe('demo');
    });
    (0, vitest_1.it)('validates AI solver input', async () => {
        const app = createTestApp();
        const res = await (0, supertest_1.default)(app).post('/api/ai/solve-equation/').send({});
        (0, vitest_1.expect)(res.status).toBe(400);
    });
    (0, vitest_1.it)('returns AI solver results', async () => {
        const app = createTestApp(new StubSolver({ '2x+2=4': 'x = 1' }));
        const res = await (0, supertest_1.default)(app).post('/api/ai/solve-equation/').send({ equation: '2x+2=4' });
        (0, vitest_1.expect)(res.status).toBe(200);
        (0, vitest_1.expect)(res.body.solution).toBe('x = 1');
    });
    (0, vitest_1.it)('surface errors from AI solver', async () => {
        const app = createTestApp(new StubSolver({}, true));
        const res = await (0, supertest_1.default)(app).post('/api/ai/solve-equation/').send({ equation: '1+1=2' });
        (0, vitest_1.expect)(res.status).toBe(502);
        (0, vitest_1.expect)(res.body.error).toBeTruthy();
    });
});
//# sourceMappingURL=httpApp.test.js.map