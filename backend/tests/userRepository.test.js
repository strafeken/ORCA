const mockQuery = jest.fn();
jest.mock('../db/pool', () => ({ promise: () => ({ query: mockQuery }) }));

const { UserRepository } = require('../repositories/UserRepository');

/**
 * Tests for repositories/UserRepository.js — user data access.
 *
 * Maps to SR-22 (soft/hard lockout state persistence), SR-20 (only approved
 * experts are visible), and FR-06 (expert directory excludes locked/deleted
 * accounts). Asserts the SQL intent so security filters (is_approved,
 * is_hard_locked, deleted-account exclusion) can't silently regress.
 */
describe('UserRepository', () => {
  const repo = new UserRepository();
  afterEach(() => jest.clearAllMocks());

  test('findByEmail returns the user row or null', async () => {
    mockQuery.mockResolvedValueOnce([[{ id: 1, email: 'john@orca.com' }]]);
    expect((await repo.findByEmail('john@orca.com')).id).toBe(1);
    mockQuery.mockResolvedValueOnce([[]]);
    expect(await repo.findByEmail('missing@orca.com')).toBeNull();
  });

  test('resetFailedAttempts clears counter and soft lock (SR-22)', async () => {
    mockQuery.mockResolvedValue([{}]);
    await repo.resetFailedAttempts(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/failed_attempts = 0/i);
    expect(sql).toMatch(/is_soft_locked = FALSE/i);
    expect(params).toEqual([1]);
  });

  test('incrementFailedAttempts sets the new count', async () => {
    mockQuery.mockResolvedValue([{}]);
    await repo.incrementFailedAttempts(1, 3);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/failed_attempts = \?/i);
    expect(params).toEqual([3, 1]);
  });

  test('applySoftLock sets soft-lock state with an until timestamp (SR-22)', async () => {
    mockQuery.mockResolvedValue([{}]);
    const until = new Date();
    await repo.applySoftLock(1, 5, until);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/is_soft_locked = TRUE/i);
    expect(params).toEqual([5, until, 1]);
  });

  test('applyHardLock sets hard-lock state (Admin-reset required, SR-22)', async () => {
    mockQuery.mockResolvedValue([{}]);
    await repo.applyHardLock(1, 10);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/is_hard_locked = TRUE/i);
    expect(params).toEqual([10, 1]);
  });

  test('findAvailableExpertById only returns approved, unlocked experts (SR-20)', async () => {
    mockQuery.mockResolvedValue([[{ id: 3, name: 'Bob', bio: 'expert' }]]);
    await repo.findAvailableExpertById(3);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/role = 'expert'/i);
    expect(sql).toMatch(/is_approved = TRUE/i);
    expect(sql).toMatch(/is_hard_locked = FALSE/i);
    // Deleted accounts (email suffix) are excluded.
    expect(sql).toMatch(/email NOT LIKE/i);
  });

  test('findApprovedExperts excludes locked and deleted accounts (FR-06)', async () => {
    mockQuery.mockResolvedValue([[{ id: 3, name: 'Bob' }]]);
    const experts = await repo.findApprovedExperts();
    expect(Array.isArray(experts)).toBe(true);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/is_approved = TRUE/i);
    expect(sql).toMatch(/is_hard_locked = FALSE/i);
    expect(sql).toMatch(/email NOT LIKE/i);
    expect(sql).toMatch(/ORDER BY name ASC/i);
  });
});
