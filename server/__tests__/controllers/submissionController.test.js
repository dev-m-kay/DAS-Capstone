jest.mock('../../models/Submission');
jest.mock('../../middleware/access');
jest.mock('../../config/db', () => ({
  pool: { query: jest.fn() },
}));

const Submission = require('../../models/Submission');
const { canAccessSubmission } = require('../../middleware/access');
const { pool } = require('../../config/db');
const submissionController = require('../../controllers/submissionController');
const { mockRes } = require('../helpers/mockRes');

describe('controllers/submissionController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('create()', () => {
    const validBody = {
      title: 'A Tale',
      genre: 'fiction',
      word_count: 1200,
      bio: 'I am an author',
      notes: 'enjoy',
    };

    test('400 when title is missing', async () => {
      const req = { user: { id: 1 }, body: { genre: 'g', bio: 'b' } };
      const res = mockRes();
      await submissionController.create(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('400 when genre is missing', async () => {
      const req = { user: { id: 1 }, body: { title: 't', bio: 'b' } };
      const res = mockRes();
      await submissionController.create(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('400 when bio is missing', async () => {
      const req = { user: { id: 1 }, body: { title: 't', genre: 'g' } };
      const res = mockRes();
      await submissionController.create(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('creates a submission via the transactional helper and returns 201', async () => {
      Submission.nextSubmissionID.mockResolvedValue('KCR-0001');
      Submission.createWithFiles.mockResolvedValue({
        submission: { id: 50, submission_id: 'KCR-0001' },
        files: [],
      });

      const req = { user: { id: 1 }, body: validBody, files: [] };
      const res = mockRes();
      await submissionController.create(req, res);

      expect(Submission.createWithFiles).toHaveBeenCalledWith(
        expect.objectContaining({
          submission_id: 'KCR-0001',
          user_id: 1,
          title: 'A Tale',
        }),
        []
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    test('passes uploaded files (and their bytes) into createWithFiles', async () => {
      Submission.nextSubmissionID.mockResolvedValue('KCR-0002');
      Submission.createWithFiles.mockResolvedValue({
        submission: { id: 51, submission_id: 'KCR-0002' },
        files: [],
      });

      const bufA = Buffer.from('PDF-bytes');
      const bufB = Buffer.from('DOCX-bytes');
      const req = {
        user: { id: 1 },
        body: validBody,
        // multer.memoryStorage() shape: each file has a `buffer`, but no
        // `filename` (the controller invents one).
        files: [
          { originalname: 'a.pdf',  mimetype: 'application/pdf',     size: 100, buffer: bufA },
          { originalname: 'b.docx', mimetype: 'application/msword',  size: 200, buffer: bufB },
        ],
      };
      const res = mockRes();
      await submissionController.create(req, res);

      // Filenames are now generated server-side, so we only assert on the
      // stable fields and on the bytes flowing through.
      expect(Submission.createWithFiles).toHaveBeenCalledWith(
        expect.any(Object),
        [
          expect.objectContaining({
            original_name: 'a.pdf',
            mimetype: 'application/pdf',
            size: 100,
            data: bufA,
          }),
          expect.objectContaining({
            original_name: 'b.docx',
            mimetype: 'application/msword',
            size: 200,
            data: bufB,
          }),
        ],
      );
      const filesArg = Submission.createWithFiles.mock.calls[0][1];
      expect(filesArg[0].filename).toMatch(/\.pdf$/);
      expect(filesArg[1].filename).toMatch(/\.docx$/);
    });

    test('500 and best-effort cleanup when createWithFiles throws', async () => {
      Submission.nextSubmissionID.mockResolvedValue('KCR-0003');
      Submission.createWithFiles.mockRejectedValue(new Error('boom'));
      jest.spyOn(console, 'error').mockImplementation(() => {});

      const req = {
        user: { id: 1 },
        body: validBody,
        files: [{ filename: 'orphan.pdf', originalname: 'orphan.pdf', mimetype: 'application/pdf', size: 1 }],
      };
      const res = mockRes();
      await submissionController.create(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('downloadFile()', () => {
    test('400 when filename contains path traversal', async () => {
      Submission.findBySubmissionId.mockResolvedValue({ id: 9, user_id: 1 });
      canAccessSubmission.mockResolvedValue(true);
      const req = {
        user: { id: 1 },
        params: { id: 'KCR-0001', filename: '../etc/passwd' },
      };
      const res = mockRes();
      await submissionController.downloadFile(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('404 when submission missing', async () => {
      Submission.findBySubmissionId.mockResolvedValue(undefined);
      const req = {
        user: { id: 1 },
        params: { id: 'KCR-9999', filename: 'x.pdf' },
      };
      const res = mockRes();
      await submissionController.downloadFile(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('403 when user cannot access submission', async () => {
      Submission.findBySubmissionId.mockResolvedValue({ id: 1, user_id: 99 });
      canAccessSubmission.mockResolvedValue(false);
      const req = {
        user: { id: 1, role: 'submitter' },
        params: { id: 'KCR-0001', filename: 'x.pdf' },
      };
      const res = mockRes();
      await submissionController.downloadFile(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('404 when filename does not belong to the submission', async () => {
      Submission.findBySubmissionId.mockResolvedValue({ id: 1, user_id: 1 });
      canAccessSubmission.mockResolvedValue(true);
      Submission.findFileByFilename.mockResolvedValue(undefined);
      const req = {
        user: { id: 1 },
        params: { id: 'KCR-0001', filename: 'x.pdf' },
      };
      const res = mockRes();
      await submissionController.downloadFile(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('streams from the DB BYTEA column when bytes are present', async () => {
      Submission.findBySubmissionId.mockResolvedValue({ id: 1, user_id: 1 });
      canAccessSubmission.mockResolvedValue(true);
      const buf = Buffer.from('hello world');
      Submission.findFileByFilename.mockResolvedValue({
        filename: 'x.pdf',
        original_name: 'orig.pdf',
        mimetype: 'application/pdf',
        data: buf,
      });
      const req = {
        user: { id: 1 },
        params: { id: 'KCR-0001', filename: 'x.pdf' },
      };
      const res = mockRes();
      await submissionController.downloadFile(req, res);
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Length', buf.length);
      expect(res.end).toHaveBeenCalledWith(buf);
      // We must NOT touch the disk fallback when bytes came from the DB.
      expect(res.sendFile).not.toHaveBeenCalled();
    });
  });

  describe('delete()', () => {
    test('404 when submission missing', async () => {
      Submission.findBySubmissionId.mockResolvedValue(undefined);
      const req = { user: { id: 1, role: 'admin' }, params: { id: 'KCR-9999' } };
      const res = mockRes();
      await submissionController.delete(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(Submission.deleteById).not.toHaveBeenCalled();
    });

    test('403 when caller is neither admin nor the author', async () => {
      Submission.findBySubmissionId.mockResolvedValue({ id: 1, user_id: 99, status: 'pending' });
      const req = { user: { id: 1, role: 'submitter' }, params: { id: 'KCR-0001' } };
      const res = mockRes();
      await submissionController.delete(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(Submission.deleteById).not.toHaveBeenCalled();
    });

    test('409 when the author tries to delete a non-pending submission', async () => {
      Submission.findBySubmissionId.mockResolvedValue({ id: 1, user_id: 5, status: 'in_review' });
      const req = { user: { id: 5, role: 'submitter' }, params: { id: 'KCR-0001' } };
      const res = mockRes();
      await submissionController.delete(req, res);
      expect(res.status).toHaveBeenCalledWith(409);
      expect(Submission.deleteById).not.toHaveBeenCalled();
    });

    test('admins can delete any submission, regardless of status', async () => {
      Submission.findBySubmissionId.mockResolvedValue({ id: 9, user_id: 5, status: 'accepted' });
      Submission.getFiles.mockResolvedValue([]);
      Submission.deleteById.mockResolvedValue(1);
      const req = { user: { id: 99, role: 'admin' }, params: { id: 'KCR-0001' } };
      const res = mockRes();
      await submissionController.delete(req, res);
      expect(Submission.deleteById).toHaveBeenCalledWith(9);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }));
    });

    test('the author can delete their own pending submission', async () => {
      Submission.findBySubmissionId.mockResolvedValue({ id: 9, user_id: 5, status: 'pending' });
      Submission.getFiles.mockResolvedValue([]);
      Submission.deleteById.mockResolvedValue(1);
      const req = { user: { id: 5, role: 'submitter' }, params: { id: 'KCR-0001' } };
      const res = mockRes();
      await submissionController.delete(req, res);
      expect(Submission.deleteById).toHaveBeenCalledWith(9);
    });
  });

  describe('getOne()', () => {
    test('404 when submission missing', async () => {
      Submission.findBySubmissionId.mockResolvedValue(undefined);
      const req = { user: { id: 1 }, params: { id: 'KCR-0001' } };
      const res = mockRes();
      await submissionController.getOne(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('403 when user cannot access', async () => {
      Submission.findBySubmissionId.mockResolvedValue({ id: 1, user_id: 2 });
      canAccessSubmission.mockResolvedValue(false);
      const req = { user: { id: 5, role: 'submitter' }, params: { id: 'KCR-0001' } };
      const res = mockRes();
      await submissionController.getOne(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    test('returns the submission when allowed', async () => {
      const sub = { id: 1, user_id: 5, title: 'x' };
      Submission.findBySubmissionId.mockResolvedValue(sub);
      canAccessSubmission.mockResolvedValue(true);
      const req = { user: { id: 5 }, params: { id: 'KCR-0001' } };
      const res = mockRes();
      await submissionController.getOne(req, res);
      expect(res.json).toHaveBeenCalledWith(sub);
    });
  });

  describe('updateStatus()', () => {
    test('400 on invalid status', async () => {
      const req = { params: { id: 'KCR-0001' }, body: { status: 'banana' } };
      const res = mockRes();
      await submissionController.updateStatus(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('404 when submission missing', async () => {
      Submission.findBySubmissionId.mockResolvedValue(undefined);
      const req = { params: { id: 'KCR-0001' }, body: { status: 'accepted' } };
      const res = mockRes();
      await submissionController.updateStatus(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('updates and returns new submission', async () => {
      Submission.findBySubmissionId.mockResolvedValue({ id: 9 });
      Submission.updateStatus.mockResolvedValue({ id: 9, status: 'accepted' });
      const req = { params: { id: 'KCR-0001' }, body: { status: 'accepted' } };
      const res = mockRes();
      await submissionController.updateStatus(req, res);
      expect(Submission.updateStatus).toHaveBeenCalledWith(9, 'accepted');
      expect(res.json).toHaveBeenCalledWith({ id: 9, status: 'accepted' });
    });
  });

  describe('getReviewers()', () => {
    test('404 when submission missing', async () => {
      Submission.findBySubmissionId.mockResolvedValue(undefined);
      const req = { user: { id: 1, role: 'submitter' }, params: { id: 'KCR-0001' } };
      const res = mockRes();
      await submissionController.getReviewers(req, res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test('403 when caller is the submission author (anonymity)', async () => {
      Submission.findBySubmissionId.mockResolvedValue({ id: 1, user_id: 5 });
      pool.query.mockResolvedValue({ rows: [] });
      const req = { user: { id: 5, role: 'submitter' }, params: { id: 'KCR-0001' } };
      const res = mockRes();
      await submissionController.getReviewers(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(Submission.getAssignedReviewers).not.toHaveBeenCalled();
    });

    test('returns reviewers when caller is admin', async () => {
      const reviewers = [{ id: 7, first_name: 'A', last_name: 'B' }];
      Submission.findBySubmissionId.mockResolvedValue({ id: 1, user_id: 5 });
      Submission.getAssignedReviewers.mockResolvedValue(reviewers);
      const req = { user: { id: 99, role: 'admin' }, params: { id: 'KCR-0001' } };
      const res = mockRes();
      await submissionController.getReviewers(req, res);
      expect(res.json).toHaveBeenCalledWith(reviewers);
    });

    test('returns reviewers when caller is editor', async () => {
      const reviewers = [{ id: 7, first_name: 'A', last_name: 'B' }];
      Submission.findBySubmissionId.mockResolvedValue({ id: 1, user_id: 5 });
      Submission.getAssignedReviewers.mockResolvedValue(reviewers);
      const req = { user: { id: 99, role: 'editor' }, params: { id: 'KCR-0001' } };
      const res = mockRes();
      await submissionController.getReviewers(req, res);
      expect(res.json).toHaveBeenCalledWith(reviewers);
    });

    test('returns reviewers when caller is an assigned reviewer', async () => {
      const reviewers = [{ id: 7, first_name: 'A', last_name: 'B' }];
      Submission.findBySubmissionId.mockResolvedValue({ id: 1, user_id: 5 });
      pool.query.mockResolvedValue({ rows: [{ '?column?': 1 }] });
      Submission.getAssignedReviewers.mockResolvedValue(reviewers);
      const req = { user: { id: 7, role: 'reviewer' }, params: { id: 'KCR-0001' } };
      const res = mockRes();
      await submissionController.getReviewers(req, res);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM assignments'),
        [1, 7]
      );
      expect(res.json).toHaveBeenCalledWith(reviewers);
    });

    test('403 when caller is a reviewer but not assigned to this submission', async () => {
      Submission.findBySubmissionId.mockResolvedValue({ id: 1, user_id: 5 });
      pool.query.mockResolvedValue({ rows: [] });
      const req = { user: { id: 8, role: 'reviewer' }, params: { id: 'KCR-0001' } };
      const res = mockRes();
      await submissionController.getReviewers(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(Submission.getAssignedReviewers).not.toHaveBeenCalled();
    });
  });
});
