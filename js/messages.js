/**
 * @file messages.js
 * @description Powers the discussion panel on the submission detail page
 * (submission-detail.html) and the full messages thread page (messages.html),
 * including the Socket.IO real-time client.
 * Uses the shared apiFetch(), getUser(), and getToken() helpers from app.js.
 * Page-specific code is guarded by container checks so it is safe to
 * include on multiple pages.
 */

// ---- State ----

/** @type {Object|null} Socket.IO connection instance, lazily initialized */
let socket = null;

/** @type {Array<Object>} Cached threads list for messages.html */
let threads = [];

/** @type {string|null} Currently viewed thread's submission ID */
let activeSubmissionId = null;

// ---- Helpers ----

/** @type {string[]} Color palette for avatar circles, matching reviews.js */
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
 * Format an ISO date string into "Feb 13, 2026 • 2:15 PM" style.
 * @param {string} iso - ISO 8601 date string
 * @returns {string} Formatted timestamp or em dash if input is falsy
 */
function formatTimestamp(iso) {
  if (!iso) return '\u2014';
  var d = new Date(iso);
  var date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  var time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return date + ' \u2022 ' + time;
}

/**
 * Escape HTML special characters to prevent XSS when inserting message bodies.
 * @param {string} str - Raw string to escape
 * @returns {string} HTML-safe string
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Read the ?id= or ?submission= query parameter from the current URL.
 * @returns {string|null} The submission ID from the URL, or null
 */
function getQueryId() {
  var params = new URLSearchParams(window.location.search);
  return params.get('id') || params.get('submission');
}

// ================================================================
//  SOCKET.IO SETUP
// ================================================================

/**
 * Lazily initialize and return the Socket.IO client connection.
 * Passes the user's JWT token for authentication. Logs connection
 * errors but does not throw — real-time features degrade gracefully.
 * @returns {Object|null} The Socket.IO socket instance, or null if io is unavailable
 */
function getSocket() {
  if (typeof window.io === 'undefined') return null;

  if (!socket) {
    try {
      socket = window.io({
        auth: { token: getToken() }
      });
      socket.on('connect_error', function(err) {
        console.error('Socket.IO connection error:', err.message);
      });
    } catch (err) {
      console.error('Socket.IO init failed:', err);
      return null;
    }
  }
  return socket;
}

/**
 * Join a Socket.IO room for a specific submission thread.
 * @param {string} submissionId - The submission ID to join
 */
function joinThread(submissionId) {
  var s = getSocket();
  if (s) s.emit('join_thread', String(submissionId));
}

/**
 * Leave a Socket.IO room for a specific submission thread.
 * @param {string} submissionId - The submission ID to leave
 */
function leaveThread(submissionId) {
  var s = getSocket();
  if (s) s.emit('leave_thread', String(submissionId));
}

/**
 * Bind a handler to the 'new_message' Socket.IO event. Should be
 * called once per page load.
 * @param {Function} handler - Callback receiving the new message object
 */
function bindIncomingMessages(handler) {
  var s = getSocket();
  if (s) s.on('new_message', handler);
}

// ================================================================
//  DISCUSSION PANEL (submission-detail.html)
// ================================================================

/**
 * Initialize the discussion panel on the submission detail page.
 * Guards on .message-list container. Loads existing messages, wires
 * the send button and Enter key, joins the Socket.IO thread, and
 * binds real-time incoming message handling.
 */
function initDiscussionPanel() {
  var messageList = document.querySelector('.message-list');
  if (!messageList) return;

  var submissionId = getQueryId();
  if (!submissionId) return;

  activeSubmissionId = submissionId;

  loadDiscussion(submissionId);

  var sendBtn = document.querySelector('.message-compose .btn');
  var msgInput = document.querySelector('.message-compose input');

  if (sendBtn) {
    sendBtn.addEventListener('click', sendDiscussionMessage);
  }
  if (msgInput) {
    msgInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') sendDiscussionMessage();
    });
  }

  joinThread(submissionId);
  bindIncomingMessages(appendDiscussionMessage);
}

/**
 * Fetch and render all messages for a submission into the .message-list container.
 * Each message displays the sender's avatar, name, timestamp, and body.
 * @async
 * @param {string} submissionId - The submission ID to load messages for
 */
