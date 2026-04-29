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
const { canAccessSubmission } = require('../../middleware/access');
const app = require('../../app');
const { generateToken } = require('../../middleware/auth');

const submitterToken = generateToken({ id: 4, email: 'sub@x.com', role: 'submitter' });
const reviewerToken  = generateToken({ id: 7, email: 'rev@x.com', role: 'reviewer' });

describe('routes/messages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/messages/threads', () => {
    test('401 without token', async () => {
      const res = await request(app).get('/api/messages/threads');
      expect(res.status).toBe(401);
    });

    test('200 returns threads for the user', async () => {
      Message.getThreadsForUser.mockResolvedValue([{ id: 1, title: 't' }]);
      const res = await request(app)
        .get('/api/messages/threads')
        .set('Authorization', `Bearer ${submitterToken}`);
      expect(res.status).toBe(200);
      expect(Message.getThreadsForUser).toHaveBeenCalledWith(4);
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
      canAccessSubmission.mockResolvedValue(false);
      const res = await request(app)
        .get('/api/messages/KCR-0001')
        .set('Authorization', `Bearer ${submitterToken}`);
      expect(res.status).toBe(403);
    });

    test('200 returns messages when allowed', async () => {
      Submission.findBySubmissionId.mockResolvedValue({ id: 1, user_id: 4 });
      canAccessSubmission.mockResolvedValue(true);
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
      canAccessSubmission.mockResolvedValue(false);
      const res = await request(app)
        .post('/api/messages/KCR-0001')
        .set('Authorization', `Bearer ${reviewerToken}`)
        .send({ body: 'hi' });
      expect(res.status).toBe(403);
    });

    test('201 returns enriched message when allowed', async () => {
      Submission.findBySubmissionId.mockResolvedValue({ id: 1, submission_id: 'KCR-0001', user_id: 4 });
      canAccessSubmission.mockResolvedValue(true);
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
