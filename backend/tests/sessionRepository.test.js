// Mock the DB pool before requiring the repository.
const mockQuery = jest.fn();
jest.mock('../db/pool', () => ({ promise: () => ({ query: mockQuery }) }));

const { SessionRepository } = require('../repositories/SessionRepository');

/**
 * Tests for repositories/SessionRepository.js — the session data layer.
 *
 * Maps to SR-18 (tokens stored as hashes, invalidated on logout), SR-23
 * (limit concurrent sessions — countLiveSessions), and SR-24 (terminate
 * sessions). Each test asserts the correct SQL intent and parameters, so a
 * refactor that breaks the security semantics (e.g. forgetting the
 * revoked = FALSE filter) is caught.
 */
describe('SessionRepository', () => {
  const repo = new SessionRepository();
  afterEach(() => jest.clearAllMocks());

  test('create stores token HASHES, never raw tokens (SR-18)', async () => {
    mockQuery.mockResolvedValue([{}]);
    await repo.create({
      userId: 1,
      tokenHash: 'accessHash',
      refreshTokenHash: 'refreshHash',
      sourceIp: '1.2.3.4',
      userAgent: 'jest',
      expiresAt: new Date(),
    });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO sessions/i);
    expect(params).toContain('accessHash');
    expect(params).toContain('refreshHash');
    expect(params[0]).toBe(1);
  });

  test('countLiveSessions filters to unrevoked, unexpired rows (SR-23)', async () => {
    mockQuery.mockResolvedValue([[{ active: 3 }]]);
    const n = await repo.countLiveSessions(42);
    expect(n).toBe(3);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/revoked = FALSE/i);
    expect(sql).toMatch(/expires_at > NOW\(\)/i);
  });

  test('revokeByRefreshHash marks the session revoked (logout, SR-18)', async () => {
    mockQuery.mockResolvedValue([{}]);
    await repo.revokeByRefreshHash('refreshHash');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/UPDATE sessions SET revoked = TRUE/i);
    expect(sql).toMatch(/refresh_token_hash/i);
    expect(params).toEqual(['refreshHash']);
  });

  test('revokeByAccessHash marks the session revoked by access hash', async () => {
    mockQuery.mockResolvedValue([{}]);
    await repo.revokeByAccessHash('accessHash');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/token_hash = \?/i);
    expect(params).toEqual(['accessHash']);
  });

  test('findByTokenHash returns the row when present, excluding revoked', async () => {
    mockQuery.mockResolvedValue([[{ id: 5, revoked: 0, last_activity: new Date() }]]);
    const row = await repo.findByTokenHash('h');
    expect(row.id).toBe(5);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/revoked = FALSE/i);
  });

  test('findByTokenHash returns null when no row matches', async () => {
    mockQuery.mockResolvedValue([[]]);
    expect(await repo.findByTokenHash('missing')).toBeNull();
  });

  test('findLiveByTokenHash enforces both revoked and expiry checks', async () => {
    mockQuery.mockResolvedValue([[{ id: 9, last_activity: new Date() }]]);
    await repo.findLiveByTokenHash('h');
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/revoked = FALSE/i);
    expect(sql).toMatch(/expires_at > NOW\(\)/i);
  });

  test('isLiveById returns true only when a live row exists', async () => {
    mockQuery.mockResolvedValueOnce([[{ id: 1 }]]);
    expect(await repo.isLiveById(1)).toBe(true);
    mockQuery.mockResolvedValueOnce([[]]);
    expect(await repo.isLiveById(2)).toBe(false);
  });

  test('revokeById revokes exactly one session', async () => {
    mockQuery.mockResolvedValue([{}]);
    await repo.revokeById(7);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/UPDATE sessions SET revoked = TRUE WHERE id = \?/i);
    expect(params).toEqual([7]);
  });

  test('touch slides the inactivity window (updates last_activity)', async () => {
    mockQuery.mockResolvedValue([{}]);
    await repo.touch(7);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/last_activity = NOW\(\)/i);
    expect(params).toEqual([7]);
  });

  test('sweepIdleSessions revokes only this user\'s idle, unrevoked rows', async () => {
    mockQuery.mockResolvedValue([{}]);
    await repo.sweepIdleSessions(42, 15);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/revoked = TRUE/i);
    expect(sql).toMatch(/revoked = FALSE/i); // only affects currently-live rows
    expect(params).toEqual([42]);
  });
});
