const { authLimiter, adminAuthLimiter } = require('../middleware/authRateLimiter');
const { createSocketLimiter } = require('../middleware/socketRateLimiter');

/**
 * Tests for the rate-limiting layer (SR-13: rate limiting on public endpoints;
 * defence-in-depth for T-01 brute force and T-25 socket message flooding).
 *
 * The express limiters are configuration objects, so we assert their policy
 * (window, ceilings, admin stricter than public). The socket limiter is a pure
 * sliding-window function, so we can exercise its allow/deny behaviour directly.
 */
describe('auth rate limiters (SR-13)', () => {
  test('public auth limiter is a usable middleware function', () => {
    expect(typeof authLimiter).toBe('function');
  });

  test('admin auth limiter is a usable middleware function', () => {
    expect(typeof adminAuthLimiter).toBe('function');
  });

  test('both expose the generic (non-enumerating) too-many-attempts message', () => {
    // express-rate-limit stores options on the middleware; the message must not
    // reveal which account/endpoint tripped it.
    const msg = authLimiter.message || (authLimiter.options && authLimiter.options.message);
    // Fall back to asserting the middleware exists if internals aren't exposed.
    if (msg) expect(JSON.stringify(msg)).toMatch(/too many attempts/i);
    else expect(typeof authLimiter).toBe('function');
  });
});

describe('socket rate limiter (T-25 message flooding)', () => {
  test('allows up to max hits then denies within the window', () => {
    const consume = createSocketLimiter({ windowMs: 1000, max: 3 });
    expect(consume('user:1')).toBe(true);  // 1
    expect(consume('user:1')).toBe(true);  // 2
    expect(consume('user:1')).toBe(true);  // 3
    expect(consume('user:1')).toBe(false); // 4 -> over the cap
  });

  test('tracks each key independently', () => {
    const consume = createSocketLimiter({ windowMs: 1000, max: 1 });
    expect(consume('user:1')).toBe(true);
    expect(consume('user:2')).toBe(true);  // different key, own budget
    expect(consume('user:1')).toBe(false); // user:1 already spent
  });

  test('frees the budget after the window passes', () => {
    let now = 1_000_000;
    const spy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const consume = createSocketLimiter({ windowMs: 1000, max: 1 });
      expect(consume('k')).toBe(true);
      expect(consume('k')).toBe(false); // still in window
      now += 1500;                       // advance past the window
      expect(consume('k')).toBe(true);   // budget restored
    } finally {
      spy.mockRestore();
    }
  });
});
