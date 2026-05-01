let mySubmissions = [];
let currentSubmission = null;

// Object URLs created for file previews/downloads — revoked on page unload to
// avoid leaking blob references.
const __blobUrls = [];
window.addEventListener('beforeunload', () => {
  __blobUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} });
});

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

// Selected files for the submit form. We track them in our own array (rather
// than reading directly from the file input) so users can remove individual
// files before submitting.
let selectedFiles = [];

function handleSubmission(e) {
  e.preventDefault();

  const submitBtn = document.getElementById('submitBtn') ||
    document.querySelector('button[form="submissionForm"]');
  const progress = document.getElementById('uploadProgress');
  const fill = document.getElementById('progressFill');
  const pct = document.getElementById('progressPercent');

  const formData = new FormData();
  formData.append('title', document.getElementById('title').value);
  formData.append('genre', document.getElementById('genre').value);
  formData.append('word_count', document.getElementById('wordCount').value);
  formData.append('bio', document.getElementById('bio').value);
  formData.append('notes', document.getElementById('notes').value);

  for (const file of selectedFiles) {
    formData.append('files', file);
  }

  if (submitBtn) submitBtn.disabled = true;
  if (progress) {
    progress.classList.add('show');
    progress.style.display = 'block';
  }
  if (fill) fill.style.width = '0%';
  if (pct) pct.textContent = '0%';

  // Use XHR instead of fetch so we can drive the progress bar from
  // upload.onprogress events.
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/submissions');
  xhr.setRequestHeader('Authorization', `Bearer ${getToken()}`);

  xhr.upload.onprogress = (event) => {
    if (!event.lengthComputable) return;
    const percent = Math.round((event.loaded / event.total) * 100);
    if (fill) fill.style.width = percent + '%';
    if (pct) pct.textContent = percent + '%';
  };

  xhr.onload = () => {
    let data = {};
    try { data = JSON.parse(xhr.responseText || '{}'); } catch (e) { /* ignore */ }

    if (xhr.status === 401) {
      signOut();
      return;
    }
    if (xhr.status >= 200 && xhr.status < 300) {
      if (fill) fill.style.width = '100%';
      if (pct) pct.textContent = '100%';
      alert(`Submission received! Your Submission ID is #${data.submission.submission_id}`);
      window.location.href = 'dashboard.html';
    } else {
      alert(data.error || `Failed to submit (HTTP ${xhr.status})`);
      if (submitBtn) submitBtn.disabled = false;
      if (progress) {
        progress.classList.remove('show');
        progress.style.display = 'none';
      }
    }
  };

  xhr.onerror = () => {
    alert('Network error while uploading.');
    if (submitBtn) submitBtn.disabled = false;
    if (progress) {
      progress.classList.remove('show');
      progress.style.display = 'none';
    }
  };

  xhr.send(formData);
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

  tbody.innerHTML = list.map(sub => {
    // Submitters can only delete their own submission while it's still
    // pending — once a reviewer touches it, the row stays put and an admin
    // has to remove it.
    const canDelete = sub.status === 'pending';
    const deleteBtn = canDelete
      ? `<button type="button" class="btn btn-danger btn-sm"
                 data-action="delete-submission"
                 data-submission-id="${escapeHtml(sub.submission_id)}"
                 data-submission-title="${escapeHtml(sub.title || 'Untitled')}">Delete</button>`
      : '';
    return `
      <tr>
        <td><strong>#${escapeHtml(sub.submission_id)}</strong></td>
        <td>${escapeHtml(sub.title || 'Untitled')}</td>
        <td>${escapeHtml(sub.genre || '\u2014')}</td>
        <td>${escapeHtml(sub.word_count || '\u2014')}</td>
        <td>${formatDate(sub.created_at)}</td>
        <td>${statusBadge(sub.status)}</td>
        <td>${renderStars(sub.avg_rating)}</td>
        <td>
          <div class="btn-group">
            <a href="submission-detail.html?id=${encodeURIComponent(sub.submission_id)}" class="btn btn-secondary btn-sm">View</a>
            <a href="messages.html?submission=${encodeURIComponent(sub.submission_id)}" class="btn btn-secondary btn-sm">&#9993;</a>
            ${deleteBtn}
          </div>
        </td>
      </tr>`;
  }).join('');

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

    if (!data.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;" class="text-muted">No submissions yet. <a href="submit.html">Submit your first piece</a>.</td></tr>';
    } else {
      tbody.innerHTML = data.slice(0, 5).map(sub => `
        <tr>
          <td><strong>#${escapeHtml(sub.submission_id)}</strong></td>
          <td>${escapeHtml(sub.title || 'Untitled')}</td>
          <td>${escapeHtml(sub.genre || '\u2014')}</td>
          <td>${formatDate(sub.created_at)}</td>
          <td>${statusBadge(sub.status)}</td>
          <td>
            <a href="submission-detail.html?id=${encodeURIComponent(sub.submission_id)}" class="btn btn-secondary btn-sm">View</a>
          </td>
        </tr>
      `).join('');
    }

    const total = document.getElementById('stat-total');
    const pending = document.getElementById('stat-pending');
    const accepted = document.getElementById('stat-accepted');
    const rejected = document.getElementById('stat-rejected');

    if (total) total.textContent = data.length;
    if (pending) pending.textContent = data.filter(s => s.status === 'pending').length;
    if (accepted) accepted.textContent = data.filter(s => s.status === 'accepted').length;
    if (rejected) rejected.textContent = data.filter(s => s.status === 'rejected').length;

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
     &nbsp; Submission #${escapeHtml(sub.submission_id)}`;

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

  renderDetailDeleteButton(sub, user);
}