async function loadDiscussion(submissionId) {
  var messageList = document.querySelector('.message-list');
  if (!messageList) return;

  try {
    var res = await apiFetch('/api/messages/' + submissionId);
    var messages = await res.json();

    messageList.innerHTML = '';

    for (var i = 0; i < messages.length; i++) {
      var msg = messages[i];
      var name = (msg.first_name || '') + ' ' + (msg.last_name || '');
      var initials = getInitials(name);

      var div = document.createElement('div');
      div.className = 'message-item';
      div.innerHTML =
        '<div class="msg-avatar" style="background:' + avatarColor(msg.sender_id) + ';">' + initials + '</div>' +
        '<div class="msg-content">' +
          '<div class="msg-header">' +
            '<span class="msg-author">' + escapeHtml(name.trim()) + '</span>' +
            '<span class="msg-time">' + formatTimestamp(msg.created_at) + '</span>' +
          '</div>' +
          '<div class="msg-body">' + escapeHtml(msg.body) + '</div>' +
        '</div>';
      messageList.appendChild(div);
    }

    messageList.scrollTop = messageList.scrollHeight;
  } catch (err) {
    console.error('Failed to load discussion:', err);
  }
}

/**
 * Append a single incoming message to the discussion panel.
 * Only appends if the message belongs to the currently active submission.
 * Auto-scrolls to the bottom after appending.
 * @param {Object} msg - The message object received via Socket.IO
 */
function appendDiscussionMessage(msg) {
  if (String(msg.submission_id) !== String(activeSubmissionId)) return;

  var messageList = document.querySelector('.message-list');
  if (!messageList) return;

  var name = (msg.first_name || '') + ' ' + (msg.last_name || '');
  var initials = getInitials(name);

  var div = document.createElement('div');
  div.className = 'message-item';
  div.innerHTML =
    '<div class="msg-avatar" style="background:' + avatarColor(msg.sender_id) + ';">' + initials + '</div>' +
    '<div class="msg-content">' +
      '<div class="msg-header">' +
        '<span class="msg-author">' + escapeHtml(name.trim()) + '</span>' +
        '<span class="msg-time">' + formatTimestamp(msg.created_at) + '</span>' +
      '</div>' +
      '<div class="msg-body">' + escapeHtml(msg.body) + '</div>' +
    '</div>';

  messageList.appendChild(div);
  messageList.scrollTop = messageList.scrollHeight;
}

/**
 * Send a message from the discussion panel on the submission detail page.
 * Reads input value, validates it's not empty, POSTs to the API, and
 * clears the input on success. The message arrives back via Socket.IO
 * so there is no need to manually append it.
 * @async
 */
async function sendDiscussionMessage() {
  var msgInput = document.querySelector('.message-compose input');
  if (!msgInput) return;

  var text = msgInput.value.trim();
  if (!text) return;

  try {
    var res = await apiFetch('/api/messages/' + activeSubmissionId, {
      method: 'POST',
      body: JSON.stringify({ body: text })
    });

    if (!res.ok) {
      var data = await res.json();
      alert(data.error || 'Failed to send message');
      return;
    }

    msgInput.value = '';
  } catch (err) {
    console.error('Send message error:', err);
    alert('Failed to send message');
  }
}

// ================================================================
//  THREADS PAGE (messages.html)
// ================================================================

/**
 * Initialize the full messages/threads page.
 * Guards on #threads-list container. Loads threads, auto-selects from
 * ?submission= URL param or defaults to first thread, wires search
 * input and send button, and binds Socket.IO for real-time updates.
 */
function initThreadsPage() {
  if (!document.getElementById('threads-list')) return;

  var sendBtn = document.querySelector('.msg-conv-footer .btn');
  if (sendBtn) {
    sendBtn.addEventListener('click', sendThreadMessage);
  }
  var msgInput = document.querySelector('.msg-conv-footer input');
  if (msgInput) {
    msgInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') sendThreadMessage();
    });
  }

  var searchInput = document.querySelector('.msg-threads-header input');
  if (searchInput) {
    searchInput.addEventListener('input', filterThreads);
  }

  loadThreads().then(function() {
    var paramId = getQueryId();
    if (paramId) {
      selectThread(paramId);
    } else if (threads.length > 0) {
      selectThread(threads[0].submission_id);
    }
  });

  bindIncomingMessages(handleIncomingThreadMessage);
}

/**
 * Fetch the user's message threads from GET /api/messages/threads.
 * Caches result in the threads module-level array and renders the thread list.
 * @async
 */
