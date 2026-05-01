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
    beforeEach(() => {
      Message.getLatestStaffMessage = jest.fn().mockResolvedValue(null);
      Message.getThreadsForUser = jest.fn().mockResolvedValue([]);
      Message.getDirectMessageThreadsForUser = jest.fn().mockResolvedValue([]);
      Message.getAllDirectMessageThreads = jest.fn().mockResolvedValue([]);
    });

    test('passes role to the model and wraps each submission thread', async () => {
      Message.getThreadsForUser.mockResolvedValue([
        { id: 1, body: 'hi', created_at: 't', sender_id: 7,
          first_name: 'A', last_name: 'B', role: 'reviewer',
          title: 'My Submission', submission_id: 'KCR-0001' },
      ]);
      const req = { user: { id: 7, role: 'reviewer' } };
      const res = mockRes();
      await messageController.getMyThreads(req, res);
      expect(Message.getThreadsForUser).toHaveBeenCalledWith(7, 'reviewer');
      const payload = res.json.mock.calls[0][0];
      // Reviewer sees the Staff Lounge pinned at top + the submission thread.
      expect(payload[0]).toEqual(expect.objectContaining({
        kind: 'staff', key: 'staff', pinned: true,
      }));
      expect(payload[1]).toEqual(expect.objectContaining({
        kind: 'submission',
        key: 'KCR-0001',
        title: '#KCR-0001 — My Submission',
      }));
    });

    test('submitter does NOT see the Staff Lounge thread', async () => {
      const req = { user: { id: 4, role: 'submitter' } };
      const res = mockRes();
      await messageController.getMyThreads(req, res);
      const payload = res.json.mock.calls[0][0];
      expect(payload.find((t) => t.kind === 'staff')).toBeUndefined();
    });

    test('admin sees every other DM conversation as read-only', async () => {
      Message.getAllDirectMessageThreads.mockResolvedValue([
        {
          id: 5, body: 'secret', created_at: 't', sender_id: 7, recipient_id: 8,
          u_lo: 7, u_hi: 8,
          lo_first_name: 'Ann', lo_last_name: 'A', lo_role: 'editor',
          hi_first_name: 'Bob', hi_last_name: 'B', hi_role: 'reviewer',
        },
        {
          // Admin (id=1) participates here — should NOT be duplicated.
          id: 6, body: 'mine', created_at: 't', sender_id: 1, recipient_id: 8,
          u_lo: 1, u_hi: 8,
          lo_first_name: 'Adm', lo_last_name: 'In', lo_role: 'admin',
          hi_first_name: 'Bob', hi_last_name: 'B', hi_role: 'reviewer',
        },
      ]);
      Message.getDirectMessageThreadsForUser.mockResolvedValue([
        {
          id: 6, body: 'mine', created_at: 't', sender_id: 1, recipient_id: 8,
          peer_id: 8, peer_first_name: 'Bob', peer_last_name: 'B', peer_role: 'reviewer',
          sender_first_name: 'Adm', sender_last_name: 'In', sender_role: 'admin',
        },
      ]);

      const req = { user: { id: 1, role: 'admin' } };
      const res = mockRes();
      await messageController.getMyThreads(req, res);

      expect(Message.getAllDirectMessageThreads).toHaveBeenCalled();
      expect(Message.getDirectMessageThreadsForUser).toHaveBeenCalledWith(1);
      const payload = res.json.mock.calls[0][0];
      const dms = payload.filter((t) => t.kind === 'dm');
      // One sendable DM (admin↔Bob) and one read-only (Ann↔Bob).
      expect(dms).toHaveLength(2);
      expect(dms.find((t) => t.key === 'dm:8')).toBeDefined();
      expect(dms.find((t) => t.key === 'dm:7:8')).toEqual(expect.objectContaining({
        title: 'Ann A ↔ Bob B',
        subtitle: expect.stringContaining('read-only'),
      }));
    });

    test('500 when model throws', async () => {
      Message.getThreadsForUser.mockRejectedValue(new Error('boom'));
      jest.spyOn(console, 'error').mockImplementation(() => {});
      const req = { user: { id: 7, role: 'reviewer' } };
      const res = mockRes();
      await messageController.getMyThreads(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('Staff Lounge', () => {
    test('getStaffMessages returns 403 for non-staff', async () => {
      const req = { user: { id: 4, role: 'submitter' } };
      const res = mockRes();
      await messageController.getStaffMessages(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('getStaffMessages returns the list for reviewers', async () => {
      Message.getStaffMessages = jest.fn().mockResolvedValue([{ id: 1, body: 'hi' }]);
      const req = { user: { id: 7, role: 'reviewer' } };
      const res = mockRes();
      await messageController.getStaffMessages(req, res);
      expect(res.json).toHaveBeenCalledWith([{ id: 1, body: 'hi' }]);
    });

    test('sendStaffMessage rejects empty body', async () => {
      const req = { user: { id: 7, role: 'editor' }, body: { body: '   ' }, app: { get: () => null } };
      const res = mockRes();
      await messageController.sendStaffMessage(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('sendStaffMessage rejects non-staff', async () => {
      const req = { user: { id: 4, role: 'submitter' }, body: { body: 'hi' }, app: { get: () => null } };
      const res = mockRes();
      await messageController.sendStaffMessage(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('sendStaffMessage emits to staff-lounge room and returns 201', async () => {
      Message.createStaffMessage = jest.fn().mockResolvedValue({
        id: 1, sender_id: 7, body: 'hi', created_at: 't',
      });
      User.findById.mockResolvedValue({ first_name: 'Ann', last_name: 'B', role: 'editor' });
      const emit = jest.fn();
      const ioMock = { to: jest.fn().mockReturnValue({ emit }) };
      const req = {
        user: { id: 7, role: 'editor' },
        body: { body: '  hi  ' },
        app: { get: jest.fn().mockReturnValue(ioMock) },
      };
      const res = mockRes();
      await messageController.sendStaffMessage(req, res);
      expect(Message.createStaffMessage).toHaveBeenCalledWith({ sender_id: 7, body: 'hi' });
      expect(ioMock.to).toHaveBeenCalledWith('staff-lounge');
      expect(emit).toHaveBeenCalledWith('new_message', expect.objectContaining({
        kind: 'staff',
      }));
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe('Direct Messages', () => {
    test('rejects self-DM', async () => {
      const req = { user: { id: 7, role: 'reviewer' }, params: { peerId: '7' }, body: { body: 'hi' } };
      const res = mockRes();
      await messageController.sendDirectMessage(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('reviewer cannot DM a submitter', async () => {
      User.findById.mockResolvedValue({ id: 4, role: 'submitter' });
      const req = { user: { id: 7, role: 'reviewer' }, params: { peerId: '4' }, body: { body: 'hi' } };
      const res = mockRes();
      await messageController.sendDirectMessage(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('reviewer can DM another editor', async () => {
      User.findById.mockImplementation((id) => {
        if (id == 8) return Promise.resolve({ id: 8, role: 'editor', first_name: 'E', last_name: 'D' });
        return Promise.resolve({ id: 7, role: 'reviewer', first_name: 'R', last_name: 'V' });
      });
      Message.createDirectMessage = jest.fn().mockResolvedValue({
        id: 1, sender_id: 7, recipient_id: 8, body: 'hi', created_at: 't',
      });
      const emit = jest.fn();
      const ioMock = { to: jest.fn().mockReturnValue({ emit }) };
      const req = {
        user: { id: 7, role: 'reviewer' },
        params: { peerId: '8' },
        body: { body: 'hi' },
        app: { get: jest.fn().mockReturnValue(ioMock) },
      };
      const res = mockRes();
      await messageController.sendDirectMessage(req, res);
      expect(Message.createDirectMessage).toHaveBeenCalledWith({
        sender_id: 7, recipient_id: 8, body: 'hi',
      });
      expect(ioMock.to).toHaveBeenCalledWith('dm:7:8');
      expect(res.status).toHaveBeenCalledWith(201);
    });

    test('admin can DM anyone (including a submitter)', async () => {
      User.findById.mockResolvedValue({ id: 4, role: 'submitter', first_name: 'S', last_name: 'B' });
      Message.createDirectMessage = jest.fn().mockResolvedValue({
        id: 2, sender_id: 1, recipient_id: 4, body: 'hi', created_at: 't',
      });
      const emit = jest.fn();
      const ioMock = { to: jest.fn().mockReturnValue({ emit }) };
      const req = {
        user: { id: 1, role: 'admin' },
        params: { peerId: '4' },
        body: { body: 'hi' },
        app: { get: jest.fn().mockReturnValue(ioMock) },
      };
      const res = mockRes();
      await messageController.sendDirectMessage(req, res);
      expect(res.status).toHaveBeenCalledWith(201);
    });

    test('getDirectMessagesBetween is admin-only', async () => {
      const req = { user: { id: 7, role: 'reviewer' }, params: { a: '1', b: '2' } };
      const res = mockRes();
      await messageController.getDirectMessagesBetween(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('getDirectMessagesBetween returns conversation for admin', async () => {
      Message.getDirectMessagesBetween = jest.fn().mockResolvedValue([{ id: 1, body: 'hi' }]);
      const req = { user: { id: 1, role: 'admin' }, params: { a: '7', b: '8' } };
      const res = mockRes();
      await messageController.getDirectMessagesBetween(req, res);
      expect(Message.getDirectMessagesBetween).toHaveBeenCalledWith(7, 8);
      expect(res.json).toHaveBeenCalledWith([{ id: 1, body: 'hi' }]);
    });
  });

  describe('listStaffUsers()', () => {
    test('403 for submitters', async () => {
      const req = { user: { id: 4, role: 'submitter' } };
      const res = mockRes();
      await messageController.listStaffUsers(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('returns deduplicated staff list excluding self', async () => {
      User.findByRole.mockImplementation((role) => {
        if (role === 'admin') return Promise.resolve([
          { id: 1, first_name: 'A', last_name: 'A', role: 'admin' },
        ]);
        if (role === 'editor') return Promise.resolve([
          { id: 2, first_name: 'B', last_name: 'B', role: 'editor' },
        ]);
        if (role === 'reviewer') return Promise.resolve([
          { id: 7, first_name: 'C', last_name: 'C', role: 'reviewer' },
          { id: 8, first_name: 'D', last_name: 'D', role: 'reviewer' },
        ]);
        return Promise.resolve([]);
      });
      const req = { user: { id: 7, role: 'reviewer' } };
      const res = mockRes();
      await messageController.listStaffUsers(req, res);
      const list = res.json.mock.calls[0][0];
      expect(list.map((u) => u.id).sort()).toEqual([1, 2, 8]);
    });
  });
});