// Show a Delete button in the detail-page top bar when the current user is
// allowed to remove this submission. Admins can always delete; the author
// can delete while it's still `pending`. Everyone else gets nothing.
function renderDetailDeleteButton(sub, user) {
  const topBarActions = document.querySelector('.top-bar .top-bar-actions');
  if (!topBarActions) return;
  const existing = document.getElementById('delete-submission-btn');
  if (existing) existing.remove();
  if (!sub || !user) return;

  const isAdmin  = user.role === 'admin';
  const isAuthor = sub.user_id === user.id;
  const canAuthorDelete = isAuthor && sub.status === 'pending';
  if (!isAdmin && !canAuthorDelete) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'delete-submission-btn';
  btn.className = 'btn btn-danger btn-sm';
  btn.textContent = 'Delete Submission';
  btn.addEventListener('click', () => {
    deleteSubmission(sub.submission_id, {
      friendlyTitle: sub.title,
      // Pop the user back to whichever list makes sense for their role.
      redirectAfter: isAdmin ? 'admin.html' : 'submissions.html',
    });
  });
  topBarActions.insertBefore(btn, topBarActions.firstChild);
}

// Fetch a submission file as a blob via the authenticated API and return an
// object URL. Centralized so both the file list and the iframe preview reuse
// the same auth path.
async function fetchFileBlobUrl(submissionId, filename) {
  const res = await apiFetch(
    `/api/submissions/${encodeURIComponent(submissionId)}/files/${encodeURIComponent(filename)}`
  );
  if (!res || !res.ok) throw new Error('Failed to download file');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  __blobUrls.push(url);
  return url;
}