async function loadThreads() {
  try {
    var res = await apiFetch('/api/messages/threads');
    threads = await res.json();
    renderThreadList(threads);
  } catch (err) {
    console.error('Failed to load threads:', err);
    threads = [];
  }
}

/**
 * Render the thread list into the #threads-list container.
 * Each thread shows the sender's avatar, submission title, last message
 * preview, timestamp, and optional unread dot.
 * @param {Array<Object>} list - Array of thread objects to display
 */
function renderThreadList(list) {
  var container = document.getElementById('threads-list');
  if (!container) return;
  container.innerHTML = '';

  if (list.length === 0) {
    container.innerHTML = '<p class="text-muted" style="padding:1rem;text-align:center;">No conversations yet.</p>';
    return;
  }

  for (var i = 0; i < list.length; i++) {
    var thread = list[i];
    var name = (thread.first_name || '') + ' ' + (thread.last_name || '');
    var initials = getInitials(name);
    var subId = thread.submission_id;
    var displayId = thread.submission_id_display || '#' + subId;
    var title = displayId + ' \u2014 ' + (thread.title || 'Untitled');
    var preview = name.trim() + ': ' + (thread.body || '');
    var time = formatTimestamp(thread.created_at);

    var div = document.createElement('div');
    div.className = 'thread-item';
    div.dataset.submissionId = subId;

    if (String(subId) === String(activeSubmissionId)) {
      div.classList.add('active');
    }

    div.innerHTML =
      '<div class="thread-avatar" style="background:' + avatarColor(thread.sender_id || i) + ';">' + initials + '</div>' +
      '<div class="thread-info">' +
        '<div class="thread-title">' + escapeHtml(title) + '</div>' +
        '<div class="thread-preview">' + escapeHtml(preview) + '</div>' +
        '<div class="thread-meta">' +
          '<span class="thread-time">' + time + '</span>' +
        '</div>' +
      '</div>';

    div.addEventListener('click', (function(id) {
      return function() { selectThread(id); };
    })(subId));

    container.appendChild(div);
  }
}

/**
 * Select and display a thread's conversation.
 * Leaves the previous Socket.IO room, joins the new one, toggles
 * the active class on thread items, clears unread dots, updates the
 * conversation header and View Submission link, and loads the messages.
 * @param {string} submissionId - The submission ID of the thread to select
 */
function selectThread(submissionId) {
  if (activeSubmissionId && String(activeSubmissionId) !== String(submissionId)) {
    leaveThread(activeSubmissionId);
  }

  activeSubmissionId = submissionId;

  // Toggle .active on the selected thread item
  document.querySelectorAll('.thread-item').forEach(function(item) {
    if (String(item.dataset.submissionId) === String(submissionId)) {
      item.classList.add('active');
      var dot = item.querySelector('.unread-dot');
      if (dot) dot.remove();
    } else {
      item.classList.remove('active');
    }
  });

  // Update conversation header title
  var convHeader = document.querySelector('.msg-conv-header strong');
  if (convHeader) {
    var activeItem = document.querySelector('.thread-item.active .thread-title');
    if (activeItem) {
      convHeader.textContent = activeItem.textContent;
    }
  }

  // Set View Submission link
  var viewLink = document.querySelector('.msg-conv-header .btn');
  if (viewLink) {
    viewLink.setAttribute('href', 'submission-detail.html?id=' + submissionId);
  }

  loadConversation(submissionId);
  joinThread(submissionId);
}

/**
 * Fetch and render all messages for a submission into the #conv-body container.
 * Messages from the current user are marked with the .own class for
 * right-aligned styling. Auto-scrolls to bottom after rendering.
 * @async
 * @param {string} submissionId - The submission ID to load messages for
 */
async function loadConversation(submissionId) {
  var convBody = document.getElementById('conv-body');
  if (!convBody) return;

  try {
    var res = await apiFetch('/api/messages/' + submissionId);
    var messages = await res.json();

    convBody.innerHTML = '';

    for (var i = 0; i < messages.length; i++) {
      appendChatBubble(messages[i]);
    }

    convBody.scrollTop = convBody.scrollHeight;
  } catch (err) {
    console.error('Failed to load conversation:', err);
  }
}

/**
 * Append a single chat bubble to the #conv-body container.
 * Used by both loadConversation (initial render) and Socket.IO
 * incoming message events. Marks the current user's messages with
 * .own class for right-alignment and primary color styling.
 * @param {Object} msg - The message object to render
 */
