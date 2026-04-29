
// State
let socket = null;               
let threads = [];                
let activeSubmissionId = null;   

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

function formatTimestamp(iso) {
  if (!iso) return '\u2014';
  var d = new Date(iso);
  var date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  var time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return date + ' \u2022 ' + time;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getQueryId() {
  var params = new URLSearchParams(window.location.search);
  return params.get('id') || params.get('submission');
}


// Socket.IO

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

function joinThread(submissionId) {
  var s = getSocket();
  if (s) s.emit('join_thread', String(submissionId));
}

function leaveThread(submissionId) {
  var s = getSocket();
  if (s) s.emit('leave_thread', String(submissionId));
}

function bindIncomingMessages(handler) {
  var s = getSocket();
  if (s) s.on('new_message', handler);
}


// Discussion Panel
function initDiscussionPanel() {
  var messageList = document.querySelector('.message-list');
  if (!messageList) return;

  var submissionId = getQueryId();
  if (!submissionId) return;

  activeSubmissionId = submissionId;

  // Load existing messages
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

  // Join Socket.IO thread
  joinThread(submissionId);

  // Bind incoming messages
  bindIncomingMessages(appendDiscussionMessage);
}

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
      var user = getUser();
      var isOwn = msg.sender_id === user.id;

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

    // Auto-scroll to bottom
    messageList.scrollTop = messageList.scrollHeight;
  } catch (err) {
    console.error('Failed to load discussion:', err);
  }
}

function appendDiscussionMessage(msg) {
  // Only append if msg is for the currently viewed submission
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

    // Clear input on success
    // The message will arrive back via the Socket.IO listener, no need to manually append
    msgInput.value = '';
  } catch (err) {
    console.error('Send message error:', err);
    alert('Failed to send message');
  }
}

// Threads Page (messages.html)

function initThreadsPage() {
  if (!document.getElementById('threads-list')) return;

  // Wire send button
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

  // Wire search input
  var searchInput = document.querySelector('.msg-threads-header input');
  if (searchInput) {
    searchInput.addEventListener('input', filterThreads);
  }

  // Load threads
  loadThreads().then(function() {
    var paramId = getQueryId();
    if (paramId) {
      selectThread(paramId);
    } else if (threads.length > 0) {
      // Auto-select first thread
      selectThread(threads[0].submission_id);
    }
  });

  // Bind incoming messages for real-time
  bindIncomingMessages(handleIncomingThreadMessage);
}

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
    var displayId = '#' + subId;
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

function selectThread(submissionId) {
  // If switching threads, leave the old one
  if (activeSubmissionId && String(activeSubmissionId) !== String(submissionId)) {
    leaveThread(activeSubmissionId);
  }

  activeSubmissionId = submissionId;

  // Toggle .active on the selected thread item
  document.querySelectorAll('.thread-item').forEach(function(item) {
    if (String(item.dataset.submissionId) === String(submissionId)) {
      item.classList.add('active');
      // Clear unread dot
      var dot = item.querySelector('.unread-dot');
      if (dot) dot.remove();
    } else {
      item.classList.remove('active');
    }
  });

  // Update title
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

  // Load conversation
  loadConversation(submissionId);

  // Join Socket.IO thread
  joinThread(submissionId);
}

async function loadConversation(submissionId) {
  var convBody = document.getElementById('conv-body');
  if (!convBody) return;

  try {
    var res = await apiFetch('/api/messages/' + submissionId);
    var messages = await res.json();
    var user = getUser();

    convBody.innerHTML = '';

    for (var i = 0; i < messages.length; i++) {
      appendChatBubble(messages[i]);
    }

    // Auto-scroll to bottom
    convBody.scrollTop = convBody.scrollHeight;
  } catch (err) {
    console.error('Failed to load conversation:', err);
  }
}

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

    // Clear input — message arrives via Socket.IO
    msgInput.value = '';
  } catch (err) {
    console.error('Send message error:', err);
    alert('Failed to send message');
  }
}

function handleIncomingThreadMessage(msg) {
  if (String(msg.submission_id) === String(activeSubmissionId)) {
    // Message is for the currently viewed thread — append it
    appendChatBubble(msg);
  } else {
    // Message is for a different thread
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


window.selectThread = selectThread;
window.sendThreadMessage = sendThreadMessage;
window.sendDiscussionMessage = sendDiscussionMessage;