// Returns 'pdf' | 'image' | 'docx' | 'text' | 'unknown' for the given file
// metadata returned by /api/submissions/:id/files. Trusts mimetype first,
// falls back to the filename extension.
function classifyFile(file) {
  const mt = (file.mimetype || '').toLowerCase();
  const name = (file.original_name || file.filename || '').toLowerCase();
  if (mt === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (mt.startsWith('image/') ||
      name.endsWith('.png') || name.endsWith('.jpg') ||
      name.endsWith('.jpeg') || name.endsWith('.gif') ||
      name.endsWith('.webp')) return 'image';
  if (mt === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      name.endsWith('.docx')) return 'docx';
  if (mt.startsWith('text/') ||
      name.endsWith('.txt') || name.endsWith('.md')) return 'text';
  return 'unknown';
}

// Render a file into the preview body. Handles each format we know about and
// falls back to a friendly download prompt for the rest.
async function renderFilePreview(submissionId, file, previewBody) {
  if (!previewBody) return;
  const kind = classifyFile(file);
  previewBody.innerHTML =
    '<p class="text-muted" style="text-align:center;margin-top:2rem;">Loading preview\u2026</p>';

  try {
    if (kind === 'pdf') {
      const url = await fetchFileBlobUrl(submissionId, file.filename);
      previewBody.innerHTML =
        `<iframe src="${url}" title="${escapeHtml(file.original_name)}"
                 style="width:100%;height:100%;border:none;"></iframe>`;
      return;
    }

    if (kind === 'image') {
      const url = await fetchFileBlobUrl(submissionId, file.filename);
      const wrapper = document.createElement('div');
      wrapper.className = 'doc-preview-image';
      const img = document.createElement('img');
      img.src = url;
      img.alt = file.original_name || 'Image preview';
      wrapper.appendChild(img);
      previewBody.innerHTML = '';
      previewBody.appendChild(wrapper);
      return;
    }

    if (kind === 'docx') {
      if (typeof window.mammoth === 'undefined') {
        previewBody.innerHTML =
          '<p class="text-muted" style="text-align:center;margin-top:2rem;">' +
          'DOCX preview library failed to load. Use Download to view this file.</p>';
        return;
      }
      const res = await apiFetch(
        `/api/submissions/${encodeURIComponent(submissionId)}/files/${encodeURIComponent(file.filename)}`
      );
      if (!res || !res.ok) throw new Error('Failed to fetch file');
      const arrayBuffer = await res.arrayBuffer();
      const result = await window.mammoth.convertToHtml({ arrayBuffer });
      const wrapper = document.createElement('div');
      wrapper.className = 'doc-preview-docx';
      // mammoth's HTML output is sanitized — it only emits a small set of
      // semantic tags (p, h1..h6, ul, ol, li, table, img with data: URIs).
      wrapper.innerHTML = result.value ||
        '<p class="text-muted">This document appears to be empty.</p>';
      previewBody.innerHTML = '';
      previewBody.appendChild(wrapper);
      return;
    }

    if (kind === 'text') {
      const res = await apiFetch(
        `/api/submissions/${encodeURIComponent(submissionId)}/files/${encodeURIComponent(file.filename)}`
      );
      if (!res || !res.ok) throw new Error('Failed to fetch file');
      const text = await res.text();
      const wrapper = document.createElement('pre');
      wrapper.className = 'doc-preview-docx';
      wrapper.style.whiteSpace = 'pre-wrap';
      wrapper.textContent = text;
      previewBody.innerHTML = '';
      previewBody.appendChild(wrapper);
      return;
    }

    previewBody.innerHTML =
      '<p class="text-muted" style="text-align:center;margin-top:2rem;">' +
      'No in-browser preview is available for this file type. ' +
      'Use Download to view it.</p>';
  } catch (err) {
    console.error('Failed to render preview:', err);
    previewBody.innerHTML =
      '<p class="text-muted" style="text-align:center;margin-top:2rem;">Failed to load preview.</p>';
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

    filesBox.innerHTML = files.map((file, idx) => `
      <div class="file-item" style="margin-top:.25rem;">
        <span>&#128196;</span>
        <a class="file-name" href="#" data-file-idx="${idx}">${escapeHtml(file.original_name)}</a>
        <span class="file-size">${Math.round(file.size / 1024)} KB</span>
      </div>
    `).join('');

    // Track which file is currently displayed in the preview pane so the
    // top-bar Download button always grabs the right one.
    let activeFile = files[0];

    const setActiveFile = async (file) => {
      activeFile = file;
      if (previewName) previewName.textContent = file.original_name;
      await renderFilePreview(id, file, previewBody);
    };

    // Click a file name → swap it into the preview pane (instead of
    // immediately downloading). Holding Shift downloads, mirroring the old
    // behaviour for users who want a quick save.
    filesBox.querySelectorAll('a[data-file-idx]').forEach(link => {
      link.addEventListener('click', async (e) => {
        e.preventDefault();
        const file = files[parseInt(link.dataset.fileIdx, 10)];
        if (e.shiftKey) {
          try {
            const url = await fetchFileBlobUrl(id, file.filename);
            const a = document.createElement('a');
            a.href = url;
            a.download = file.original_name;
            document.body.appendChild(a);
            a.click();
            a.remove();
          } catch (err) {
            alert('Failed to download file');
          }
          return;
        }
        await setActiveFile(file);
      });
    });

    if (downloadBtn) {
      downloadBtn.onclick = async () => {
        try {
          const url = await fetchFileBlobUrl(id, activeFile.filename);
          const a = document.createElement('a');
          a.href = url;
          a.download = activeFile.original_name;
          document.body.appendChild(a);
          a.click();
          a.remove();
        } catch (err) {
          alert('Failed to download file');
        }
      };
    }

    await setActiveFile(files[0]);

  } catch (err) {
    console.error('Failed to load files:', err);
  }
}

// Send DELETE /api/submissions/:id, refresh the relevant view, and surface
// useful error messages (e.g. "submission already in review").
async function deleteSubmission(submissionId, opts = {}) {
  const { redirectAfter, friendlyTitle, skipConfirm } = opts;
  const label = friendlyTitle ? `"${friendlyTitle}"` : `#${submissionId}`;
  if (!skipConfirm) {
    const ok = confirm(
      `Delete submission ${label}?\n\n` +
      `This permanently removes the submission, every uploaded file, all reviews, ` +
      `assignments, and any discussion messages. This cannot be undone.`
    );
    if (!ok) return false;
  }

  try {
    const res = await apiFetch(`/api/submissions/${encodeURIComponent(submissionId)}`, {
      method: 'DELETE',
    });
    let body = {};
    try { body = await res.json(); } catch (e) { /* ignore */ }

    if (!res.ok) {
      alert(body.error || `Failed to delete submission (HTTP ${res.status})`);
      return false;
    }

    if (redirectAfter) {
      window.location.href = redirectAfter;
    } else {
      await loadMySubmissions();
    }
    return true;
  } catch (err) {
    console.error('Failed to delete submission:', err);
    alert('Failed to delete submission');
    return false;
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

  // Reset the working list each time the form initialises so re-navigating
  // doesn't carry over stale selections from a prior page load.
  selectedFiles = [];

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
      addFiles(e.dataTransfer.files);
    });

    fileInput.addEventListener('change', () => {
      addFiles(fileInput.files);
      // Allow re-selecting the same file after removal.
      fileInput.value = '';
    });
  }

  function addFiles(fileLike) {
    Array.from(fileLike).forEach(f => {
      // De-dupe by name+size so dragging the same file twice doesn't add it
      // a second time.
      const exists = selectedFiles.some(s => s.name === f.name && s.size === f.size);
      if (!exists) selectedFiles.push(f);
    });
    renderSelectedFiles();
  }

  function renderSelectedFiles() {
    if (!fileList) return;
    fileList.innerHTML = '';

    selectedFiles.forEach((file, idx) => {
      const div = document.createElement('div');
      div.className = 'file-item';
      const ext = (file.name.split('.').pop() || '').toUpperCase();

      div.innerHTML = `
        <span style="font-size:1.2rem;">&#128196;</span>
        <span class="file-name">${escapeHtml(file.name)}</span>
        <span class="file-size">${(file.size / 1024).toFixed(1)} KB</span>
        <span class="badge badge-info">${escapeHtml(ext)}</span>
        <button type="button" class="file-remove" data-idx="${idx}" aria-label="Remove file">&times;</button>
      `;

      fileList.appendChild(div);
    });

    fileList.querySelectorAll('.file-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.idx, 10);
        if (Number.isInteger(i)) {
          selectedFiles.splice(i, 1);
          renderSelectedFiles();
        }
      });
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

  // Wire decision buttons (data-decision="accepted|rejected|pending")
  document.querySelectorAll('[data-decision]').forEach(btn => {
    btn.addEventListener('click', () => setDecision(btn.getAttribute('data-decision')));
  });

  // Delegated handler for the per-row Delete button on My Submissions.
  // The table is re-rendered on every filter/sort, so we attach to the
  // tbody once and dispatch from there.
  document.getElementById('my-submissions-tbody')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action="delete-submission"]');
    if (!btn) return;
    const id = btn.getAttribute('data-submission-id');
    const title = btn.getAttribute('data-submission-title');
    if (id) deleteSubmission(id, { friendlyTitle: title });
  });
});

window.setDecision = setDecision;