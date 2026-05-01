jest.mock('../../config/db', () => ({
  pool: { query: jest.fn().mockResolvedValue({ rows: [] }) },
}));
jest.mock('../../models/Message');
jest.mock('../../models/Submission');
jest.mock('../../models/User');
jest.mock('../../middleware/access');

const request = require('supertest');
const Message = require('../../models/Message');
const Submission = require('../../models/Submission');
const User = require('../../models/User');
const { canDiscussSubmission } = require('../../middleware/access');
const app = require('../../app');
const { generateToken } = require('../../middleware/auth');

const submitterToken = generateToken({ id: 4, email: 'sub@x.com', role: 'submitter' });
const reviewerToken  = generateToken({ id: 7, email: 'rev@x.com', role: 'reviewer' });

describe('routes/messages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/messages/threads', () => {
    beforeEach(() => {
      Message.getLatestStaffMessage = jest.fn().mockResolvedValue(null);
      Message.getThreadsForUser = jest.fn().mockResolvedValue([]);
      Message.getDirectMessageThreadsForUser = jest.fn().mockResolvedValue([]);
      Message.getAllDirectMessageThreads = jest.fn().mockResolvedValue([]);
    });

    test('401 without token', async () => {
      const res = await request(app).get('/api/messages/threads');
      expect(res.status).toBe(401);
    });

    test('200 returns the unified threads list for staff', async () => {
      Message.getThreadsForUser.mockResolvedValue([{
        id: 1, body: 'hi', created_at: 't', sender_id: 7,
        first_name: 'A', last_name: 'B', role: 'reviewer',
        title: 'My Submission', submission_id: 'KCR-0001',
      }]);
      const res = await request(app)
        .get('/api/messages/threads')
        .set('Authorization', `Bearer ${reviewerToken}`);
      expect(res.status).toBe(200);
      expect(Message.getThreadsForUser).toHaveBeenCalledWith(7, 'reviewer');
      // Staff Lounge is pinned at the top; submission thread is next.
      expect(res.body[1]).toEqual(expect.objectContaining({
        kind: 'submission',
        key: 'KCR-0001',
      }));
    });

    test('reviewer sees the Staff Lounge entry', async () => {
      const res = await request(app)
        .get('/api/messages/threads')
        .set('Authorization', `Bearer ${reviewerToken}`);
      expect(res.status).toBe(200);
      expect(res.body[0]).toEqual(expect.objectContaining({ kind: 'staff' }));
    });

    test('submitter never sees submission discussion threads', async () => {
      // Even if the model would return rows for this user (it shouldn't —
      // we short-circuit in the model — but test the controller too), the
      // controller skips the submission-threads block entirely for non-staff.
      Message.getThreadsForUser.mockResolvedValue([{
        id: 1, body: 'hi', created_at: 't', sender_id: 4,
        first_name: 'S', last_name: 'B', role: 'submitter',
        title: 'My Submission', submission_id: 'KCR-0001',
      }]);
      const res = await request(app)
        .get('/api/messages/threads')
        .set('Authorization', `Bearer ${submitterToken}`);
      expect(res.status).toBe(200);
      expect(res.body.find((t) => t.kind === 'submission')).toBeUndefined();
      expect(res.body.find((t) => t.kind === 'staff')).toBeUndefined();
    });
  });

  describe('Staff Lounge routes', () => {
    test('POST /api/messages/staff is forbidden for submitters', async () => {
      const res = await request(app)
        .post('/api/messages/staff')
        .set('Authorization', `Bearer ${submitterToken}`)
        .send({ body: 'hi' });
      expect(res.status).toBe(403);
    });

    test('GET /api/messages/staff returns 200 for reviewers', async () => {
      Message.getStaffMessages = jest.fn().mockResolvedValue([{ id: 1 }]);
      const res = await request(app)
        .get('/api/messages/staff')
        .set('Authorization', `Bearer ${reviewerToken}`);
      expect(res.status).toBe(200);
    });
  });

  describe('DM routes', () => {
    test('GET /api/messages/dm/:peerId rejects submitters', async () => {
      User.findById.mockResolvedValue({ id: 7, role: 'reviewer' });
      const res = await request(app)
        .get('/api/messages/dm/7')
        .set('Authorization', `Bearer ${submitterToken}`);
      expect(res.status).toBe(403);
    });

    test('POST /api/messages/dm/:peerId 400 for self', async () => {
      const res = await request(app)
        .post('/api/messages/dm/7')
        .set('Authorization', `Bearer ${reviewerToken}`)
        .send({ body: 'hi' });
      expect(res.status).toBe(400);
    });

    test('GET /api/messages/staff-users returns 403 for submitters', async () => {
      const res = await request(app)
        .get('/api/messages/staff-users')
        .set('Authorization', `Bearer ${submitterToken}`);
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/messages/:submissionId', () => {
    test('401 without token', async () => {
      const res = await request(app).get('/api/messages/KCR-0001');
      expect(res.status).toBe(401);
    });

    test('404 when submission missing', async () => {
      Submission.findBySubmissionId.mockResolvedValue(undefined);
      const res = await request(app)
        .get('/api/messages/KCR-0001')
        .set('Authorization', `Bearer ${submitterToken}`);
      expect(res.status).toBe(404);
    });

    test('403 when not authorized', async () => {
      Submission.findBySubmissionId.mockResolvedValue({ id: 1, user_id: 99 });
      canDiscussSubmission.mockResolvedValue(false);
      const res = await request(app)
        .get('/api/messages/KCR-0001')
        .set('Authorization', `Bearer ${submitterToken}`);
      expect(res.status).toBe(403);
    });

    test('200 returns messages when allowed', async () => {
      Submission.findBySubmissionId.mockResolvedValue({ id: 1, user_id: 4 });
      canDiscussSubmission.mockResolvedValue(true);
      Message.findBySubmission.mockResolvedValue([{ id: 1, body: 'hi' }]);

      const res = await request(app)
        .get('/api/messages/KCR-0001')
        .set('Authorization', `Bearer ${submitterToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ id: 1, body: 'hi' }]);
    });
  });

  describe('POST /api/messages/:submissionId', () => {
    test('400 when body missing', async () => {
      const res = await request(app)
        .post('/api/messages/KCR-0001')
        .set('Authorization', `Bearer ${submitterToken}`)
        .send({});
      expect(res.status).toBe(400);
    });

    test('404 when submission missing', async () => {
      Submission.findBySubmissionId.mockResolvedValue(undefined);
      const res = await request(app)
        .post('/api/messages/KCR-0001')
        .set('Authorization', `Bearer ${submitterToken}`)
        .send({ body: 'hi' });
      expect(res.status).toBe(404);
    });

    test('403 when no access', async () => {
      Submission.findBySubmissionId.mockResolvedValue({ id: 1, user_id: 99 });
      canDiscussSubmission.mockResolvedValue(false);
      const res = await request(app)
        .post('/api/messages/KCR-0001')
        .set('Authorization', `Bearer ${reviewerToken}`)
        .send({ body: 'hi' });
      expect(res.status).toBe(403);
    });

    test('201 returns enriched message when allowed', async () => {
      Submission.findBySubmissionId.mockResolvedValue({ id: 1, submission_id: 'KCR-0001', user_id: 4 });
      canDiscussSubmission.mockResolvedValue(true);
      Message.create.mockResolvedValue({
        id: 22, submission_id: 1, sender_id: 4, body: 'hello',
      });
      User.findById.mockResolvedValue({
        first_name: 'Sub', last_name: 'Mitter', role: 'submitter',
      });

      const res = await request(app)
        .post('/api/messages/KCR-0001')
        .set('Authorization', `Bearer ${submitterToken}`)
        .send({ body: 'hello' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(expect.objectContaining({
        id: 22, first_name: 'Sub', role: 'submitter',
      }));
    });
  });
});
