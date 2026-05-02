/**
 * @file reviews.js
 * @description Powers the review queue page (review-queue.html) and the
 * review rating widget on the submission detail page (submission-detail.html).
 * Uses the shared apiFetch() and getUser() helpers from app.js.
 * Page-specific code is guarded by container checks so it is safe to
 * include on multiple pages.
 */

// ---- State ----

/** @type {Array<Object>} Cached list of assigned submissions for the review queue page */
let myAssignments = [];

/** @type {Object|null} The current user's existing review on the detail page, if any */
let currentReview = null;

// ---- Helpers ----

/** @type {string[]} Color palette for avatar circles, matching admin.js */
const AVATAR_COLORS = [
  'var(--primary)', 'var(--success)', 'var(--danger)', '#7c3aed',
  'var(--warning)', '#0ea5e9', '#ec4899', '#14b8a6',
];

/**
 * Extract initials from a full name (first letter of first and last word).
 * @param {string} name - Full name string
 * @returns {string} Two-character uppercase initials, or '??' if name is falsy
 */
function getInitials(name) {
  if (!name) return '??';
  var parts = name.trim().split(/\s+/);
  var first = parts[0] ? parts[0][0] : '';
  var last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

/**
 * Pick a consistent avatar background color based on a numeric id.
 * @param {number} id - User or entity id
 * @returns {string} CSS color value from AVATAR_COLORS
 */
function avatarColor(id) {
  return AVATAR_COLORS[id % AVATAR_COLORS.length];
}

/**
 * Format an ISO date string into a short readable format (e.g. "Feb 13, 2026").
 * @param {string} iso - ISO 8601 date string
 * @returns {string} Formatted date or em dash if input is falsy
 */
function formatDate(iso) {
  if (!iso) return '\u2014';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Read the ?id= query parameter from the current URL.
 * @returns {string|null} The submission ID from the URL, or null
 */
function getQueryId() {
  var params = new URLSearchParams(window.location.search);
  return params.get('id');
}

/**
 * Escape HTML special characters to prevent XSS when inserting user content.
 * @param {string} str - Raw string to escape
 * @returns {string} HTML-safe string
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generate a status badge HTML string for a given submission status.
 * @param {string} status - One of: 'pending', 'in_review', 'accepted', 'rejected'
 * @returns {string} HTML span element with appropriate badge class and label
 */
function statusBadge(status) {
  var map = { pending: 'badge-pending', in_review: 'badge-review', accepted: 'badge-accepted', rejected: 'badge-rejected' };
  var label = { pending: 'Pending', in_review: 'In Review', accepted: 'Accepted', rejected: 'Rejected' };
  return '<span class="badge ' + (map[status] || 'badge-pending') + '">' + escapeHtml(label[status] || status) + '</span>';
}


// ================================================================
//  REVIEW QUEUE PAGE (review-queue.html)
// ================================================================

/**
 * Initialize the review queue page. Guards on #review-cards container.
 * Loads assignments from the API, renders stats and cards, and wires
 * search, genre filter, and tab button event listeners.
 */
function initReviewQueue() {
  if (!document.getElementById('review-cards')) return;

  loadAssignments().then(function() {
    renderReviewStats(myAssignments);
    renderReviewCards(myAssignments);
  });

  // wire search and genre filter
  var searchInput = document.querySelector('.search-input input');
  if (searchInput) {
    searchInput.addEventListener('input', filterReviewCards);
  }

  var genreSelect = document.getElementById('filter-genre');
  if (genreSelect) {
    genreSelect.addEventListener('change', filterReviewCards);
  }

  // Wire tab buttons (data-review-tab="awaiting|reviewed|all")
  document.querySelectorAll('[data-review-tab]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      switchReviewTab(btn, btn.getAttribute('data-review-tab'));
    });
  });
}

/**
 * Fetch the reviewer's assigned submissions from GET /api/reviews/queue.
 * Stores result in the myAssignments module-level array.
 * @async
 */
