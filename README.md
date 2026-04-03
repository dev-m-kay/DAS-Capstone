# KCR Submission Manager

A web-based submission management platform for the KCR literary magazine. Supports submitters, reviewers, editors, and administrators through a role-based interface.

---
## Milestone 3 Specific
This milestones contains code for all the controllers besides the message controller; admin and auth routes were also completed. Everything to look at has been merged into the main branch.   

## Milestone 2 Specific
This milestone contains code for the review model, the user model, the adminController, as well as the authcontroller. The Branches to look at are the main branch for the adminController, as well as dmkay_authController for the authController code (not pushed to main yet) and sikontoure-review-model for the review model.

## Milestone 1 Specific
This milestone contains the frontend HTML for the project, as well as placeholder code for user authentication. This code is considered placeholder for now as we are still learning how to use supabase and can't properly test it yet.
This code currently has a main branch and a branch called dmkay-auth, dmkay-auth contains the placeholder code for user authentication in server/controllers/authController.js.



## Quick Start

**Prerequisites:** [Node.js](https://nodejs.org/) (v16 or newer)

```bash
# 1. Clone the project
git clone https://github.com/dev-m-kay/DAS-Capstone.git
cd DAS-Capstone

# 2. Install dependencies
npm install

# 3. Create your .env file (see Environment Setup below)

# 4. Start the server
npm start
```

Open **http://localhost:3001** in your browser.

### Environment Setup

Copy `.env.example` to a new file called `.env` and fill in the values:

```bash
cp .env.example .env
```

Your `.env` file needs two values:

```
DATABASE_URL=postgresql://postgres.xxxxx:your-password@aws-1-us-east-1.pooler.supabase.com:5432/postgres
JWT_SECRET=change-this-to-a-random-string
```

Get the `DATABASE_URL` from the team — it's the Supabase PostgreSQL connection string (Session mode, port 5432). The `.env` file is gitignored so credentials stay local.

### Commands

| Command | What it does |
|---------|-------------|
| `npm start` | Start the full server (frontend + API) on port 3001 |
| `npm run dev` | Same, but auto-restarts when you change backend files |
| `npm run frontend` | Frontend-only with live reload on port 3000 (no API) |

---

## Project Structure

```
CSCI4970-Capstone/
├── html/                              # Frontend pages
│   ├── index.html                     #   Login
│   ├── register.html                  #   Account registration
│   ├── dashboard.html                 #   Submitter dashboard
│   ├── submit.html                    #   New submission form + file upload
│   ├── submissions.html               #   Submissions list with filters
│   ├── submission-detail.html         #   In-browser document viewer + review
│   ├── review-queue.html              #   Reviewer queue (anonymized)
│   ├── messages.html                  #   Messaging threads
│   └── admin.html                     #   Admin panel
│
├── css/
│   └── styles.css                     # Shared design system
├── js/
│   └── app.js                         # Shared frontend interactivity
│
├── server/                            # Backend (Express + PostgreSQL)
│   ├── index.js                       #   Entry point — starts server
│   ├── config/
│   │   └── db.js                      #   Supabase PostgreSQL connection + schema
│   ├── middleware/
│   │   ├── auth.js                    #   JWT authentication
│   │   └── roles.js                   #   Role-based access control
│   ├── models/                        #   Database query functions (TODO)
│   │   ├── User.js
│   │   ├── Submission.js
│   │   ├── Review.js
│   │   └── Message.js
│   ├── controllers/                   #   Route handler logic (TODO)
│   │   ├── authController.js
│   │   ├── submissionController.js
│   │   ├── reviewController.js
│   │   ├── messageController.js
│   │   └── adminController.js
│   └── routes/                        #   API endpoint definitions (TODO)
│       ├── auth.js                    #   /api/auth/*
│       ├── submissions.js             #   /api/submissions/*
│       ├── reviews.js                 #   /api/reviews/*
│       ├── messages.js                #   /api/messages/*
│       └── admin.js                   #   /api/admin/*
│
├── uploads/                           # Uploaded submission files (gitignored)
├── .env.example                       # Environment variable template
├── package.json
└── README.md
```

---

## Database

The database is **PostgreSQL hosted on [Supabase](https://supabase.com/)**. Tables are created automatically when the server starts for the first time.

### Tables

| Table | Purpose |
|-------|---------|
| `users` | User accounts with role (admin, editor, reviewer, submitter) |
| `submissions` | Submitted works with title, genre, status, metadata |
| `submission_files` | Files attached to each submission |
| `reviews` | Reviewer ratings and comments (one per reviewer per submission) |
| `messages` | Discussion threads tied to submissions |
| `assignments` | Maps reviewers to submissions |

### Querying the Database

All models should use the shared pool from `server/config/db.js`:

```javascript
const { pool } = require('../config/db');

// Example query
const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
```

PostgreSQL uses `$1, $2, $3` for parameterized queries (not `?` like SQLite).

---

## API Reference

All API routes are prefixed with `/api`. Protected routes require a `Bearer` token in the `Authorization` header.

### Auth

| Method | Endpoint | Body | Access |
|--------|----------|------|--------|
| POST | `/api/auth/register` | `{ first_name, last_name, email, password, bio? }` | Public |
| POST | `/api/auth/login` | `{ email, password }` | Public |
| GET | `/api/auth/me` | — | Logged in |

### Submissions

| Method | Endpoint | Body / Query | Access |
|--------|----------|-------------|--------|
| POST | `/api/submissions` | Form data: `title, genre, word_count?, bio, notes?, files[]` | Logged in |
| GET | `/api/submissions/mine` | — | Logged in |
| GET | `/api/submissions` | `?status=pending&genre=Poetry` | Admin, Editor |
| GET | `/api/submissions/:id` | — | Logged in |
| GET | `/api/submissions/:id/files` | — | Logged in |
| PUT | `/api/submissions/:id/status` | `{ status }` (pending/in_review/accepted/rejected) | Admin, Editor |

### Reviews

| Method | Endpoint | Body | Access |
|--------|----------|------|--------|
| GET | `/api/reviews/mine` | — | Reviewer, Editor |
| GET | `/api/reviews/:submissionId` | — | Logged in |
| POST | `/api/reviews/:submissionId` | `{ rating, comment? }` | Reviewer, Editor |
| PUT | `/api/reviews/:submissionId/:id` | `{ rating?, comment? }` | Own review only |

### Messages

| Method | Endpoint | Body | Access |
|--------|----------|------|--------|
| GET | `/api/messages/threads` | — | Logged in |
| GET | `/api/messages/:submissionId` | — | Logged in |
| POST | `/api/messages/:submissionId` | `{ body }` | Logged in |

### Admin

| Method | Endpoint | Body | Access |
|--------|----------|------|--------|
| GET | `/api/admin/users` | — | Admin |
| PUT | `/api/admin/users/:id/role` | `{ role }` | Admin |
| DELETE | `/api/admin/users/:id` | — | Admin |
| POST | `/api/admin/assign` | `{ submission_id, reviewer_id }` | Admin |
| DELETE | `/api/admin/assign/:subId/:reviewerId` | — | Admin |
| GET | `/api/admin/workload` | — | Admin |
| PUT | `/api/admin/submissions/bulk-status` | `{ submission_ids[], status }` | Admin |
| GET | `/api/admin/export` | — | Admin |

---

## Roles

| Role | Access |
|------|--------|
| **Submitter** | Submit work, track status, view ratings/feedback, message editors |
| **Reviewer** | Review anonymized submissions, rate & comment, discuss with editors |
| **Editor** | All reviewer abilities + accept/reject decisions, communicate with submitters |
| **Admin** | Full access: manage users, assign reviewers, bulk actions, export data |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML5, CSS3, Vanilla JavaScript, Inter font |
| Backend | Node.js, Express |
| Database | PostgreSQL on Supabase |
| Auth | JWT (jsonwebtoken) + bcryptjs |
| File Upload | Multer (stored in `/uploads`) |

---

## Notes

- Tables are created automatically on first `npm start` — no manual SQL needed.
- The `.env` file is **required** — the server won't start without `DATABASE_URL`.
- Frontend pages currently use demo/placeholder data. Connect them to the API endpoints to make them dynamic.
- Uploaded files are stored in the `uploads/` folder and served at `/uploads/filename`.
