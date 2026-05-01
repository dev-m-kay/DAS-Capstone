/**
 * @file Admin Panel client for the KCR Submission Manager.
 *
 * Powers `html/admin.html`: lists submissions, manages users, assigns
 * reviewers, performs bulk status changes, and exports data. All data calls
 * go through {@link adminFetch} which prefixes endpoints with `/api/admin`
 * and surfaces non-2xx responses inline via a `{ __error, message }` shape.
 *
 * Requires `js/app.js` to be loaded first (provides `getToken` and
 * `window.apiFetch`).
 */

/** @constant {string} Base path for all admin API endpoints. */
const API = '/api/admin';

/**
 * Admin-scoped wrapper around the shared `apiFetch` (defined in `app.js` and
 * exposed on `window`).
 *
 * IMPORTANT: this is named `adminFetch` (not `apiFetch`) on purpose — both
 * files load as classic scripts into the same global scope, and `app.js`
 * already declares `apiFetch` at module top level. Redeclaring `apiFetch`
 * here with `const` would be a global-scope `SyntaxError` and abort *every*
 * statement in this file (including the `DOMContentLoaded` listener that
 * wires the page up).
 *
 * The shared fetch is looked up at *call* time rather than at module-load
 * time so script-evaluation order can never leave us with a stale `undefined`
 * reference.
 *
 * Prefixes the endpoint with {@link API}, redirects to login when no token is
 * present, returns `{ __error: true, message }` on non-2xx responses (so
 * callers can surface the error inline), and returns the parsed JSON body on
 * success.
 *
 * @async
 * @param {string} endpoint  Path relative to `/api/admin` (must start with `/`).
 * @param {RequestInit} [options={}]  Standard `fetch` options (method, body, headers).
 * @returns {Promise<Object>} Parsed JSON on success; otherwise `{ __error: true, message }`.
 */
const adminFetch = async (endpoint, options = {}) => {
  if (!getToken()) {
    window.location.href = 'index.html';
    return { __error: true, message: 'Not signed in' };
  }
  if (typeof window.apiFetch !== 'function') {
    console.error('[admin] window.apiFetch is missing — js/app.js failed to load?');
    return { __error: true, message: 'app.js failed to load' };
  }

  let res;
  try {
    res = await window.apiFetch(`${API}${endpoint}`, options);
  } catch (err) {
    console.error(`[admin] network error calling ${API}${endpoint}:`, err);
    return { __error: true, message: err.message || 'Network error' };
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`[admin] ${API}${endpoint} returned ${res.status}:`, data);
    return { __error: true, message: data.error || `HTTP ${res.status}` };
  }
  return data;
};

// ---- Helpers ----

/** @constant {string[]} Palette used to color user avatars; index = `userId % length`. */
const AVATAR_COLORS = [
  'var(--primary)', 'var(--success)', 'var(--danger)', '#7c3aed',
  'var(--warning)', '#0ea5e9', '#ec4899', '#14b8a6',
];

/**
 * Picks a stable avatar color for a user based on their numeric id.
 *
 * @param {number} id  User id.
 * @returns {string} CSS color value from {@link AVATAR_COLORS}.
 */
function avatarColor(id) {
  return AVATAR_COLORS[id % AVATAR_COLORS.length];
}

/**
 * Builds initials (e.g. "JD") from a user's first and last name.
 *
 * @param {string} [firstName]
 * @param {string} [lastName]
 * @returns {string} Uppercased two-letter initials (may be empty).
 */
function getInitials(firstName, lastName) {
  return ((firstName?.[0] || '') + (lastName?.[0] || '')).toUpperCase();
}

/**
 * Renders a colored status pill for a submission.
 *
 * @param {('pending'|'in_review'|'accepted'|'rejected')} status
 * @returns {string} HTML for a `<span class="badge …">` element.
 */
function statusBadge(status) {
  const map   = { pending: 'badge-pending', in_review: 'badge-review', accepted: 'badge-accepted', rejected: 'badge-rejected' };
  const label = { pending: 'Pending', in_review: 'In Review', accepted: 'Accepted', rejected: 'Rejected' };
  return `<span class="badge ${map[status] || 'badge-pending'}">${label[status] || status}</span>`;
}

