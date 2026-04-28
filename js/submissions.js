let mySubmissions = [];
let currentSubmission = null;

function getQueryId() {
  return new URLSearchParams(window.location.search).get('id');
}

function statusBadge(status) {
  const map = {
    pending: 'badge-pending',
    in_review: 'badge-review',
    accepted: 'badge-accepted',
    rejected: 'badge-rejected'
  };

  const label = {
    pending: 'Pending',
    in_review: 'In Review',
    accepted: 'Accepted',
    rejected: 'Rejected'
  };

  return `<span class="badge ${map[status] || 'badge-pending'}">${label[status] || status}</span>`;
}

function formatDate(iso) {
  if (!iso) return '&mdash;';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function renderStars(avgRating) {
  if (!avgRating) return '<span class="text-muted">&mdash;</span>';

  const rating = Math.round(Number(avgRating));
  let html = '<div class="rating" style="font-size:.9rem;">';

  for (let i = 1; i <= 5; i++) {
    html += `<span class="star ${i <= rating ? 'filled' : ''}">&#9733;</span>`;
  }

  html += '</div>';
  return html;
}

async function handleSubmission(e) {
  e.preventDefault();

  const submitBtn = document.querySelector('button[form="submissionForm"]');
  const progress = document.getElementById('uploadProgress');
  const fill = document.getElementById('progressFill');
  const pct = document.getElementById('progressPercent');

  const formData = new FormData();
  formData.append('title', document.getElementById('title').value);
  formData.append('genre', document.getElementById('genre').value);
  formData.append('word_count', document.getElementById('wordCount').value);
  formData.append('bio', document.getElementById('bio').value);
  formData.append('notes', document.getElementById('notes').value);

  const files = document.getElementById('files').files;
  for (const file of files) {
    formData.append('files', file);
  }

  if (submitBtn) submitBtn.disabled = true;
  if (progress) progress.style.display = 'block';

  try {
    const res = await fetch('/api/submissions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getToken()}`
      },
      body: formData
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to submit');
    }

    if (fill) fill.style.width = '100%';
    if (pct) pct.textContent = '100%';

    alert(`Submission received! Your Submission ID is #${data.submission.submission_id}`);
    window.location.href = 'dashboard.html';

  } catch (err) {
    alert(err.message);
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function loadMySubmissions() {
  const tbody = document.getElementById('my-submissions-tbody');
  if (!tbody) return;

  try {
    const res = await apiFetch('/api/submissions/mine');
    mySubmissions = await res.json();

    renderSubmissionsTable(mySubmissions);
  } catch (err) {
    console.error('Failed to load submissions:', err);
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;" class="text-muted">Failed to load submissions.</td></tr>';
  }
}

function renderSubmissionsTable(list) {
  const tbody = document.getElementById('my-submissions-tbody');
  if (!tbody) return;

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;" class="text-muted">No submissions found.</td></tr>';
    const count = document.getElementById('submissions-count');
    if (count) count.textContent = 'Showing 0 of 0 submissions';
    return;
  }

  tbody.innerHTML = list.map(sub => `
    <tr>
      <td><strong>#${sub.submission_id}</strong></td>
      <td>${sub.title || 'Untitled'}</td>
      <td>${sub.genre || '&mdash;'}</td>
      <td>${sub.word_count || '&mdash;'}</td>
      <td>${formatDate(sub.created_at)}</td>
      <td>${statusBadge(sub.status)}</td>
      <td>${renderStars(sub.avg_rating)}</td>
      <td>
        <div class="btn-group">
          <a href="submission-detail.html?id=${encodeURIComponent(sub.submission_id)}" class="btn btn-secondary btn-sm">View</a>
          <a href="messages.html?submission=${encodeURIComponent(sub.submission_id)}" class="btn btn-secondary btn-sm">&#9993;</a>
        </div>
      </td>
    </tr>
  `).join('');

  const count = document.getElementById('submissions-count');
  if (count) count.textContent = `Showing ${list.length} of ${mySubmissions.length} submissions`;
}

function filterMySubmissions() {
  const query = (document.getElementById('submissions-search')?.value || '').toLowerCase();
  const status = document.getElementById('filter-status')?.value || '';
  const genre = document.getElementById('filter-genre')?.value || '';
  const sort = document.getElementById('filter-sort')?.value || 'newest';

  let filtered = mySubmissions.filter(sub => {
    if (status && sub.status !== status) return false;
    if (genre && sub.genre !== genre) return false;

    if (query) {
      const haystack = `${sub.submission_id} ${sub.title} ${sub.genre}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }

    return true;
  });

  if (sort === 'oldest') {
    filtered.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  } else if (sort === 'title') {
    filtered.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  } else {
    filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  renderSubmissionsTable(filtered);
}

async function loadDashboard() {
  const tbody = document.getElementById('dashboard-tbody');
  if (!tbody) return;

  try {
    const res = await apiFetch('/api/submissions/mine');
    const data = await res.json();

    tbody.innerHTML = data.slice(0, 5).map(sub => `
      <tr>
        <td><strong>#${sub.submission_id}</strong></td>
        <td>${sub.title || 'Untitled'}</td>
        <td>${sub.genre || '&mdash;'}</td>
        <td>${formatDate(sub.created_at)}</td>
        <td>${statusBadge(sub.status)}</td>
        <td>
          <a href="submission-detail.html?id=${encodeURIComponent(sub.submission_id)}" class="btn btn-secondary btn-sm">View</a>
        </td>
      </tr>
    `).join('');

    const total = document.getElementById('stat-total');
    const pending = document.getElementById('stat-pending');
    const accepted = document.getElementById('stat-accepted');

    if (total) total.textContent = data.length;
    if (pending) pending.textContent = data.filter(s => s.status === 'pending').length;
    if (accepted) accepted.textContent = data.filter(s => s.status === 'accepted').length;

  } catch (err) {
    console.error('Failed to load dashboard:', err);
  }
}

async function loadSubmissionDetail() {
  const viewer = document.querySelector('.doc-viewer');
  if (!viewer) return;

  const id = getQueryId();
  if (!id) return;

  try {
    const res = await apiFetch(`/api/submissions/${encodeURIComponent(id)}`);

    if (!res.ok) {
      const err = await res.json();
      alert(err.error || 'Failed to load submission');
      return;
    }

    const sub = await res.json();
    currentSubmission = sub;

    renderSubmissionDetail(sub);
    await loadSubmissionFiles(id);

  } catch (err) {
    console.error('Failed to load submission detail:', err);

    const title = document.getElementById('detail-title');
    const preview = document.getElementById('document-preview-body');

    if (title) title.textContent = 'Error loading submission';
    if (preview) {
      preview.innerHTML = '<p class="text-muted">Something went wrong loading this submission.</p>';
    }
  }
}

function renderSubmissionDetail(sub) {
  document.getElementById('detail-page-title').innerHTML =
    `<a href="submissions.html" style="color:var(--text-muted);font-weight:500;">&larr; Back</a>
     &nbsp; Submission #${sub.submission_id}`;

  document.getElementById('detail-title').textContent = sub.title || 'Untitled';
  document.getElementById('detail-id').textContent = `#${sub.submission_id}`;
  document.getElementById('detail-genre').textContent = sub.genre || '—';
  document.getElementById('detail-word-count').textContent = sub.word_count || '—';
  document.getElementById('detail-date').textContent = formatDate(sub.created_at);

  const badge = document.getElementById('detail-status');
  if (badge) badge.outerHTML = statusBadge(sub.status).replace('<span', '<span id="detail-status"');

  const user = getUser();
  const decisionCard = document.getElementById('decision-card');
  if (decisionCard && user && user.role !== 'admin' && user.role !== 'editor') {
    decisionCard.style.display = 'none';
  }
}

async function loadSubmissionFiles(id) {
  const filesBox = document.getElementById('detail-files');
  const previewBody = document.getElementById('document-preview-body');
  const previewName = document.getElementById('preview-file-name');
  const downloadBtn = document.getElementById('download-file-btn');

  try {
    const res = await apiFetch(`/api/submissions/${encodeURIComponent(id)}/files`);
    const files = await res.json();

    if (!filesBox) return;

    if (!files.length) {
      filesBox.innerHTML = '<span class="text-muted">No files uploaded.</span>';
      if (previewBody) previewBody.innerHTML = '<p class="text-muted">No file preview available.</p>';
      return;
    }

    filesBox.innerHTML = files.map(file => `
      <div class="file-item" style="margin-top:.25rem;">
        <span>&#128196;</span>
        <a class="file-name" href="/uploads/${file.filename}" download>${file.original_name}</a>
        <span class="file-size">${Math.round(file.size / 1024)} KB</span>
      </div>
    `).join('');

    const first = files[0];

    if (previewName) previewName.textContent = first.original_name;
    if (downloadBtn) {
      downloadBtn.onclick = () => {
        window.location.href = `/uploads/${first.filename}`;
      };
    }

    if (previewBody) {
      if (first.mimetype === 'application/pdf' || first.original_name.toLowerCase().endsWith('.pdf')) {
        previewBody.innerHTML = `<iframe src="/uploads/${first.filename}" style="width:100%;height:100%;border:none;"></iframe>`;
      } else {
        previewBody.innerHTML = '<p class="text-muted" style="text-align:center;margin-top:2rem;">Preview is only available for PDFs. Use Download to view this file.</p>';
      }
    }

  } catch (err) {
    console.error('Failed to load files:', err);
  }
}

async function setDecision(status) {
  const id = getQueryId();
  if (!id) return;

  try {
    const res = await apiFetch(`/api/submissions/${encodeURIComponent(id)}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status })
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || 'Failed to update status');
      return;
    }

    renderSubmissionDetail(data);
    alert('Status updated successfully');

  } catch (err) {
    console.error('Failed to update status:', err);
    alert('Failed to update status');
  }
}

function initSubmitForm() {
  const form = document.getElementById('submissionForm');
  const fileInput = document.getElementById('files');
  const uploadZone = document.getElementById('uploadZone');
  const fileList = document.getElementById('fileList');

  if (!form) return;

  form.addEventListener('submit', handleSubmission);

  if (uploadZone && fileInput) {
    uploadZone.addEventListener('click', () => fileInput.click());

    uploadZone.addEventListener('dragover', e => {
      e.preventDefault();
      uploadZone.classList.add('dragover');
    });

    uploadZone.addEventListener('dragleave', () => {
      uploadZone.classList.remove('dragover');
    });

    uploadZone.addEventListener('drop', e => {
      e.preventDefault();
      uploadZone.classList.remove('dragover');
      fileInput.files = e.dataTransfer.files;
      renderSelectedFiles();
    });

    fileInput.addEventListener('change', renderSelectedFiles);
  }

  function renderSelectedFiles() {
    if (!fileList || !fileInput) return;

    fileList.innerHTML = '';

    Array.from(fileInput.files).forEach(file => {
      const div = document.createElement('div');
      div.className = 'file-item';
      const ext = file.name.split('.').pop().toUpperCase();

      div.innerHTML = `
        <span style="font-size:1.2rem;">&#128196;</span>
        <span class="file-name">${file.name}</span>
        <span class="file-size">${(file.size / 1024).toFixed(1)} KB</span>
        <span class="badge badge-info">${ext}</span>
      `;

      fileList.appendChild(div);
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initSubmitForm();
  loadMySubmissions();
  loadDashboard();
  loadSubmissionDetail();

  document.getElementById('submissions-search')?.addEventListener('input', filterMySubmissions);
  document.getElementById('filter-status')?.addEventListener('change', filterMySubmissions);
  document.getElementById('filter-genre')?.addEventListener('change', filterMySubmissions);
  document.getElementById('filter-sort')?.addEventListener('change', filterMySubmissions);
});

window.setDecision = setDecision;