function appendChatBubble(msg) {
  var convBody = document.getElementById('conv-body');
  if (!convBody) return;

  var user = getUser();
  var isOwn = msg.sender_id === user.id;
  var name = (msg.first_name || '') + ' ' + (msg.last_name || '');
  var initials = getInitials(name);

  var div = document.createElement('div');
  div.className = 'chat-msg' + (isOwn ? ' own' : '');
  div.innerHTML =
    '<div class="chat-avatar" style="background:' + avatarColor(msg.sender_id) + ';">' + initials + '</div>' +
    '<div>' +
      '<div class="chat-bubble">' + escapeHtml(msg.body) + '</div>' +
      '<div class="chat-time">' + formatTimestamp(msg.created_at) + '</div>' +
    '</div>';

  convBody.appendChild(div);
  convBody.scrollTop = convBody.scrollHeight;
}

/**
 * Send a message from the messages page conversation view.
 * Reads the footer input value, validates it's not empty, POSTs to
 * the API, and clears the input. The message arrives via Socket.IO.
 * @async
 */
async function sendThreadMessage() {
  var msgInput = document.querySelector('.msg-conv-footer input');
  if (!msgInput || !activeSubmissionId) return;

  var text = msgInput.value.trim();
  if (!text) return;

  try {
    var res = await apiFetch('/api/messages/' + activeSubmissionId, {
      method: 'POST',
      body: JSON.stringify({ body: text })
    });

    if (!res.ok) {
      var data = await res.json();
      alert(data.error || 'Failed to send message');
      return;
    }

    msgInput.value = '';
  } catch (err) {
    console.error('Send message error:', err);
    alert('Failed to send message');
  }
}

/**
 * Handle a real-time incoming message on the threads page.
 * If the message belongs to the currently viewed thread, appends the
 * chat bubble. Otherwise, adds an unread notification dot to the
 * thread item, updates its preview text and timestamp, and bumps
 * it to the top of the thread list.
 * @param {Object} msg - The message object received via Socket.IO
 */
function handleIncomingThreadMessage(msg) {
  if (String(msg.submission_id) === String(activeSubmissionId)) {
    appendChatBubble(msg);
  } else {
    var threadItem = document.querySelector('.thread-item[data-submission-id="' + msg.submission_id + '"]');
    if (threadItem) {
      // Add unread dot
      var meta = threadItem.querySelector('.thread-meta');
      if (meta && !meta.querySelector('.unread-dot')) {
        var dot = document.createElement('span');
        dot.className = 'unread-dot';
        meta.appendChild(dot);
      }

      // Update preview text
      var preview = threadItem.querySelector('.thread-preview');
      if (preview) {
        var senderName = (msg.first_name || '') + ' ' + (msg.last_name || '');
        preview.textContent = senderName.trim() + ': ' + (msg.body || '');
      }

      // Update timestamp
      var timeEl = threadItem.querySelector('.thread-time');
      if (timeEl) {
        timeEl.textContent = formatTimestamp(msg.created_at);
      }

      // Bump to top of list
      var container = document.getElementById('threads-list');
      if (container && container.firstChild !== threadItem) {
        container.insertBefore(threadItem, container.firstChild);
      }
    }
  }
}

/**
 * Filter the thread list client-side based on the search input value.
 * Matches against thread title, message body preview, and sender name.
 * Re-renders the thread list with matching results.
 */
function filterThreads() {
  var searchInput = document.querySelector('.msg-threads-header input');
  if (!searchInput) return;

  var query = searchInput.value.toLowerCase();

  if (!query) {
    renderThreadList(threads);
    return;
  }

  var filtered = threads.filter(function(thread) {
    var title = (thread.title || '').toLowerCase();
    var preview = (thread.body || '').toLowerCase();
    var name = ((thread.first_name || '') + ' ' + (thread.last_name || '')).toLowerCase();
    return title.indexOf(query) !== -1 || preview.indexOf(query) !== -1 || name.indexOf(query) !== -1;
  });

  renderThreadList(filtered);
}

// ================================================================
//  INIT
// ================================================================

document.addEventListener('DOMContentLoaded', function() {
  initThreadsPage();
  initDiscussionPanel();
});

// Globals exposed for inline onclick handlers.
window.selectThread = selectThread;
window.sendThreadMessage = sendThreadMessage;
window.sendDiscussionMessage = sendDiscussionMessage;