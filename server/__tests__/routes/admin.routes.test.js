jest.mock('../../config/db', () => ({
  pool: { query: jest.fn().mockResolvedValue({ rows: [] }) },
}));
jest.mock('../../models/User');
jest.mock('../../models/Submission');

const request = require('supertest');
const { pool } = require('../../config/db');
const User = require('../../models/User');
const Submission = require('../../models/Submission');
const app = require('../../app');
const { generateToken } = require('../../middleware/auth');

const adminToken     = generateToken({ id: 1, email: 'admin@x.com',  role: 'admin' });
const editorToken    = generateToken({ id: 2, email: 'editor@x.com', role: 'editor' });
const submitterToken = generateToken({ id: 3, email: 'sub@x.com',    role: 'submitter' });

describe('routes/admin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockReset().mockResolvedValue({ rows: [] });
  });

  describe('authn / authz gating', () => {
    test('401 without token', async () => {
      const res = await request(app).get('/api/admin/users');
      expect(res.status).toBe(401);
    });

    test('403 for non-admin', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${editorToken}`);
      expect(res.status).toBe(403);
    });

    test('403 for submitter', async () => {
      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${submitterToken}`);
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/admin/users', () => {
    test('returns all users', async () => {
      User.findAll.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ id: 1 }, { id: 2 }]);
    });
  });

  describe('PUT /api/admin/users/:id/role', () => {
    test('400 on invalid role', async () => {
      const res = await request(app)
        .put('/api/admin/users/5/role')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'overlord' });
      expect(res.status).toBe(400);
    });

    test('404 when user missing', async () => {
      User.findById.mockResolvedValue(undefined);
      const res = await request(app)
        .put('/api/admin/users/5/role')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'editor' });
      expect(res.status).toBe(404);
    });

    test('200 on success', async () => {
      User.findById.mockResolvedValue({ id: 5, email: 'a@b.com', role: 'submitter' });
      User.updateRole.mockResolvedValue({ id: 5, email: 'a@b.com', role: 'editor' });
      const res = await request(app)
        .put('/api/admin/users/5/role')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'editor' });
      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe('editor');
    });
  });

  describe('DELETE /api/admin/users/:id', () => {
    test('400 when admin tries to delete themselves', async () => {
      User.findById.mockResolvedValue({ id: 1 });
      const res = await request(app)
        .delete('/api/admin/users/1')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(400);
    });

    test('200 when admin deletes another user', async () => {
      User.findById.mockResolvedValue({ id: 5 });
      User.findSubmissionFilesForUser.mockResolvedValue([]);
      User.deleteById.mockResolvedValue(1);
      const res = await request(app)
        .delete('/api/admin/users/5')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(User.deleteById).toHaveBeenCalledWith(5);
    });
  });

  describe('POST /api/admin/assign', () => {
    test('404 when submission missing', async () => {
      Submission.findBySubmissionId.mockResolvedValue(undefined);
      const res = await request(app)
        .post('/api/admin/assign')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ submission_id: 'KCR-0001', reviewer_id: 7 });
      expect(res.status).toBe(404);
    });

    test('400 when reviewer is wrong role', async () => {
      Submission.findBySubmissionId.mockResolvedValue({ id: 1, status: 'pending' });
      User.findById.mockResolvedValue({ id: 7, role: 'submitter' });
      const res = await request(app)
        .post('/api/admin/assign')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ submission_id: 'KCR-0001', reviewer_id: 7 });
      expect(res.status).toBe(400);
    });

    test('201 inserts assignment + bumps status', async () => {
      Submission.findBySubmissionId.mockResolvedValue({
        id: 1, submission_id: 'KCR-0001', status: 'pending',
      });
      User.findById.mockResolvedValue({
        id: 7, role: 'reviewer', first_name: 'R', last_name: 'V',
      });
      pool.query.mockResolvedValueOnce({});
      Submission.updateStatus.mockResolvedValue({});

      const res = await request(app)
        .post('/api/admin/assign')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ submission_id: 'KCR-0001', reviewer_id: 7 });

      expect(res.status).toBe(201);
      expect(Submission.updateStatus).toHaveBeenCalledWith(1, 'in_review');
    });
  });

  describe('DELETE /api/admin/assign/:submissionId/:reviewerId', () => {
    test('404 when submission missing', async () => {
      Submission.findBySubmissionId.mockResolvedValue(undefined);
      const res = await request(app)
        .delete('/api/admin/assign/KCR-0001/7')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
    });

    test('404 when no assignment row matches', async () => {
      Submission.findBySubmissionId.mockResolvedValue({ id: 1 });
      pool.query.mockResolvedValueOnce({ rowCount: 0 });
      const res = await request(app)
        .delete('/api/admin/assign/KCR-0001/7')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
    });

    test('200 when an assignment is removed', async () => {
      Submission.findBySubmissionId.mockResolvedValue({ id: 1 });
      pool.query.mockResolvedValueOnce({ rowCount: 1 });
      const res = await request(app)
        .delete('/api/admin/assign/KCR-0001/7')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/admin/workload', () => {
    test('returns workload rows', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 1, assigned_count: '5' }],
      });
      const res = await request(app)
        .get('/api/admin/workload')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ id: 1, assigned_count: '5' }]);
    });
  });

  describe('PUT /api/admin/submissions/bulk-status', () => {
    test('400 on empty list', async () => {
      const res = await request(app)
        .put('/api/admin/submissions/bulk-status')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ submission_ids: [], status: 'accepted' });
      expect(res.status).toBe(400);
    });

    test('400 on invalid status', async () => {
      const res = await request(app)
        .put('/api/admin/submissions/bulk-status')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ submission_ids: ['KCR-0001'], status: 'banana' });
      expect(res.status).toBe(400);
    });

    test('200 returns count of updated submissions', async () => {
      pool.query.mockResolvedValueOnce({});
      const res = await request(app)
        .put('/api/admin/submissions/bulk-status')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ submission_ids: ['KCR-0001', 'KCR-0002'], status: 'accepted' });
      expect(res.status).toBe(200);
      expect(res.body.message).toContain('2 submission');
    });
  });

  describe('GET /api/admin/export', () => {
    test('returns export wrapper', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ submission_id: 'KCR-0001', title: 't' }],
      });
      const res = await request(app)
        .get('/api/admin/export')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
      expect(res.body.submissions).toHaveLength(1);
    });
  });
});
