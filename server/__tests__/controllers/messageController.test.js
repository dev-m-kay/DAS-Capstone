jest.mock('../../models/Message');
jest.mock('../../models/Submission');
jest.mock('../../models/User');
jest.mock('../../middleware/access');

const Message = require('../../models/Message');
const Submission = require('../../models/Submission');
const User = require('../../models/User');
const { canAccessSubmission } = require('../../middleware/access');
const messageController = require('../../controllers/messageController');
const { mockRes } = require('../helpers/mockRes');

describe('controllers/messageController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('send()', () => {
    const baseReq = (overrides = {}) => ({
      params: { submissionId: 'KCR-0001' },
      body: { body: 'hello there' },
      user: { id: 4, role: 'submitter' },
      app: { get: jest.fn().mockReturnValue(null) },
      ...overrides,
    });

    test('400 when body is missing', async () => {
      const req = baseReq({ body: {} });
      const res = mockRes();
      await messageController.send(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('400 when body is whitespace only', async () => {
      const req = baseReq({ body: { body: '   ' } });
      const res = mockRes();
      await messageController.send(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('404 when submission missing', async () => {
      Submission.findBySubmissionId.mockResolvedValue(undefined);
      const res = mockRes();
      await messageController.send(baseReq(), res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('403 when user cannot access submission', async () => {
      Submission.findBySubmissionId.mockResolvedValue({ id: 1, user_id: 99 });
      canAccessSubmission.mockResolvedValue(false);
      const res = mockRes();
      await messageController.send(baseReq(), res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('201 returns enriched message and trims the body', async () => {
      Submission.findBySubmissionId.mockResolvedValue({ id: 1, submission_id: 'KCR-0001', user_id: 4 });
      canAccessSubmission.mockResolvedValue(true);
      Message.create.mockResolvedValue({
        id: 10, submission_id: 1, sender_id: 4, body: 'hello there',
      });
      User.findById.mockResolvedValue({
        first_name: 'Sub', last_name: 'Mitter', role: 'submitter',
      });

      const req = baseReq({ body: { body: '  hello there  ' } });
      const res = mockRes();
      await messageController.send(req, res);

      expect(Message.create).toHaveBeenCalledWith({
        submission_id: 1,
        sender_id: 4,
        body: 'hello there',
      });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        id: 10,
        submission_id: 'KCR-0001',
        first_name: 'Sub',
        last_name: 'Mitter',
        role: 'submitter',
      }));
    });

    test('emits new_message to the submission_id room when io is available', async () => {
      Submission.findBySubmissionId.mockResolvedValue({ id: 1, submission_id: 'KCR-0001', user_id: 4 });
      canAccessSubmission.mockResolvedValue(true);
      Message.create.mockResolvedValue({
        id: 10, submission_id: 1, sender_id: 4, body: 'hi',
      });
      User.findById.mockResolvedValue({
        first_name: 'Sub', last_name: 'Mitter', role: 'submitter',
      });

      const emit = jest.fn();
      const ioMock = { to: jest.fn().mockReturnValue({ emit }) };
      const req = baseReq({ app: { get: jest.fn().mockReturnValue(ioMock) } });
      const res = mockRes();
      await messageController.send(req, res);

      expect(ioMock.to).toHaveBeenCalledWith('KCR-0001');
      expect(emit).toHaveBeenCalledWith('new_message', expect.objectContaining({ id: 10, submission_id: 'KCR-0001' }));
    });

    test('500 when model throws', async () => {
      Submission.findBySubmissionId.mockRejectedValue(new Error('boom'));
      jest.spyOn(console, 'error').mockImplementation(() => {});
      const res = mockRes();
      await messageController.send(baseReq(), res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('getForSubmission()', () => {
    test('404 when submission missing', async () => {
      Submission.findBySubmissionId.mockResolvedValue(undefined);
      const req = { params: { submissionId: 'KCR-0001' }, user: { id: 1 } };
      const res = mockRes();
      await messageController.getForSubmission(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('403 when no access', async () => {
      Submission.findBySubmissionId.mockResolvedValue({ id: 1, user_id: 99 });
      canAccessSubmission.mockResolvedValue(false);
      const req = { params: { submissionId: 'KCR-0001' }, user: { id: 1 } };
      const res = mockRes();
      await messageController.getForSubmission(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('returns messages when allowed', async () => {
      Submission.findBySubmissionId.mockResolvedValue({ id: 1, user_id: 1 });
      canAccessSubmission.mockResolvedValue(true);
      Message.findBySubmission.mockResolvedValue([{ id: 1, body: 'hi' }]);
      const req = { params: { submissionId: 'KCR-0001' }, user: { id: 1 } };
      const res = mockRes();
      await messageController.getForSubmission(req, res);
      expect(Message.findBySubmission).toHaveBeenCalledWith(1);
      expect(res.json).toHaveBeenCalledWith([{ id: 1, body: 'hi' }]);
    });
  });

  describe('getMyThreads()', () => {
    test('returns threads for the logged-in user', async () => {
      Message.getThreadsForUser.mockResolvedValue([{ id: 1, title: 't' }]);
      const req = { user: { id: 7 } };
      const res = mockRes();
      await messageController.getMyThreads(req, res);
      expect(Message.getThreadsForUser).toHaveBeenCalledWith(7);
      expect(res.json).toHaveBeenCalledWith([{ id: 1, title: 't' }]);
    });

    test('500 when model throws', async () => {
      Message.getThreadsForUser.mockRejectedValue(new Error('boom'));
      jest.spyOn(console, 'error').mockImplementation(() => {});
      const req = { user: { id: 7 } };
      const res = mockRes();
      await messageController.getMyThreads(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