async function loadAssignments() {
  try {
    var res = await apiFetch('/api/reviews/queue');
    myAssignments = await res.json();
  } catch (err) {
    console.error('Failed to load assignments:', err);
    myAssignments = [];
  }
}

/**
 * Update the stat cards and tab labels with counts derived from the
 * assignments list (assigned, awaiting review, reviewed).
 * @param {Array<Object>} list - Array of assignment objects
 */
function renderReviewStats(list) {
  var assigned = list.length;
  var reviewed = 0;
  var awaiting = 0;

  for (var i = 0; i < list.length; i++) {
    if (list[i].rating) {
      reviewed++;
    } else {
      awaiting++;
    }
  }

  var statAssigned = document.getElementById('stat-assigned');
  var statAwaiting = document.getElementById('stat-awaiting');
  var statReviewed = document.getElementById('stat-reviewed');

  if (statAssigned) statAssigned.textContent = assigned;
  if (statAwaiting) statAwaiting.textContent = awaiting;
  if (statReviewed) statReviewed.textContent = reviewed;

  // Update tab counts
  var tabs = document.querySelectorAll('.tab');
  if (tabs.length >= 3) {
    tabs[0].textContent = 'Awaiting Review (' + awaiting + ')';
    tabs[1].textContent = 'Reviewed (' + reviewed + ')';
    tabs[2].textContent = 'All Assigned (' + assigned + ')';
  }
}

/**
 * Render submission cards into the #review-cards container.
 * Each card shows the submission ID, status badge, title, metadata,
 * hidden author line, and action buttons (Review Now / Discuss).
 * @param {Array<Object>} list - Filtered array of assignment objects to display
 */
function renderReviewCards(list) {
  var container = document.getElementById('review-cards');
  if (!container) return;
  container.innerHTML = '';

  if (list.length === 0) {
    container.innerHTML = '<p class="text-muted" style="text-align:center;padding:2rem;">No submissions found.</p>';
    return;
  }

  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    var hasReview = !!item.rating;
    var submissionId = item.submission_id || item.id;
    var subIdDisplay = '#' + escapeHtml(submissionId);

    // Determine status badge
    var badge = hasReview ? statusBadge(item.status || 'in_review') : '<span class="badge badge-pending">Awaiting Review</span>';

    // Author visibility: hidden until accepted/rejected
    var authorLine = 'Author: <em>Hidden</em> &#128274;';
    if (item.status === 'accepted' || item.status === 'rejected') {
      authorLine = 'Author: ' + escapeHtml(item.author_name || 'Unknown');
    }

    // Button text
    var btnText = hasReview ? 'Continue Review' : 'Review Now';

    // Word count display
    var metaParts = [];
    if (item.genre) metaParts.push(escapeHtml(item.genre));
    if (item.word_count) metaParts.push(escapeHtml(item.word_count.toLocaleString()) + ' words');
    if (item.created_at) metaParts.push('Submitted ' + formatDate(item.created_at));
    var metaLine = metaParts.join(' &bull; ');

    var card = document.createElement('div');
    card.className = 'card review-card';
    card.dataset.genre = (item.genre || '').toLowerCase();
    card.dataset.title = (item.title || '').toLowerCase();
    card.dataset.hasReview = hasReview ? 'true' : 'false';

    var hrefId = encodeURIComponent(submissionId);
    card.innerHTML =
      '<div class="card-body" style="display:flex;align-items:center;gap:1.5rem;flex-wrap:wrap;">' +
        '<div style="flex:1;min-width:200px;">' +
          '<div style="display:flex;align-items:center;gap:.75rem;margin-bottom:.25rem;">' +
            '<strong>' + subIdDisplay + '</strong>' +
            badge +
          '</div>' +
          '<h3 style="margin-bottom:.25rem;">' + escapeHtml(item.title || 'Untitled') + '</h3>' +
          '<div class="text-small text-muted">' + metaLine + '</div>' +
          '<div class="text-small text-muted" style="margin-top:.25rem;">' + authorLine + '</div>' +
        '</div>' +
        '<div class="btn-group">' +
          '<a href="submission-detail.html?id=' + hrefId + '" class="btn btn-primary btn-sm">' + btnText + '</a>' +
          '<a href="messages.html?submission=' + hrefId + '" class="btn btn-secondary btn-sm">&#9993; Discuss</a>' +
        '</div>' +
      '</div>';

    container.appendChild(card);
  }
}

