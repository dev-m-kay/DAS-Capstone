// State
let myAssignments = [];   
let currentReview = null; 

// Helpers
const AVATAR_COLORS = [
  'var(--primary)', 'var(--success)', 'var(--danger)', '#7c3aed',
  'var(--warning)', '#0ea5e9', '#ec4899', '#14b8a6',
];

function getInitials(name) {
  if (!name) return '??';
  var parts = name.trim().split(/\s+/);
  var first = parts[0] ? parts[0][0] : '';
  var last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

function avatarColor(id) {
  return AVATAR_COLORS[id % AVATAR_COLORS.length];
}

function formatDate(iso) {
  if (!iso) return '\u2014';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getQueryId() {
  var params = new URLSearchParams(window.location.search);
  return params.get('id');
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function statusBadge(status) {
  var map = { pending: 'badge-pending', in_review: 'badge-review', accepted: 'badge-accepted', rejected: 'badge-rejected' };
  var label = { pending: 'Pending', in_review: 'In Review', accepted: 'Accepted', rejected: 'Rejected' };
  return '<span class="badge ' + (map[status] || 'badge-pending') + '">' + escapeHtml(label[status] || status) + '</span>';
}


// Review Queue page 
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

async function loadAssignments() {
  try {
    var res = await apiFetch('/api/reviews/queue');
    myAssignments = await res.json();
  } catch (err) {
    console.error('Failed to load assignments:', err);
    myAssignments = [];
  }
}

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


// Review Widget
function initReviewWidget() {
  // guard on #ratingStars
  if (!document.getElementById('ratingStars')) return;

  var user = getUser();
  var ratingCard = document.getElementById('rating-card');

  // Only reviewer / editor / admin can see the rating card
  if (ratingCard && user) {
    if (user.role !== 'reviewer' && user.role !== 'editor' && user.role !== 'admin') {
      ratingCard.style.display = 'none';
      return;
    }
  }

  var submissionId = getQueryId();
  if (!submissionId) return;

  // Load existing review
  loadExistingReview(submissionId);

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

      // Pre-fill stars
      setStarRating(myReview.rating);

      // Pre-fill comment
      var commentBox = document.getElementById('review-comment');
      if (commentBox) commentBox.value = myReview.comment || '';

      // Change button text
      var submitBtn = document.getElementById('submit-review-btn');
      if (submitBtn) submitBtn.textContent = 'Update Review';
    }
  } catch (err) {
    console.error('Failed to load existing review:', err);
  }
}

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

async function submitReview() {
  var submissionId = getQueryId();
  if (!submissionId) return;

  // Read selected rating from .star.filled count
  var rating = document.querySelectorAll('#ratingStars .star.filled').length;
  var commentBox = document.getElementById('review-comment');
  var comment = commentBox ? commentBox.value.trim() : '';
  var submitBtn = document.getElementById('submit-review-btn');

  // Validate rating >= 1
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

    // Re-call loadExistingReview to refresh state and button label
    loadExistingReview(submissionId);

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


// Globals are no longer needed for tab/filter wiring (CSP-friendly: handlers
// are attached via addEventListener). Kept for backwards compatibility only.
window.switchReviewTab = switchReviewTab;
window.submitReview = submitReview;
window.filterReviewCards = filterReviewCards;