/**
 * Maps a user role to the CSS class for its badge.
 *
 * @param {('admin'|'editor'|'reviewer'|'submitter')} role
 * @returns {string} Badge CSS class name.
 */
function roleBadgeClass(role) {
  return { admin: 'badge-rejected', editor: 'badge-review', reviewer: 'badge-info', submitter: 'badge-pending' }[role] || 'badge-pending';
}

/**
 * Formats an ISO date string for display (e.g. "Mar 14, 2026").
 *
 * @param {string|null|undefined} dateStr  ISO 8601 timestamp.
 * @returns {string} Localized short date, or an em-dash if unset.
 */
function formatDate(dateStr) {
  if (!dateStr) return '\u2014';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Escapes a value for safe interpolation inside an HTML attribute.
 *
 * @param {*} str  Value to escape (will be coerced to string).
 * @returns {string} Escaped attribute-safe string.
 */
function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
}

// ---- Tab switching ----

/**
 * Switches the visible admin tab panel.
 *
 * Hides every `[id^="section-"]` block, shows `#section-<name>`, and toggles
 * `.active` on the matching tab button.
 *
 * @param {string} name              Suffix of the panel id to show.
 * @param {HTMLElement} [el]         Tab button that triggered the switch.
 * @returns {void}
 */
function showSection(name, el) {
  document.querySelectorAll('[id^="section-"]').forEach(s => s.style.display = 'none');
  const target = document.getElementById('section-' + name);
  if (target) target.style.display = '';
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
}

// ================================================================
//  SUBMISSIONS TAB  (populated via GET /api/admin/export)
// ================================================================

/** @type {Array<Object>} Cached list of all submissions for client-side filtering. */
let submissionsData = [];

/**
 * Loads every submission from `GET /api/admin/export`, caches the result in
 * {@link submissionsData}, and refreshes the table + stat counters.
 *
 * @async
 * @returns {Promise<void>}
 */
async function loadSubmissions() {
  const tbody = document.getElementById('submissions-tbody');
  const data = await adminFetch('/export');
  if (data && data.__error) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:2rem;color:var(--danger);">Failed to load submissions: ${escapeAttr(data.message)}</td></tr>`;
    }
    const count = document.getElementById('submissions-count');
    if (count) count.textContent = 'Error';
    return;
  }
  if (!data) return;

  submissionsData = data.submissions || [];
  renderSubmissions(submissionsData);
  updateStats(submissionsData);
}

/**
 * Renders the submissions table body and updates the "Showing X of Y" count.
 *
 * @param {Array<Object>} list  Submissions to render (may be a filtered subset).
 * @returns {void}
 */
function renderSubmissions(list) {
  const tbody = document.getElementById('submissions-tbody');
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:2rem;" class="text-muted">No submissions found</td></tr>';
    document.getElementById('submissions-count').textContent = 'No submissions';
    return;
  }

  tbody.innerHTML = list.map(s => {
    const rating = s.avg_rating ? parseFloat(s.avg_rating).toFixed(1) : '\u2014';
    return `
      <tr data-submission-id="${escapeAttr(s.submission_id)}">
        <td><input type="checkbox" value="${escapeAttr(s.submission_id)}"></td>
        <td><strong>#${escapeAttr(s.submission_id)}</strong></td>
        <td>${escapeAttr(s.title)}</td>
        <td>${escapeAttr(s.author_name)}</td>
        <td>${escapeAttr(s.genre)}</td>
        <td>${formatDate(s.created_at)}</td>
        <td>${statusBadge(s.status)}</td>
        <td>${rating}</td>
        <td>
          <div class="btn-group">
            <a href="submission-detail.html?id=${encodeURIComponent(s.submission_id)}" class="btn btn-secondary btn-sm">View</a>
            <button type="button" class="btn btn-secondary btn-sm" data-action="assign" data-submission-id="${escapeAttr(s.submission_id)}">Assign</button>
          </div>
        </td>
      </tr>`;
  }).join('');

  document.getElementById('submissions-count').textContent =
    `Showing ${list.length} of ${submissionsData.length} submissions`;
}