/**
 * Switch the active review queue tab and re-render cards accordingly.
 * @param {HTMLElement} el - The clicked tab button element
 * @param {string} tab - One of: 'awaiting', 'reviewed', 'all'
 */
function switchReviewTab(el, tab) {
  // Toggle active class on tabs
  document.querySelectorAll('.tab').forEach(function(t) {
    t.classList.remove('active');
  });
  el.classList.add('active');

  // Filter myAssignments by tab
  var filtered;
  if (tab === 'awaiting') {
    filtered = myAssignments.filter(function(item) { return !item.rating; });
  } else if (tab === 'reviewed') {
    filtered = myAssignments.filter(function(item) { return !!item.rating; });
  } else {
    filtered = myAssignments;
  }

  renderReviewCards(filtered);
}

/**
 * Apply search input and genre filter on top of the currently active tab.
 * Reads the search text and genre select value, filters myAssignments,
 * and re-renders the cards.
 */
function filterReviewCards() {
  var searchInput = document.querySelector('.search-input input');
  var genreSelect = document.getElementById('filter-genre');

  var query = searchInput ? searchInput.value.toLowerCase() : '';
  var genre = genreSelect ? genreSelect.value : '';

  // Get the active tab
  var activeTab = document.querySelector('.tab.active');
  var tabText = activeTab ? activeTab.textContent.toLowerCase() : 'all';

  // Start with the right tab's data
  var filtered = myAssignments;
  if (tabText.indexOf('awaiting') !== -1) {
    filtered = filtered.filter(function(item) { return !item.rating; });
  } else if (tabText.indexOf('reviewed') !== -1) {
    filtered = filtered.filter(function(item) { return !!item.rating; });
  }

  // search filter
  if (query) {
    filtered = filtered.filter(function(item) {
      var title = (item.title || '').toLowerCase();
      var id = (item.submission_id_display || '').toLowerCase();
      return title.indexOf(query) !== -1 || id.indexOf(query) !== -1;
    });
  }

  // genre filter
  if (genre && genre !== 'All Genres') {
    filtered = filtered.filter(function(item) {
      return (item.genre || '').toLowerCase() === genre.toLowerCase();
    });
  }

  renderReviewCards(filtered);
}


// ================================================================
//  REVIEW WIDGET (submission-detail.html)
// ================================================================

/**
 * Initialize the star rating widget on the submission detail page.
 * Guards on #ratingStars. Hides the rating card if the user's role is not
 * reviewer, editor, or admin. Loads existing review data and wires
 * star click and submit button event listeners.
 */
function initReviewWidget() {
  if (!document.getElementById('ratingStars')) return;

  var user = getUser();
  var ratingCard = document.getElementById('rating-card');

  // Only reviewer / editor / admin can see the rating card
  if (ratingCard && user) {
    if (user.role !== 'reviewer' && user.role !== 'editor' && user.role !== 'admin') {
      ratingCard.style.display = 'none';
    }
  }

  var submissionId = getQueryId();
  if (!submissionId) return;

  // Admin / editor: show every reviewer's feedback for this submission.
  if (user && (user.role === 'admin' || user.role === 'editor')) {
    loadReviewerFeedback(submissionId);
  }

  // For everyone allowed to leave a review, prefill the rating card if they
  // have already done so.
  if (user && (user.role === 'reviewer' || user.role === 'editor' || user.role === 'admin')) {
    loadExistingReview(submissionId);
  } else {
    return;
  }

  // Wire star clicks
  var stars = document.querySelectorAll('#ratingStars .star');
  stars.forEach(function(star, i) {
    star.addEventListener('click', function() {
      setStarRating(i + 1);
    });
    star.addEventListener('mouseenter', function() {
      stars.forEach(function(s, j) {
        s.style.color = j <= i ? 'var(--accent)' : '';
      });
    });
  });

  var ratingContainer = document.getElementById('ratingStars');
  if (ratingContainer) {
    ratingContainer.addEventListener('mouseleave', function() {
      stars.forEach(function(s) { s.style.color = ''; });
    });
  }

  // Wire Submit Review button
  var submitBtn = document.getElementById('submit-review-btn');
  if (submitBtn) {
    submitBtn.addEventListener('click', function() {
      submitReview();
    });
  }
}

