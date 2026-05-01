jest.mock('../../config/db', () => ({
  pool: { query: jest.fn() },
}));

const { pool } = require('../../config/db');
const { canAccessSubmission, canDiscussSubmission } = require('../../middleware/access');

describe('middleware/access - canAccessSubmission()', () => {
  beforeEach(() => {
    pool.query.mockReset();
  });

  test('returns false when user is missing', async () => {
    expect(await canAccessSubmission(null, { id: 1, user_id: 2 })).toBe(false);
  });

  test('returns false when submission is missing', async () => {
    expect(await canAccessSubmission({ id: 1, role: 'admin' }, null)).toBe(false);
  });

  test('admins always have access', async () => {
    const result = await canAccessSubmission(
      { id: 99, role: 'admin' },
      { id: 1, user_id: 2 }
    );
    expect(result).toBe(true);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('editors always have access', async () => {
    const result = await canAccessSubmission(
      { id: 99, role: 'editor' },
      { id: 1, user_id: 2 }
    );
    expect(result).toBe(true);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('the submission author has access', async () => {
    const result = await canAccessSubmission(
      { id: 5, role: 'submitter' },
      { id: 1, user_id: 5 }
    );
    expect(result).toBe(true);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('an assigned reviewer has access', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const result = await canAccessSubmission(
      { id: 7, role: 'reviewer' },
      { id: 1, user_id: 5 }
    );
    expect(result).toBe(true);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('a reviewer not assigned is denied', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const result = await canAccessSubmission(
      { id: 7, role: 'reviewer' },
      { id: 1, user_id: 5 }
    );
    expect(result).toBe(false);
  });

  test('an unrelated submitter is denied', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const result = await canAccessSubmission(
      { id: 8, role: 'submitter' },
      { id: 1, user_id: 5 }
    );
    expect(result).toBe(false);
  });
});

describe('middleware/access - canDiscussSubmission()', () => {
  beforeEach(() => {
    pool.query.mockReset();
  });

  test('admins can always discuss', async () => {
    const result = await canDiscussSubmission(
      { id: 1, role: 'admin' },
      { id: 1, user_id: 5 }
    );
    expect(result).toBe(true);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('editors can always discuss', async () => {
    const result = await canDiscussSubmission(
      { id: 2, role: 'editor' },
      { id: 1, user_id: 5 }
    );
    expect(result).toBe(true);
  });

  test('the submitting author CANNOT see the discussion on their own submission', async () => {
    const result = await canDiscussSubmission(
      { id: 5, role: 'submitter' },
      { id: 1, user_id: 5 }
    );
    expect(result).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('a submitter who is also somehow the author with role=editor still bypasses (admin/editor wins)', async () => {
    // Defensive: even if a staff member happens to author a submission, the
    // admin/editor short-circuit grants discussion access.
    const result = await canDiscussSubmission(
      { id: 5, role: 'editor' },
      { id: 1, user_id: 5 }
    );
    expect(result).toBe(true);
  });

  test('an assigned reviewer can discuss', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const result = await canDiscussSubmission(
      { id: 7, role: 'reviewer' },
      { id: 1, user_id: 5 }
    );
    expect(result).toBe(true);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('a reviewer NOT assigned to this submission is denied', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const result = await canDiscussSubmission(
      { id: 7, role: 'reviewer' },
      { id: 1, user_id: 5 }
    );
    expect(result).toBe(false);
  });

  test('an unrelated submitter is denied', async () => {
    const result = await canDiscussSubmission(
      { id: 8, role: 'submitter' },
      { id: 1, user_id: 5 }
    );
    expect(result).toBe(false);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