/**
 * Updates the dashboard stat counters (`#stat-total`, `#stat-pending`,
 * `#stat-accepted`).
 *
 * @param {Array<Object>} submissions  Full submissions list.
 * @returns {void}
 */
function updateStats(submissions) {
  document.getElementById('stat-total').textContent    = submissions.length;
  document.getElementById('stat-pending').textContent  = submissions.filter(s => s.status === 'pending').length;
  document.getElementById('stat-accepted').textContent = submissions.filter(s => s.status === 'accepted').length;
}

/**
 * Re-renders the submissions table after applying the current search query
 * and status/genre filters to the cached {@link submissionsData}.
 *
 * @returns {void}
 */
function filterSubmissions() {
  const query  = (document.getElementById('submissions-search')?.value || '').toLowerCase();
  const status = document.getElementById('filter-status')?.value || '';
  const genre  = document.getElementById('filter-genre')?.value || '';

  const filtered = submissionsData.filter(s => {
    if (status && s.status !== status) return false;
    if (genre  && s.genre  !== genre)  return false;
    if (query) {
      const haystack = `${s.submission_id} ${s.title} ${s.author_name} ${s.genre}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  renderSubmissions(filtered);
}

// ================================================================
//  USER MANAGEMENT TAB
// ================================================================

/** @type {Array<Object>} Cached list of users. */
let usersData = [];

/**
 * Loads users from `GET /api/admin/users`, caches them in {@link usersData},
 * renders the user table, and updates the user-count stat.
 *
 * @async
 * @returns {Promise<void>}
 */
async function loadUsers() {
  const tbody = document.getElementById('users-tbody');
  const data = await adminFetch('/users');
  if (data && data.__error) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--danger);">Failed to load users: ${escapeAttr(data.message)}</td></tr>`;
    }
    return;
  }
  if (!data) return;

  usersData = Array.isArray(data) ? data : [];
  renderUsers(usersData);
  document.getElementById('stat-users').textContent = usersData.length;
}

/**
 * Renders the users table body.
 *
 * @param {Array<Object>} list  Users to render.
 * @returns {void}
 */
function renderUsers(list) {
  const tbody = document.getElementById('users-tbody');
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;" class="text-muted">No users found</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(u => {
    const ini   = getInitials(u.first_name, u.last_name);
    const color = avatarColor(u.id);
    const name  = `${u.first_name} ${u.last_name}`;
    const role  = u.role.charAt(0).toUpperCase() + u.role.slice(1);

    return `
      <tr data-user-id="${u.id}">
        <td>
          <div style="display:flex;align-items:center;gap:.75rem;">
            <div style="width:32px;height:32px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:600;font-size:.75rem;">${ini}</div>
            <strong>${escapeAttr(name)}</strong>
          </div>
        </td>
        <td>${escapeAttr(u.email)}</td>
        <td><span class="badge ${roleBadgeClass(u.role)}">${role}</span></td>
        <td>${formatDate(u.created_at)}</td>
        <td><span class="badge badge-accepted">Active</span></td>
        <td>
          <div class="btn-group">
            <button type="button" class="btn btn-secondary btn-sm" data-action="edit-role" data-user-id="${u.id}">Edit</button>
            <button type="button" class="btn btn-danger btn-sm" data-action="delete-user" data-user-id="${u.id}" data-user-name="${escapeAttr(name)}">Delete</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

// ---- Edit Role ----

/**
 * Opens the Edit Role modal pre-filled with the selected user's current role.
 *
 * @param {number} userId  Numeric user id from {@link usersData}.
 * @returns {void}
 */
function openEditRoleModal(userId) {
  const user = usersData.find(u => u.id === userId);
  if (!user) return;

  document.getElementById('editRoleUserId').value      = userId;
  document.getElementById('editRoleName').textContent   = `${user.first_name} ${user.last_name}`;
  document.getElementById('editRoleSelect').value       = user.role;
  document.getElementById('editRoleModal').classList.add('show');
}

/**
 * Submits the Edit Role modal: PUTs the new role to
 * `/api/admin/users/:id/role`, closes the modal, and reloads the users list.
 *
 * @async
 * @returns {Promise<void>}
 */
async function saveUserRole() {
  const userId = document.getElementById('editRoleUserId').value;
  const role   = document.getElementById('editRoleSelect').value;

  const result = await adminFetch(`/users/${userId}/role`, {
    method: 'PUT',
    body: JSON.stringify({ role }),
  });

  if (!result || result.__error) {
    if (result && result.__error) alert(result.message);
    return;
  }
  document.getElementById('editRoleModal').classList.remove('show');
  loadUsers();
}

// ---- Delete User ----

/**
 * Prompts for confirmation, then deletes the user via
 * `DELETE /api/admin/users/:id`. Reloads the users list on success.
 *
 * @async
 * @param {number} userId  Id of the user to delete.
 * @param {string} name    Display name shown in the confirmation prompt.
 * @returns {Promise<void>}
 */
async function confirmDeleteUser(userId, name) {
  const warning =
    `Delete ${name}?\n\n` +
    'This will also permanently remove every record tied to this account:\n' +
    '  • their submissions (and uploaded files)\n' +
    '  • reviews they have written\n' +
    '  • messages they have sent\n' +
    '  • reviewer assignments\n\n' +
    'This cannot be undone.';
  if (!confirm(warning)) return;

  const result = await adminFetch(`/users/${userId}`, { method: 'DELETE' });
  if (result && result.__error) {
    alert(result.message);
    return;
  }
  if (result) loadUsers();
}

// ================================================================
//  REVIEWER ASSIGNMENTS TAB
// ================================================================

/** @type {Array<Object>} Cached reviewer workload (one row per reviewer/editor). */
let workloadData = [];

/**
 * Loads reviewer workload from `GET /api/admin/workload` and renders the
 * Assignments grid.
 *
 * @async
 * @returns {Promise<void>}
 */
async function loadWorkload() {
  const grid = document.getElementById('assignments-grid');
  const data = await adminFetch('/workload');
  if (data && data.__error) {
    if (grid) {
      grid.innerHTML = `<p class="text-muted" style="padding:2rem;text-align:center;color:var(--danger);">Failed to load reviewers: ${escapeAttr(data.message)}</p>`;
    }
    return;
  }
  if (!data) return;

  workloadData = Array.isArray(data) ? data : [];
  renderWorkload(workloadData);
}

/**
 * Renders one card per reviewer in the Assignments grid, with a colored
 * progress bar showing their current workload (`assigned_count / 10`).
 *
 * @param {Array<Object>} list  Workload rows from `/api/admin/workload`.
 * @returns {void}
 */
function renderWorkload(list) {
  const container = document.getElementById('assignments-grid');
  if (!container) return;

  if (list.length === 0) {
    container.innerHTML = '<p class="text-muted" style="padding:2rem;text-align:center;">No reviewers found</p>';
    return;
  }

  const MAX_LOAD = 10;

  container.innerHTML = list.map(r => {
    const ini   = getInitials(r.first_name, r.last_name);
    const color = avatarColor(r.id);
    const count = parseInt(r.assigned_count, 10);
    const pct   = Math.min(Math.round((count / MAX_LOAD) * 100), 100);
    const fill  = pct >= 70 ? 'yellow' : pct >= 40 ? 'green' : 'blue';

    return `
      <div class="card">
        <div class="card-header">
          <div style="display:flex;align-items:center;gap:.75rem;">
            <div style="width:40px;height:40px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:600;font-size:.85rem;">${ini}</div>
            <div>
              <strong>${escapeAttr(r.first_name)} ${escapeAttr(r.last_name)}</strong>
              <div class="text-small text-muted">${escapeAttr(r.email)}</div>
            </div>
          </div>
        </div>
        <div class="card-body">
          <div style="display:flex;justify-content:space-between;margin-bottom:.75rem;">
            <span class="text-small text-muted">Workload</span>
            <span class="text-small" style="font-weight:600;">${count} / ${MAX_LOAD}</span>
          </div>
          <div class="progress-bar">
            <div class="fill ${fill}" style="width:${pct}%;"></div>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ================================================================
//  ASSIGN REVIEWER MODAL
// ================================================================

/** @type {?string} Submission id the Assign-Reviewer modal is currently targeting. */
let assignTargetSubmissionId = null;

/**
 * Opens the Assign Reviewer modal for a given submission and populates it
 * with checkbox rows for every reviewer in {@link workloadData}.
 *
 * @param {string} submissionId  Public submission id (e.g. "KCR-0001").
 * @returns {void}
 */
function openAssignModal(submissionId) {
  assignTargetSubmissionId = submissionId;
  document.getElementById('assignSubmissionLabel').innerHTML =
    `Select one or more reviewers for submission <strong>#${escapeAttr(submissionId)}</strong>`;

  const list = document.getElementById('assignReviewerList');

  if (workloadData.length === 0) {
    list.innerHTML = '<p class="text-muted">No reviewers available</p>';
  } else {
    list.innerHTML = workloadData.map(r => {
      const ini   = getInitials(r.first_name, r.last_name);
      const color = avatarColor(r.id);
      const count = parseInt(r.assigned_count, 10);
      return `
        <label style="display:flex;align-items:center;gap:.75rem;padding:.75rem;border:1px solid var(--border);border-radius:var(--radius);cursor:pointer;">
          <input type="checkbox" value="${r.id}">
          <div style="width:32px;height:32px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:600;font-size:.7rem;">${ini}</div>
          <div>
            <div style="font-weight:600;font-size:.85rem;">${escapeAttr(r.first_name)} ${escapeAttr(r.last_name)}</div>
            <div class="text-small text-muted">${count} / 10 assignments</div>
          </div>
        </label>`;
    }).join('');
  }

  document.getElementById('assignModal').classList.add('show');
}

/**
 * Submits the Assign Reviewer modal: POSTs one assignment per checked
 * reviewer to `/api/admin/assign`, closes the modal, then refreshes
 * workload and submissions.
 *
 * @async
 * @returns {Promise<void>}
 */
async function submitAssignments() {
  const checked = document.querySelectorAll('#assignReviewerList input[type="checkbox"]:checked');
  if (checked.length === 0) {
    alert('Select at least one reviewer');
    return;
  }

  let successCount = 0;
  const errors = [];
  for (const cb of checked) {
    const result = await adminFetch('/assign', {
      method: 'POST',
      body: JSON.stringify({
        submission_id: assignTargetSubmissionId,
        reviewer_id: parseInt(cb.value, 10),
      }),
    });
    if (result && !result.__error) {
      successCount++;
    } else if (result && result.__error) {
      errors.push(result.message);
    }
  }

  document.getElementById('assignModal').classList.remove('show');
  if (successCount > 0) {
    let msg = `${successCount} reviewer(s) assigned successfully`;
    if (errors.length) msg += `\n(${errors.length} failed: ${errors.join('; ')})`;
    alert(msg);
    loadWorkload();
    loadSubmissions();
  } else if (errors.length) {
    alert(`Failed to assign reviewers: ${errors.join('; ')}`);
  }
}

// ================================================================
//  BULK STATUS UPDATE
// ================================================================

/**
 * Opens the Bulk Status modal if at least one row checkbox is selected.
 * Updates the displayed count of affected submissions.
 *
 * @returns {void}
 */
function openBulkStatusModal() {
  const checked = document.querySelectorAll('#submissions-tbody input[type="checkbox"]:checked');
  if (checked.length === 0) {
    alert('Select at least one submission first');
    return;
  }
  document.getElementById('bulkCount').textContent = checked.length;
  document.getElementById('bulkStatusModal').classList.add('show');
}

/**
 * Submits the Bulk Status modal: PUTs the chosen status and the array of
 * checked submission ids to `/api/admin/submissions/bulk-status`, then
 * reloads submissions.
 *
 * @async
 * @returns {Promise<void>}
 */
async function submitBulkStatus() {
  const checked = document.querySelectorAll('#submissions-tbody input[type="checkbox"]:checked');
  const ids     = [...checked].map(cb => cb.value);
  const status  = document.getElementById('bulkStatusSelect').value;

  const result = await adminFetch('/submissions/bulk-status', {
    method: 'PUT',
    body: JSON.stringify({ submission_ids: ids, status }),
  });

  if (result && result.__error) {
    alert(result.message);
    return;
  }
  if (result) {
    document.getElementById('bulkStatusModal').classList.remove('show');
    alert(result.message);
    loadSubmissions();
  }
}

// ================================================================
//  EXPORT DATA
// ================================================================

/**
 * Fetches the full export from `GET /api/admin/export` and triggers a
 * client-side download as `kcr-export-YYYY-MM-DD.json`.
 *
 * @async
 * @returns {Promise<void>}
 */
async function submitExport() {
  const data = await adminFetch('/export');
  if (data && data.__error) {
    alert(`Export failed: ${data.message}`);
    return;
  }
  if (!data) return;

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `kcr-export-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  document.getElementById('exportModal').classList.remove('show');
}

// ================================================================
//  INIT
// ================================================================

/**
 * Bootstraps the admin page once the DOM is ready: redirects to login if
 * unauthenticated, kicks off initial data loads, and wires up all static
 * (and delegated) event handlers in a CSP-friendly way (no inline `onclick`).
 */
document.addEventListener('DOMContentLoaded', () => {
  console.log('[admin] DOMContentLoaded — booting admin panel');
  if (!getToken()) {
    console.warn('[admin] no auth token, redirecting to index');
    window.location.href = 'index.html';
    return;
  }
  console.log('[admin] window.apiFetch is', typeof window.apiFetch);

  loadSubmissions();
  loadUsers();
  loadWorkload();

  // ---- Static-button wiring (CSP-friendly: no inline onclick) ----

  // Tab buttons
  document.querySelectorAll('[data-admin-section]').forEach(btn => {
    btn.addEventListener('click', () => {
      showSection(btn.getAttribute('data-admin-section'), btn);
    });
  });

  // Filter inputs
  document.getElementById('submissions-search')?.addEventListener('input', filterSubmissions);
  document.getElementById('filter-status')?.addEventListener('change', filterSubmissions);
  document.getElementById('filter-genre')?.addEventListener('change', filterSubmissions);

  // Modal-open / submit buttons (top bar + modals)
  document.querySelectorAll('[data-action="open-modal"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-modal-target');
      const modal = id && document.getElementById(id);
      if (modal) modal.classList.add('show');
    });
  });
  document.querySelector('[data-action="open-bulk-status"]')?.addEventListener('click', openBulkStatusModal);
  document.querySelector('[data-action="submit-assignments"]')?.addEventListener('click', submitAssignments);
  document.querySelector('[data-action="save-user-role"]')?.addEventListener('click', saveUserRole);
  document.querySelector('[data-action="submit-bulk-status"]')?.addEventListener('click', submitBulkStatus);
  document.querySelector('[data-action="submit-export"]')?.addEventListener('click', submitExport);

  // ---- Delegated handlers for dynamically-rendered table rows ----

  document.getElementById('submissions-tbody')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action="assign"]');
    if (!btn) return;
    const id = btn.getAttribute('data-submission-id');
    if (id) openAssignModal(id);
  });

  document.getElementById('users-tbody')?.addEventListener('click', (e) => {
    const editBtn = e.target.closest('button[data-action="edit-role"]');
    if (editBtn) {
      const uid = parseInt(editBtn.getAttribute('data-user-id'), 10);
      if (Number.isInteger(uid)) openEditRoleModal(uid);
      return;
    }
    const delBtn = e.target.closest('button[data-action="delete-user"]');
    if (delBtn) {
      const uid = parseInt(delBtn.getAttribute('data-user-id'), 10);
      const name = delBtn.getAttribute('data-user-name') || 'this user';
      if (Number.isInteger(uid)) confirmDeleteUser(uid, name);
    }
  });
});