/**
 * Load and render all reviewer feedback for a submission (admin/editor only).
 * Displays average rating and individual reviewer entries in the #reviews-card.
 * @async
 * @param {string} submissionId - The submission ID to load feedback for
 */
async function loadReviewerFeedback(submissionId) {
  var card = document.getElementById('reviews-card');
  var listEl = document.getElementById('reviews-list');
  var summaryEl = document.getElementById('reviews-summary');
  if (!card || !listEl) return;

  card.style.display = '';

  try {
    var res = await apiFetch('/api/reviews/' + encodeURIComponent(submissionId));
    if (!res.ok) {
      var data = await res.json().catch(function() { return {}; });
      listEl.innerHTML =
        '<p class="text-muted" style="font-size:.85rem;">' +
          escapeHtml(data.error || 'Could not load reviews.') +
        '</p>';
      return;
    }
    var reviews = await res.json();

    if (!reviews.length) {
      if (summaryEl) summaryEl.style.display = 'none';
      listEl.innerHTML =
        '<p class="text-muted" style="font-size:.85rem;">No reviews submitted yet.</p>';
      return;
    }

    // Average rating block
    var sum = 0;
    for (var i = 0; i < reviews.length; i++) sum += Number(reviews[i].rating) || 0;
    var avg = sum / reviews.length;
    var avgRounded = Math.round(avg * 10) / 10;

    if (summaryEl) {
      summaryEl.style.display = '';
      summaryEl.innerHTML =
        '<span class="avg">' + avgRounded.toFixed(1) + '</span>' +
        '<span class="avg-stars" aria-hidden="true">' + renderStars(avg) + '</span>' +
        '<span class="avg-meta">' + reviews.length + ' review' + (reviews.length === 1 ? '' : 's') + '</span>';
    }

    listEl.innerHTML = reviews.map(function(r) {
      var name = ((r.first_name || '') + ' ' + (r.last_name || '')).trim() || 'Unknown reviewer';
      var role = r.role ? ' <span class="role-badge">' + escapeHtml(r.role) + '</span>' : '';
      var commentHtml = r.comment && r.comment.trim()
        ? '<div class="review-entry-comment">' + escapeHtml(r.comment) + '</div>'
        : '<div class="review-entry-comment muted">No comment.</div>';
      return (
        '<div class="review-entry">' +
          '<div class="review-entry-head">' +
            '<div>' +
              '<span class="review-entry-name">' + escapeHtml(name) + role + '</span>' +
              '<div class="review-entry-time">' + formatDate(r.created_at) + '</div>' +
            '</div>' +
            '<span class="review-entry-stars" aria-label="Rating ' + Number(r.rating) + ' of 5">' +
              renderStars(Number(r.rating) || 0) +
            '</span>' +
          '</div>' +
          commentHtml +
        '</div>'
      );
    }).join('');
  } catch (err) {
    console.error('Failed to load reviewer feedback:', err);
    listEl.innerHTML =
      '<p class="text-muted" style="font-size:.85rem;">Could not load reviews.</p>';
  }
}

/**
 * Render a 5-star line where n may be fractional.
 * Uses filled star (★), empty star (☆), and half indicator (½).
 * @param {number} n - Rating value (0-5, may be fractional)
 * @returns {string} String of star characters representing the rating
 */
