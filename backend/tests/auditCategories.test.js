const fs = require('fs');
const path = require('path');
const { categorizeAction, CATEGORY } = require('../utils/auditCategories');

/**
 * These tests protect the audit trail's CRUD classification (the thing the
 * admin log viewer groups/filters by). Two failure modes are guarded:
 *
 *   1. A known action lands in the wrong CRUD bucket.
 *   2. A NEW audit.log({ actionType: '...' }) call is added somewhere in the
 *      backend but nobody adds it to ACTION_CATEGORY_MAP — so it silently
 *      degrades to 'Other'. That is exactly how profile updates, password
 *      changes, account deletions and file downloads ended up uncategorised.
 */

describe('categorizeAction — known CRUD mappings', () => {
  const cases = {
    // Create
    register: CATEGORY.CREATE,
    FILE_UPLOADED: CATEGORY.CREATE,
    // Read
    ADMIN_READ_CHAT_LOG: CATEGORY.READ,
    FILE_DOWNLOADED: CATEGORY.READ,
    VOICE_MESSAGE_DOWNLOADED: CATEGORY.READ,
    // Update — the self-service profile/credential actions that were 'Other'
    profile_updated: CATEGORY.UPDATE,
    password_changed: CATEGORY.UPDATE,
    password_change_failed: CATEGORY.UPDATE,
    // Delete — self-service deletion that was 'Other'
    account_deleted: CATEGORY.DELETE,
    account_delete_failed: CATEGORY.DELETE,
    // Login
    login_success: CATEGORY.LOGIN,
    reauth_failed: CATEGORY.LOGIN,
    login_blocked_active_session: CATEGORY.LOGIN,
  };

  for (const [action, expected] of Object.entries(cases)) {
    test(`${action} -> ${expected}`, () => {
      expect(categorizeAction(action)).toBe(expected);
    });
  }

  test('unknown / null actionType falls back to Other', () => {
    expect(categorizeAction('something_not_mapped')).toBe(CATEGORY.OTHER);
    expect(categorizeAction(null)).toBe(CATEGORY.OTHER);
  });
});

describe('every audit actionType emitted in the backend is categorised', () => {
  // Collect all string-literal actionTypes from the route/util source. This
  // catches the "forgot to add it to the map" regression at build time.
  function collectActionTypes() {
    const roots = [path.join(__dirname, '..', 'routes'), path.join(__dirname, '..', 'utils')];
    const found = new Set();
    // Matches: actionType: 'foo'  /  actionType: "foo"  (ignores dynamic ones
    // like `actionType: adminOnly ? ... : ...` and `actionType: fields.x`,
    // whose branches are separately covered as literals elsewhere or aren't
    // literals at all).
    const re = /actionType:\s*['"]([A-Za-z0-9_]+)['"]/g;

    for (const dir of roots) {
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.js')) continue;
        const src = fs.readFileSync(path.join(dir, file), 'utf8');
        let m;
        while ((m = re.exec(src)) !== null) found.add(m[1]);
      }
    }
    return [...found];
  }

  test('no emitted actionType degrades to Other', () => {
    const uncategorised = collectActionTypes().filter(
      (a) => categorizeAction(a) === CATEGORY.OTHER
    );
    expect(uncategorised).toEqual([]);
  });
});
