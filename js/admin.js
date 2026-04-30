/* ============================================
   KCR Admin Panel — API Integration
   ============================================ */

const API = '/api/admin';

const sharedApiFetch = window.apiFetch;

const apiFetch = async (endpoint, options = {}) => {
  if (!getToken()) {
    window.location.href = 'index.html';
    return null;
  }

  let res;
  try {
    res = await sharedApiFetch(`${API}${endpoint}`, options);
  } catch (err) {
    return null;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    alert(data.error || 'Something went wrong');
    return null;
  }
  return data;
};

// ---- Helpers ----

const AVATAR_COLORS = [
  'var(--primary)', 'var(--success)', 'var(--danger)', '#7c3aed',
  'var(--warning)', '#0ea5e9', '#ec4899', '#14b8a6',
];

function avatarColor(id) {
  return AVATAR_COLORS[id % AVATAR_COLORS.length];
}

function getInitials(firstName, lastName) {
  return ((firstName?.[0] || '') + (lastName?.[0] || '')).toUpperCase();
}

function statusBadge(status) {
  const map   = { pending: 'badge-pending', in_review: 'badge-review', accepted: 'badge-accepted', rejected: 'badge-rejected' };
  const label = { pending: 'Pending', in_review: 'In Review', accepted: 'Accepted', rejected: 'Rejected' };
  return `<span class="badge ${map[status] || 'badge-pending'}">${label[status] || status}</span>`;
}

function roleBadgeClass(role) {
  return { admin: 'badge-rejected', editor: 'badge-review', reviewer: 'badge-info', submitter: 'badge-pending' }[role] || 'badge-pending';
}

function formatDate(dateStr) {
  if (!dateStr) return '\u2014';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
}

// ---- Tab switching ----

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

let submissionsData = [];

async function loadSubmissions() {
  const data = await apiFetch('/export');
  if (!data) return;

  submissionsData = data.submissions || [];
  renderSubmissions(submissionsData);
  updateStats(submissionsData);
}

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

function updateStats(submissions) {
  document.getElementById('stat-total').textContent    = submissions.length;
  document.getElementById('stat-pending').textContent  = submissions.filter(s => s.status === 'pending').length;
  document.getElementById('stat-accepted').textContent = submissions.filter(s => s.status === 'accepted').length;
}

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

let usersData = [];

async function loadUsers() {
  const data = await apiFetch('/users');
  if (!data) return;

  usersData = data;
  renderUsers(usersData);
  document.getElementById('stat-users').textContent = usersData.length;
}

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

function openEditRoleModal(userId) {
  const user = usersData.find(u => u.id === userId);
  if (!user) return;

  document.getElementById('editRoleUserId').value      = userId;
  document.getElementById('editRoleName').textContent   = `${user.first_name} ${user.last_name}`;
  document.getElementById('editRoleSelect').value       = user.role;
  document.getElementById('editRoleModal').classList.add('show');
}

async function saveUserRole() {
  const userId = document.getElementById('editRoleUserId').value;
  const role   = document.getElementById('editRoleSelect').value;

  const result = await apiFetch(`/users/${userId}/role`, {
    method: 'PUT',
    body: JSON.stringify({ role }),
  });

  if (result) {
    document.getElementById('editRoleModal').classList.remove('show');
    loadUsers();
  }
}

// ---- Delete User ----

async function confirmDeleteUser(userId, name) {
  if (!confirm(`Are you sure you want to delete ${name}? This cannot be undone.`)) return;

  const result = await apiFetch(`/users/${userId}`, { method: 'DELETE' });
  if (result) loadUsers();
}

// ================================================================
//  REVIEWER ASSIGNMENTS TAB
// ================================================================

let workloadData = [];

async function loadWorkload() {
  const data = await apiFetch('/workload');
  if (!data) return;

  workloadData = data;
  renderWorkload(data);
}

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

let assignTargetSubmissionId = null;

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

async function submitAssignments() {
  const checked = document.querySelectorAll('#assignReviewerList input[type="checkbox"]:checked');
  if (checked.length === 0) {
    alert('Select at least one reviewer');
    return;
  }

  let successCount = 0;
  for (const cb of checked) {
    const result = await apiFetch('/assign', {
      method: 'POST',
      body: JSON.stringify({
        submission_id: assignTargetSubmissionId,
        reviewer_id: parseInt(cb.value, 10),
      }),
    });
    if (result) successCount++;
  }

  document.getElementById('assignModal').classList.remove('show');
  if (successCount > 0) {
    alert(`${successCount} reviewer(s) assigned successfully`);
    loadWorkload();
    loadSubmissions();
  }
}

// ================================================================
//  BULK STATUS UPDATE
// ================================================================

function openBulkStatusModal() {
  const checked = document.querySelectorAll('#submissions-tbody input[type="checkbox"]:checked');
  if (checked.length === 0) {
    alert('Select at least one submission first');
    return;
  }
  document.getElementById('bulkCount').textContent = checked.length;
  document.getElementById('bulkStatusModal').classList.add('show');
}

async function submitBulkStatus() {
  const checked = document.querySelectorAll('#submissions-tbody input[type="checkbox"]:checked');
  const ids     = [...checked].map(cb => cb.value);
  const status  = document.getElementById('bulkStatusSelect').value;

  const result = await apiFetch('/submissions/bulk-status', {
    method: 'PUT',
    body: JSON.stringify({ submission_ids: ids, status }),
  });

  if (result) {
    document.getElementById('bulkStatusModal').classList.remove('show');
    alert(result.message);
    loadSubmissions();
  }
}

// ================================================================
//  EXPORT DATA
// ================================================================

async function submitExport() {
  const data = await apiFetch('/export');
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

document.addEventListener('DOMContentLoaded', () => {
  if (!getToken()) {
    window.location.href = 'index.html';
    return;
  }

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
