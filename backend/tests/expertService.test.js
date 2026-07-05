// ExpertService -> UserRepository -> db/pool -> winstonLogger, which connects
// to Loki on load. Mock the logger (and pool) so the import chain is inert;
// the test injects its own fake repository anyway.
jest.mock('../utils/winstonLogger', () => ({
  system: { info: jest.fn(), error: jest.fn() },
  audit: { log: jest.fn() },
}));
jest.mock('../db/pool', () => ({ promise: () => ({ query: jest.fn() }) }));

const { ExpertService } = require('../services/ExpertService');

/**
 * Tests for services/ExpertService.js — expert directory business logic (FR-06).
 * The service takes an injected repository, so we pass a fake to verify it
 * delegates directory reads without touching a database.
 */
describe('ExpertService (FR-06)', () => {
  test('listApprovedExperts delegates to the repository', async () => {
    const fakeRepo = {
      findApprovedExperts: jest.fn().mockResolvedValue([{ id: 1, name: 'Bob' }]),
    };
    const service = new ExpertService(fakeRepo);
    const experts = await service.listApprovedExperts();
    expect(experts).toEqual([{ id: 1, name: 'Bob' }]);
    expect(fakeRepo.findApprovedExperts).toHaveBeenCalledTimes(1);
  });

  test('propagates an empty directory', async () => {
    const fakeRepo = { findApprovedExperts: jest.fn().mockResolvedValue([]) };
    const service = new ExpertService(fakeRepo);
    expect(await service.listApprovedExperts()).toEqual([]);
  });
});
