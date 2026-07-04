// Demonstrates the payoff of the Controller → Service → Repository layering:
// each layer is unit-testable in isolation by injecting a fake collaborator —
// no database, no Express server, no environment.

// The controller's error path logs via winstonLogger; mock it so the test
// doesn't touch winston/loki.
jest.mock('../utils/winstonLogger', () => ({
  system: { error: jest.fn(), info: jest.fn() },
}));

const { ExpertService } = require('../services/ExpertService');
const { ExpertController } = require('../controllers/ExpertController');

describe('ExpertService (unit, fake repository)', () => {
  test('returns the approved experts the repository provides', async () => {
    const fakeRepo = {
      findApprovedExperts: jest.fn().mockResolvedValue([{ id: 3, name: 'Bob Chen' }]),
    };
    const service = new ExpertService(fakeRepo);

    await expect(service.listApprovedExperts()).resolves.toEqual([{ id: 3, name: 'Bob Chen' }]);
    expect(fakeRepo.findApprovedExperts).toHaveBeenCalledTimes(1);
  });
});

describe('ExpertController (unit, fake service)', () => {
  function mockRes() {
    return { json: jest.fn(), status: jest.fn().mockReturnThis() };
  }

  test('responds { experts } on success', async () => {
    const fakeService = {
      listApprovedExperts: jest.fn().mockResolvedValue([{ id: 3, name: 'Bob Chen' }]),
    };
    const controller = new ExpertController(fakeService);
    const res = mockRes();

    await controller.list({}, res);

    expect(res.json).toHaveBeenCalledWith({ experts: [{ id: 3, name: 'Bob Chen' }] });
    expect(res.status).not.toHaveBeenCalled();
  });

  test('responds 500 with a generic error when the service throws', async () => {
    const fakeService = {
      listApprovedExperts: jest.fn().mockRejectedValue(new Error('db down')),
    };
    const controller = new ExpertController(fakeService);
    const res = mockRes();

    await controller.list({}, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Could not load experts.' });
  });
});