function renderStars(n) {
  var rounded = Math.round((Number(n) || 0) * 2) / 2;
  var full = Math.floor(rounded);
  var half = rounded - full >= 0.5 ? 1 : 0;
  var empty = 5 - full - half;
  var s = '';
  for (var i = 0; i < full; i++) s += '\u2605';
  if (half) s += '\u00BD';
  for (var j = 0; j < empty; j++) s += '\u2606';
  return s;
}

/**
 * Load the current user's existing review for a submission, if one exists.
 * Pre-fills the star rating, comment textarea, and changes the submit button
 * text to "Update Review".
 * @async
 * @param {string} submissionId - The submission ID to check for an existing review
 */
async function loadExistingReview(submissionId) {
  try {
    var res = await apiFetch('/api/reviews/' + submissionId);
    var reviews = await res.json();
    var user = getUser();

    // Find this user's review
    var myReview = null;
    for (var i = 0; i < reviews.length; i++) {
      if (reviews[i].reviewer_id === user.id) {
        myReview = reviews[i];
        break;
      }
    }

    if (myReview) {
      currentReview = myReview;
      setStarRating(myReview.rating);

      var commentBox = document.getElementById('review-comment');
      if (commentBox) commentBox.value = myReview.comment || '';

      var submitBtn = document.getElementById('submit-review-btn');
      if (submitBtn) submitBtn.textContent = 'Update Review';
    }
  } catch (err) {
    console.error('Failed to load existing review:', err);
  }
}

/**
 * Toggle the .filled class on the first n stars in the #ratingStars container.
 * @param {number} n - Number of stars to fill (1-5)
 */
function setStarRating(n) {
  var stars = document.querySelectorAll('#ratingStars .star');
  stars.forEach(function(s, j) {
    if (j < n) {
      s.classList.add('filled');
    } else {
      s.classList.remove('filled');
    }
  });
}

/**
 * Submit or update a review. Reads the selected star rating and comment text,
 * validates that at least 1 star is selected, then either POSTs a new review
 * or PUTs an update to an existing one. Handles 409 duplicate errors.
 * On success, reloads the existing review to refresh state and button label.
 * @async
 */
async function submitReview() {
  var submissionId = getQueryId();
  if (!submissionId) return;

  var rating = document.querySelectorAll('#ratingStars .star.filled').length;
  var commentBox = document.getElementById('review-comment');
  var comment = commentBox ? commentBox.value.trim() : '';
  var submitBtn = document.getElementById('submit-review-btn');

  if (rating < 1) {
    alert('Please select a star rating.');
    return;
  }

  submitBtn.disabled = true;

  try {
    var res;

    if (currentReview) {
      // Update existing review (PUT /api/reviews/:id)
      res = await apiFetch('/api/reviews/' + currentReview.id, {
        method: 'PUT',
        body: JSON.stringify({ rating: rating, comment: comment })
      });
    } else {
      // Create new review
      res = await apiFetch('/api/reviews/' + submissionId, {
        method: 'POST',
        body: JSON.stringify({ rating: rating, comment: comment })
      });
    }

    if (res.status === 409) {
      alert('You have already reviewed this submission');
      return;
    }

    if (!res.ok) {
      var data = await res.json();
      alert(data.error || 'Failed to submit review');
      return;
    }

    alert(currentReview ? 'Review updated!' : 'Review submitted!');

    loadExistingReview(submissionId);

    // Refresh the reviewer feedback card if visible
    var feedbackCard = document.getElementById('reviews-card');
    if (feedbackCard && feedbackCard.style.display !== 'none') {
      loadReviewerFeedback(submissionId);
    }

  } catch (err) {
    console.error('Review submit error:', err);
    alert('Failed to submit review');
  } finally {
    submitBtn.disabled = false;
  }
}

// ================================================================
//  INIT
// ================================================================

document.addEventListener('DOMContentLoaded', function() {
  initReviewQueue();
  initReviewWidget();
});

// Globals exposed for backwards compatibility with inline onclick handlers.
window.switchReviewTab = switchReviewTab;
window.submitReview = submitReview;
window.filterReviewCards = filterReviewCards;