jest.mock('../../config/db', () => ({
  pool: { query: jest.fn() },
}));
jest.mock('../../models/User');
jest.mock('../../models/Submission');

const { pool } = require('../../config/db');
const User = require('../../models/User');
const Submission = require('../../models/Submission');
const adminController = require('../../controllers/adminController');
const { mockRes } = require('../helpers/mockRes');

describe('controllers/adminController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockReset();
  });

  describe('getAllUsers()', () => {
    test('returns users from User.findAll()', async () => {
      User.findAll.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      const res = mockRes();
      await adminController.getAllUsers({}, res);
      expect(res.json).toHaveBeenCalledWith([{ id: 1 }, { id: 2 }]);
    });

    test('500 when model throws', async () => {
      User.findAll.mockRejectedValue(new Error('boom'));
      jest.spyOn(console, 'error').mockImplementation(() => {});
      const res = mockRes();
      await adminController.getAllUsers({}, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('updateUserRole()', () => {
    test('400 when role is invalid', async () => {
      const req = { params: { id: 1 }, body: { role: 'overlord' } };
      const res = mockRes();
      await adminController.updateUserRole(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('404 when user missing', async () => {
      User.findById.mockResolvedValue(undefined);
      const req = { params: { id: 1 }, body: { role: 'editor' } };
      const res = mockRes();
      await adminController.updateUserRole(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('updates role and returns message + sanitized user', async () => {
      User.findById.mockResolvedValue({ id: 5, email: 'a@b.com', role: 'submitter' });
      User.updateRole.mockResolvedValue({ id: 5, email: 'a@b.com', role: 'editor' });

      const req = { params: { id: 5 }, body: { role: 'editor' } };
      const res = mockRes();
      await adminController.updateUserRole(req, res);

      expect(User.updateRole).toHaveBeenCalledWith(5, 'editor');
      expect(res.json).toHaveBeenCalledWith({
        message: 'Role updated',
        user: { id: 5, email: 'a@b.com', role: 'editor' },
      });
    });
  });

  describe('deleteUser()', () => {
    test('404 when user missing', async () => {
      User.findById.mockResolvedValue(undefined);
      const req = { params: { id: 1 }, user: { id: 99 } };
      const res = mockRes();
      await adminController.deleteUser(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('400 when admin tries to delete themselves', async () => {
      User.findById.mockResolvedValue({ id: 99 });
      const req = { params: { id: 99 }, user: { id: 99 } };
      const res = mockRes();
      await adminController.deleteUser(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('deletes a different user', async () => {
      User.findById.mockResolvedValue({ id: 5 });
      User.findSubmissionFilesForUser.mockResolvedValue([]);
      User.deleteById.mockResolvedValue(1);
      const req = { params: { id: 5 }, user: { id: 99 } };
      const res = mockRes();
      await adminController.deleteUser(req, res);
      expect(User.deleteById).toHaveBeenCalledWith(5);
      expect(res.json).toHaveBeenCalledWith({ message: 'User deleted' });
    });

    test('cleans up upload files on disk after the cascade delete', async () => {
      User.findById.mockResolvedValue({ id: 5 });
      User.findSubmissionFilesForUser.mockResolvedValue([
        'a.pdf',
        'b.docx',
        '../escape.txt', // path-traversal attempt — must be ignored
      ]);
      User.deleteById.mockResolvedValue(1);
      const fs = require('fs');
      const unlinkSpy = jest.spyOn(fs, 'unlink').mockImplementation((p, cb) => cb && cb());

      const req = { params: { id: 5 }, user: { id: 99 } };
      const res = mockRes();
      await adminController.deleteUser(req, res);

      expect(res.json).toHaveBeenCalledWith({ message: 'User deleted' });
      const unlinkedNames = unlinkSpy.mock.calls.map(c => require('path').basename(c[0]));
      expect(unlinkedNames).toEqual(expect.arrayContaining(['a.pdf', 'b.docx']));
      expect(unlinkedNames).not.toEqual(expect.arrayContaining(['escape.txt']));
      unlinkSpy.mockRestore();
    });

    test('returns 409 when the cascade delete still hits a foreign-key violation', async () => {
      User.findById.mockResolvedValue({ id: 5 });
      User.findSubmissionFilesForUser.mockResolvedValue([]);
      const fkErr = Object.assign(new Error('FK violation'), { code: '23503' });
      User.deleteById.mockRejectedValue(fkErr);
      jest.spyOn(console, 'error').mockImplementation(() => {});

      const req = { params: { id: 5 }, user: { id: 99 } };
      const res = mockRes();
      await adminController.deleteUser(req, res);
      expect(res.status).toHaveBeenCalledWith(409);
    });
  });

  describe('assignReviewer()', () => {
    test('404 when submission missing', async () => {
      Submission.findBySubmissionId.mockResolvedValue(undefined);
      const req = { body: { submission_id: 'KCR-0001', reviewer_id: 7 } };
      const res = mockRes();
      await adminController.assignReviewer(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('400 when reviewer is not a reviewer or editor', async () => {
      Submission.findBySubmissionId.mockResolvedValue({ id: 1, status: 'pending' });
      User.findById.mockResolvedValue({ id: 7, role: 'submitter' });
      const req = { body: { submission_id: 'KCR-0001', reviewer_id: 7 } };
      const res = mockRes();
      await adminController.assignReviewer(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('400 when reviewer not found', async () => {
      Submission.findBySubmissionId.mockResolvedValue({ id: 1, status: 'pending' });
      User.findById.mockResolvedValue(undefined);
      const req = { body: { submission_id: 'KCR-0001', reviewer_id: 7 } };
      const res = mockRes();
      await adminController.assignReviewer(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('inserts assignment and bumps status to in_review when pending', async () => {
      Submission.findBySubmissionId.mockResolvedValue({
        id: 1, submission_id: 'KCR-0001', status: 'pending',
      });
      User.findById.mockResolvedValue({
        id: 7, role: 'reviewer', first_name: 'R', last_name: 'V',
      });
      pool.query.mockResolvedValueOnce({});
      Submission.updateStatus.mockResolvedValue({});

      const req = { body: { submission_id: 'KCR-0001', reviewer_id: 7 } };
      const res = mockRes();
      await adminController.assignReviewer(req, res);

      expect(pool.query).toHaveBeenCalledWith(
        'INSERT INTO assignments (submission_id, reviewer_id) VALUES ($1, $2)',
        [1, 7]
      );
      expect(Submission.updateStatus).toHaveBeenCalledWith(1, 'in_review');
      expect(res.status).toHaveBeenCalledWith(201);
    });

    test('does not change status if submission is already in_review', async () => {
      Submission.findBySubmissionId.mockResolvedValue({
        id: 1, submission_id: 'KCR-0001', status: 'in_review',
      });
      User.findById.mockResolvedValue({
        id: 7, role: 'reviewer', first_name: 'R', last_name: 'V',
      });
      pool.query.mockResolvedValueOnce({});

      const req = { body: { submission_id: 'KCR-0001', reviewer_id: 7 } };
      const res = mockRes();
      await adminController.assignReviewer(req, res);

      expect(Submission.updateStatus).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
    });

    test('409 on duplicate assignment', async () => {
      Submission.findBySubmissionId.mockResolvedValue({
        id: 1, submission_id: 'KCR-0001', status: 'pending',
      });
      User.findById.mockResolvedValue({
        id: 7, role: 'reviewer', first_name: 'R', last_name: 'V',
      });
      const dupErr = new Error('dup');
      dupErr.constraint = 'assignments_submission_id_reviewer_id_key';
      pool.query.mockRejectedValueOnce(dupErr);

      const req = { body: { submission_id: 'KCR-0001', reviewer_id: 7 } };
      const res = mockRes();
      await adminController.assignReviewer(req, res);
      expect(res.status).toHaveBeenCalledWith(409);
    });
  });

  describe('removeAssignment()', () => {
    test('404 when submission missing', async () => {
      Submission.findBySubmissionId.mockResolvedValue(undefined);
      const req = { params: { submissionId: 'KCR-0001', reviewerId: 7 } };
      const res = mockRes();
      await adminController.removeAssignment(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('404 when assignment missing', async () => {
      Submission.findBySubmissionId.mockResolvedValue({ id: 1 });
      pool.query.mockResolvedValueOnce({ rowCount: 0 });
      const req = { params: { submissionId: 'KCR-0001', reviewerId: 7 } };
      const res = mockRes();
      await adminController.removeAssignment(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('removes assignment when one row affected', async () => {
      Submission.findBySubmissionId.mockResolvedValue({ id: 1 });
      pool.query.mockResolvedValueOnce({ rowCount: 1 });
      const req = { params: { submissionId: 'KCR-0001', reviewerId: 7 } };
      const res = mockRes();
      await adminController.removeAssignment(req, res);
      expect(res.json).toHaveBeenCalledWith({ message: 'Assignment removed' });
    });
  });

  describe('getReviewerWorkload()', () => {
    test('returns reviewer workload rows', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 1, assigned_count: '5' }],
      });
      const res = mockRes();
      await adminController.getReviewerWorkload({}, res);
      expect(res.json).toHaveBeenCalledWith([{ id: 1, assigned_count: '5' }]);
    });
  });

  describe('bulkUpdateStatus()', () => {
    test('400 when submission_ids is not a non-empty array', async () => {
      const req = { body: { submission_ids: [], status: 'accepted' } };
      const res = mockRes();
      await adminController.bulkUpdateStatus(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('400 on invalid status', async () => {
      const req = { body: { submission_ids: ['KCR-0001'], status: 'banana' } };
      const res = mockRes();
      await adminController.bulkUpdateStatus(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('runs UPDATE with parameterized list and returns summary', async () => {
      pool.query.mockResolvedValueOnce({});
      const req = {
        body: { submission_ids: ['KCR-0001', 'KCR-0002'], status: 'accepted' },
      };
      const res = mockRes();
      await adminController.bulkUpdateStatus(req, res);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('UPDATE submissions');
      expect(sql).toContain('IN ($2, $3)');
      expect(params).toEqual(['accepted', 'KCR-0001', 'KCR-0002']);
      expect(res.json).toHaveBeenCalledWith({
        message: '2 submission(s) updated to accepted',
      });
    });
  });

  describe('exportData()', () => {
    test('returns count + submissions wrapped with timestamp', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ submission_id: 'KCR-0001', title: 't' }],
      });
      const res = mockRes();
      await adminController.exportData({}, res);

      const payload = res.json.mock.calls[0][0];
      expect(payload.count).toBe(1);
      expect(payload.submissions).toEqual([{ submission_id: 'KCR-0001', title: 't' }]);
      expect(typeof payload.exported_at).toBe('string');
    });
  });
});
