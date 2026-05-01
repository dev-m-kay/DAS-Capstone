/**
 * Messages UI — handles three thread kinds in one place:
 *
 *   submission  : per-submission discussion (key = "KCR-XXXX")
 *   staff       : the shared Staff Lounge   (key = "staff")
 *   dm          : 1-on-1 direct message     (key = "dm:<peerId>" or
 *                                                  "dm:<aId>:<bId>" for admin)
 *
 * The whole module runs inside an IIFE so its top-level identifiers (like
 * AVATAR_COLORS) don't collide with the same names declared in reviews.js
 * when both files are loaded on submission-detail.html.
 */
(function () {
  'use strict';

  // ---------- State ---------------------------------------------------------

  let socket = null;
  let threads = [];

  /** @type {{ kind: string, key: string, peerId?: number|null } | null} */
  let activeThread = null;

  // Submission-detail page tracks just the submission_id directly.
  let activeSubmissionId = null;

  // ---------- Helpers -------------------------------------------------------

  const AVATAR_COLORS = [
    'var(--primary)', 'var(--success)', 'var(--danger)', '#7c3aed',
    'var(--warning)', '#0ea5e9', '#ec4899', '#14b8a6',
  ];

  function getInitials(name) {
    if (!name) return '??';
    const parts = String(name).trim().split(/\s+/);
    const first = parts[0] ? parts[0][0] : '';
    const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (first + last).toUpperCase();
  }

  function avatarColor(id) {
    return AVATAR_COLORS[(Number(id) || 0) % AVATAR_COLORS.length];
  }

  function formatTimestamp(iso) {
    if (!iso) return '\u2014';
    const d = new Date(iso);
    const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return date + ' \u2022 ' + time;
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function roleLabel(role) {
    if (!role) return '';
    return role.charAt(0).toUpperCase() + role.slice(1);
  }

  // ---------- Socket.IO -----------------------------------------------------

  function getSocket() {
    if (typeof window.io === 'undefined') return null;
    if (!socket) {
      try {
        socket = window.io({ auth: { token: getToken() } });
        socket.on('connect_error', function (err) {
          console.error('Socket.IO connection error:', err.message);
        });
      } catch (err) {
        console.error('Socket.IO init failed:', err);
        return null;
      }
    }
    return socket;
  }

  function joinSubmissionThread(submissionId) {
    const s = getSocket();
    if (s) s.emit('join_thread', String(submissionId));
  }

  function leaveSubmissionThread(submissionId) {
    const s = getSocket();
    if (s) s.emit('leave_thread', String(submissionId));
  }

  function joinDm(peerId) {
    const s = getSocket();
    if (s) s.emit('join_dm', Number(peerId));
  }

  function joinDmPair(a, b) {
    const s = getSocket();
    if (s) s.emit('join_dm_pair', Number(a), Number(b));
  }

  function bindIncomingMessages(handler) {
    const s = getSocket();
    if (s) s.on('new_message', handler);
  }

  // ---------- Submission-detail page Discussion Panel -----------------------
  //
  // The submission-detail page only shows a *preview* of the discussion. The
  // whole card behaves like a link to messages.html?id=<submissionId>, where
  // the actual chat lives. Composing happens there, never in this preview.

  function initDiscussionPanel() {
    const messageList = document.querySelector('.message-list');
    if (!messageList) return;

    const submissionId = getQueryParam('id') || getQueryParam('submission');
    if (!submissionId) return;

    // The submission discussion is a staff-only thread (admin / editor /
    // assigned reviewer). The submitting author must not see it on their
    // own submission detail page.
    const me = (typeof getUser === 'function') ? getUser() : null;
    const card = document.getElementById('discussion-card');
    if (!me || me.role === 'submitter') {
      if (card) card.style.display = 'none';
      return;
    }

    activeSubmissionId = submissionId;

    loadDiscussion(submissionId);

    if (card) {
      const goToMessages = function () {
        window.location.href = 'messages.html?id=' + encodeURIComponent(submissionId);
      };
      card.addEventListener('click', goToMessages);
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          goToMessages();
        }
      });
    }

    joinSubmissionThread(submissionId);
    bindIncomingMessages(appendDiscussionMessage);
  }

  async function loadDiscussion(submissionId) {
    const messageList = document.querySelector('.message-list');
    if (!messageList) return;
    const countEl = document.getElementById('discussion-count');
    try {
      const res = await apiFetch('/api/messages/' + encodeURIComponent(submissionId));
      const messages = await res.json();
      messageList.innerHTML = '';
      if (!Array.isArray(messages) || !messages.length) {
        messageList.innerHTML =
          '<p class="text-muted" style="padding:.5rem 0;font-size:.85rem;">' +
          'No messages yet \u2014 be the first to start the conversation.</p>';
        if (countEl) countEl.textContent = '';
        return;
      }
      // Show only the last few messages as a preview; the full thread lives
      // on messages.html.
      const tail = messages.slice(-3);
      for (const msg of tail) appendDiscussionRow(messageList, msg);
      messageList.scrollTop = messageList.scrollHeight;
      if (countEl) {
        countEl.textContent = messages.length === 1
          ? '1 message'
          : messages.length + ' messages';
      }
    } catch (err) {
      console.error('Failed to load discussion:', err);
      messageList.innerHTML =
        '<p class="text-muted" style="padding:.75rem;">Could not load messages.</p>';
    }
  }

  function appendDiscussionRow(container, msg) {
    const name = ((msg.first_name || '') + ' ' + (msg.last_name || '')).trim();
    const initials = getInitials(name || '??');
    const div = document.createElement('div');
    div.className = 'message-item';
    div.innerHTML =
      '<div class="msg-avatar" style="background:' + avatarColor(msg.sender_id) + ';">' + escapeHtml(initials) + '</div>' +
      '<div class="msg-content">' +
        '<div class="msg-header">' +
          '<span class="msg-author">' + escapeHtml(name || 'Unknown') + '</span>' +
          '<span class="msg-time">' + formatTimestamp(msg.created_at) + '</span>' +
        '</div>' +
        '<div class="msg-body">' + escapeHtml(msg.body) + '</div>' +
      '</div>';
    container.appendChild(div);
  }

  function appendDiscussionMessage(msg) {
    // Only handle submission-thread broadcasts here.
    if (msg.kind && msg.kind !== 'submission') return;
    if (String(msg.submission_id) !== String(activeSubmissionId)) return;
    const messageList = document.querySelector('.message-list');
    if (!messageList) return;
    appendDiscussionRow(messageList, msg);
    messageList.scrollTop = messageList.scrollHeight;
  }

  // ---------- Threads page (messages.html) ----------------------------------

  function initThreadsPage() {
    const threadsListEl = document.getElementById('threads-list');
    if (!threadsListEl) return;

    const sendBtn = document.querySelector('.msg-conv-footer .btn');
    if (sendBtn) sendBtn.addEventListener('click', sendActiveThreadMessage);

    const msgInput = document.querySelector('.msg-conv-footer input');
    if (msgInput) {
      msgInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') sendActiveThreadMessage();
      });
    }

    const searchInput = document.querySelector('.msg-threads-header input');
    if (searchInput) searchInput.addEventListener('input', filterThreads);

    const newDmBtn = document.getElementById('new-dm-btn');
    if (newDmBtn) newDmBtn.addEventListener('click', openNewDmPicker);

    // Modal close ([data-action="close-modal"]) is wired generically in app.js.

    bindIncomingMessages(handleIncomingMessage);

    loadThreads().then(function () {
      // Optional auto-select via ?thread=staff or ?dm=<peerId> or ?id=KCR-XXXX
      const dmParam = getQueryParam('dm');
      const threadParam = getQueryParam('thread');
      const idParam = getQueryParam('id');

      if (dmParam) {
        selectThread({ kind: 'dm', key: 'dm:' + dmParam, peerId: Number(dmParam) });
      } else if (threadParam === 'staff') {
        selectThread({ kind: 'staff', key: 'staff' });
      } else if (idParam) {
        selectThread({ kind: 'submission', key: idParam });
      } else if (threads.length > 0) {
        const t = threads[0];
        selectThread({ kind: t.kind, key: t.key });
      } else {
        showEmptyConversation('Select a conversation to start messaging.');
      }
    });
  }

  async function loadThreads() {
    try {
      const res = await apiFetch('/api/messages/threads');
      threads = await res.json();
      renderThreadList(threads);
    } catch (err) {
      console.error('Failed to load threads:', err);
      threads = [];
      const container = document.getElementById('threads-list');
      if (container) {
        container.innerHTML =
          '<p class="text-muted" style="padding:1rem;text-align:center;">Could not load conversations.</p>';
      }
    }
  }

  function threadIcon(t) {
    if (t.kind === 'staff') return '\uD83D\uDCAC'; // 💬
    if (t.kind === 'dm') return '\uD83D\uDC64';     // 👤
    return '\uD83D\uDCDD';                          // 📝 (submission)
  }

  function renderThreadList(list) {
    const container = document.getElementById('threads-list');
    if (!container) return;
    container.innerHTML = '';

    if (!list.length) {
      container.innerHTML =
        '<p class="text-muted" style="padding:1rem;text-align:center;">No conversations yet.</p>';
      return;
    }

    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      const sender = t.sender || {};
      const senderName = ((sender.first_name || '') + ' ' + (sender.last_name || '')).trim();
      const initials = getInitials(t.kind === 'submission' ? '#' + t.key : (senderName || t.title || '??'));
      const preview = t.kind === 'staff' && !t.created_at
        ? t.body
        : (senderName ? senderName + ': ' : '') + (t.body || '');
      const time = t.created_at ? formatTimestamp(t.created_at) : '';
      const isActive = activeThread && activeThread.kind === t.kind && activeThread.key === t.key;

      const div = document.createElement('div');
      div.className = 'thread-item' + (isActive ? ' active' : '') + (t.pinned ? ' pinned' : '');
      div.dataset.threadKind = t.kind;
      div.dataset.threadKey = t.key;

      const avatarStyle = t.kind === 'staff'
        ? 'background:var(--primary);'
        : 'background:' + avatarColor(sender.id || i) + ';';

      div.innerHTML =
        '<div class="thread-avatar" style="' + avatarStyle + '">' + escapeHtml(initials) + '</div>' +
        '<div class="thread-info">' +
          '<div class="thread-title">' +
            '<span class="thread-icon" aria-hidden="true">' + threadIcon(t) + '</span> ' +
            escapeHtml(t.title || '(untitled)') +
          '</div>' +
          '<div class="thread-preview">' + escapeHtml(preview || t.subtitle || '') + '</div>' +
          '<div class="thread-meta">' +
            '<span class="thread-time">' + escapeHtml(time) + '</span>' +
          '</div>' +
        '</div>';

      div.addEventListener('click', (function (kind, key) {
        return function () {
          const ref = { kind, key };
          if (kind === 'dm') {
            // Personal DM threads encode the peer as the second segment.
            const parts = String(key).split(':');
            if (parts.length === 2) ref.peerId = Number(parts[1]);
          }
          selectThread(ref);
        };
      })(t.kind, t.key));

      container.appendChild(div);
    }
  }

  function showEmptyConversation(message) {
    const convBody = document.getElementById('conv-body');
    const convTitle = document.getElementById('conv-title');
    const convSubtitle = document.getElementById('conv-subtitle');
    const convLink = document.getElementById('conv-view-link');
    const composer = document.querySelector('.msg-conv-footer');

    if (convBody) {
      convBody.innerHTML =
        '<p class="text-muted" style="text-align:center;padding:2rem;">' + escapeHtml(message) + '</p>';
    }
    if (convTitle) convTitle.textContent = 'No conversation selected';
    if (convSubtitle) convSubtitle.textContent = '';
    if (convLink) {
      convLink.style.display = 'none';
      convLink.removeAttribute('href');
    }
    if (composer) composer.style.display = 'none';
  }

  function showConversationHeader(title, subtitle, viewHref) {
    const convTitle = document.getElementById('conv-title');
    const convSubtitle = document.getElementById('conv-subtitle');
    const convLink = document.getElementById('conv-view-link');
    const composer = document.querySelector('.msg-conv-footer');

    if (convTitle) convTitle.textContent = title;
    if (convSubtitle) convSubtitle.textContent = subtitle || '';
    if (convLink) {
      if (viewHref) {
        convLink.style.display = '';
        convLink.setAttribute('href', viewHref);
      } else {
        convLink.style.display = 'none';
        convLink.removeAttribute('href');
      }
    }
    if (composer) composer.style.display = '';
  }

  function selectThread(ref) {
    if (!ref || !ref.kind) return;

    // Highlight in the list
    document.querySelectorAll('.thread-item').forEach(function (item) {
      const match = item.dataset.threadKind === ref.kind && item.dataset.threadKey === ref.key;
      item.classList.toggle('active', match);
      if (match) {
        const dot = item.querySelector('.unread-dot');
        if (dot) dot.remove();
      }
    });

    activeThread = ref;

    if (ref.kind === 'submission') {
      const found = threads.find(function (t) { return t.kind === 'submission' && t.key === ref.key; });
      const title = found ? found.title : '#' + ref.key;
      showConversationHeader(title, 'Submission discussion', 'submission-detail.html?id=' + encodeURIComponent(ref.key));
      joinSubmissionThread(ref.key);
      loadConversationMessages('submission', ref);
    } else if (ref.kind === 'staff') {
      showConversationHeader('Staff Lounge', 'Editors, reviewers & admins', null);
      // Staff Lounge auto-joined server-side on connect — no explicit join.
      loadConversationMessages('staff', ref);
    } else if (ref.kind === 'dm') {
      // DM key shapes: "dm:<peerId>" (own conversation) or "dm:<a>:<b>" (admin moderation).
      const parts = String(ref.key).split(':');
      if (parts.length === 3) {
        const a = Number(parts[1]);
        const b = Number(parts[2]);
        const found = threads.find(function (t) { return t.kind === 'dm' && t.key === ref.key; });
        showConversationHeader(found ? found.title : 'Direct message', 'Direct message (admin view)', null);
        joinDmPair(a, b);
        loadConversationMessages('dm-pair', { a: a, b: b });
      } else {
        const peerId = ref.peerId || Number(parts[1]);
        if (!peerId) return;
        const found = threads.find(function (t) { return t.kind === 'dm' && t.key === ref.key; });
        showConversationHeader(found ? found.title : 'Direct message', 'Direct message', null);
        joinDm(peerId);
        loadConversationMessages('dm', { peerId: peerId });
      }
    }
  }

  async function loadConversationMessages(mode, ctx) {
    const convBody = document.getElementById('conv-body');
    if (!convBody) return;

    convBody.innerHTML = '<p class="text-muted" style="text-align:center;padding:1rem;">Loading messages…</p>';

    try {
      let url;
      if (mode === 'submission') url = '/api/messages/' + encodeURIComponent(ctx.key);
      else if (mode === 'staff') url = '/api/messages/staff';
      else if (mode === 'dm') url = '/api/messages/dm/' + ctx.peerId;
      else if (mode === 'dm-pair') url = '/api/messages/dm-pair/' + ctx.a + '/' + ctx.b;
      else return;

      const res = await apiFetch(url);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        convBody.innerHTML =
          '<p class="text-muted" style="text-align:center;padding:1rem;">' +
          escapeHtml(data.error || 'Could not load messages.') + '</p>';
        return;
      }

      const messages = await res.json();
      convBody.innerHTML = '';
      for (const m of messages) appendChatBubble(m);
      convBody.scrollTop = convBody.scrollHeight;
    } catch (err) {
      console.error('Failed to load conversation:', err);
      convBody.innerHTML =
        '<p class="text-muted" style="text-align:center;padding:1rem;">Could not load messages.</p>';
    }
  }

  function appendChatBubble(msg) {
    const convBody = document.getElementById('conv-body');
    if (!convBody) return;

    const me = (typeof getUser === 'function') ? getUser() : null;
    const isOwn = me && msg.sender_id === me.id;
    const name = ((msg.first_name || '') + ' ' + (msg.last_name || '')).trim() || 'Unknown';
    const initials = getInitials(name);
    const role = msg.role ? roleLabel(msg.role) : '';

    const div = document.createElement('div');
    div.className = 'chat-msg' + (isOwn ? ' own' : '');
    div.innerHTML =
      '<div class="chat-avatar" style="background:' + avatarColor(msg.sender_id) + ';">' + escapeHtml(initials) + '</div>' +
      '<div>' +
        '<div class="chat-author">' +
          escapeHtml(name) +
          (role ? ' <span class="chat-role">' + escapeHtml(role) + '</span>' : '') +
        '</div>' +
        '<div class="chat-bubble">' + escapeHtml(msg.body) + '</div>' +
        '<div class="chat-time">' + formatTimestamp(msg.created_at) + '</div>' +
      '</div>';

    convBody.appendChild(div);
    convBody.scrollTop = convBody.scrollHeight;
  }

  async function sendActiveThreadMessage() {
    const msgInput = document.querySelector('.msg-conv-footer input');
    if (!msgInput || !activeThread) return;
    const text = msgInput.value.trim();
    if (!text) return;

    let url;
    if (activeThread.kind === 'submission') {
      url = '/api/messages/' + encodeURIComponent(activeThread.key);
    } else if (activeThread.kind === 'staff') {
      url = '/api/messages/staff';
    } else if (activeThread.kind === 'dm') {
      // Sending into an admin-moderation DM (3-segment key) is not supported —
      // admins can only watch other people's conversations.
      const parts = String(activeThread.key).split(':');
      if (parts.length === 3) {
        alert('Read-only view: admins can\'t send messages on someone else\'s behalf.');
        return;
      }
      const peerId = activeThread.peerId || Number(parts[1]);
      if (!peerId) return;
      url = '/api/messages/dm/' + peerId;
    } else {
      return;
    }

    try {
      const res = await apiFetch(url, {
        method: 'POST',
        body: JSON.stringify({ body: text }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Failed to send message');
        return;
      }
      msgInput.value = '';
    } catch (err) {
      console.error('Send message error:', err);
      alert('Failed to send message');
    }
  }

  // Reconcile a real-time `new_message` event against the threads list & open
  // conversation. Each kind has its own matching rule.
  function handleIncomingMessage(msg) {
    if (!msg) return;

    let threadKey = null;
    let threadKind = msg.kind || null;

    if (msg.kind === 'staff') {
      threadKey = 'staff';
    } else if (msg.kind === 'dm') {
      // For admins watching arbitrary DMs, the relevant key is the pair.
      const me = (typeof getUser === 'function') ? getUser() : null;
      if (me && me.role === 'admin' && msg.sender_id !== me.id && msg.peer_id !== me.id) {
        const lo = Math.min(Number(msg.sender_id), Number(msg.peer_id));
        const hi = Math.max(Number(msg.sender_id), Number(msg.peer_id));
        threadKey = 'dm:' + lo + ':' + hi;
      } else {
        // For one of the two participants, the DM thread key is keyed by the OTHER user.
        const meId = me ? me.id : null;
        const peerId = msg.sender_id === meId ? msg.peer_id : msg.sender_id;
        threadKey = 'dm:' + peerId;
      }
    } else {
      // Submission discussion (current contract: msg.submission_id is the text code).
      threadKey = msg.submission_id;
      threadKind = 'submission';
    }

    const isActive = activeThread && activeThread.kind === threadKind && activeThread.key === threadKey;
    if (isActive) {
      appendChatBubble(msg);
    }

    bumpThread(threadKind, threadKey, msg, !isActive);
  }

  function bumpThread(kind, key, msg, markUnread) {
    if (!kind || !key) return;
    let found = threads.find(function (t) { return t.kind === kind && t.key === key; });

    if (!found) {
      // Not in our cache — refetch the list (cheap & keeps everything sorted).
      loadThreads();
      return;
    }

    const senderName = ((msg.first_name || '') + ' ' + (msg.last_name || '')).trim();
    found.body = msg.body;
    found.created_at = msg.created_at;
    found.sender = {
      id: msg.sender_id,
      first_name: msg.first_name,
      last_name: msg.last_name,
      role: msg.role,
    };

    // Move to the top, keeping any pinned threads first.
    threads = threads.filter(function (t) { return t !== found; });
    const firstNonPinned = threads.findIndex(function (t) { return !t.pinned; });
    if (found.pinned || firstNonPinned === -1) {
      threads.unshift(found);
    } else {
      threads.splice(firstNonPinned, 0, found);
    }
    renderThreadList(threads);

    if (markUnread) {
      const item = document.querySelector(
        '.thread-item[data-thread-kind="' + kind + '"][data-thread-key="' + CSS.escape(String(key)) + '"]'
      );
      if (item) {
        const meta = item.querySelector('.thread-meta');
        if (meta && !meta.querySelector('.unread-dot')) {
          const dot = document.createElement('span');
          dot.className = 'unread-dot';
          meta.appendChild(dot);
        }
        // (suppress unused warning)
        void senderName;
      }
    }
  }

  function filterThreads() {
    const searchInput = document.querySelector('.msg-threads-header input');
    if (!searchInput) return;
    const query = searchInput.value.trim().toLowerCase();
    if (!query) {
      renderThreadList(threads);
      return;
    }
    const filtered = threads.filter(function (t) {
      const sender = t.sender || {};
      const senderName = ((sender.first_name || '') + ' ' + (sender.last_name || '')).toLowerCase();
      const title = (t.title || '').toLowerCase();
      const preview = (t.body || '').toLowerCase();
      return title.indexOf(query) !== -1 || preview.indexOf(query) !== -1 || senderName.indexOf(query) !== -1;
    });
    renderThreadList(filtered);
  }

  // ---------- "New DM" picker ----------------------------------------------

  async function openNewDmPicker() {
    const modal = document.getElementById('new-dm-modal');
    const list = document.getElementById('new-dm-list');
    if (!modal || !list) return;

    list.innerHTML = '<p class="text-muted" style="padding:1rem;">Loading staff members…</p>';
    modal.classList.add('show');

    try {
      const res = await apiFetch('/api/messages/staff-users');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        list.innerHTML =
          '<p class="text-muted" style="padding:1rem;">' +
          escapeHtml(data.error || 'Could not load staff list.') +
          '</p>';
        return;
      }
      const users = await res.json();
      if (!users.length) {
        list.innerHTML = '<p class="text-muted" style="padding:1rem;">No other staff members yet.</p>';
        return;
      }
      list.innerHTML = users.map(function (u) {
        const name = (u.first_name || '') + ' ' + (u.last_name || '');
        const initials = getInitials(name);
        return (
          '<div class="dm-pick-row" data-peer-id="' + u.id + '">' +
            '<div class="thread-avatar" style="background:' + avatarColor(u.id) + ';">' +
              escapeHtml(initials) +
            '</div>' +
            '<div class="dm-pick-info">' +
              '<div class="dm-pick-name">' + escapeHtml(name.trim()) + '</div>' +
              '<div class="dm-pick-role">' + escapeHtml(roleLabel(u.role)) + '</div>' +
            '</div>' +
          '</div>'
        );
      }).join('');

      list.querySelectorAll('.dm-pick-row').forEach(function (row) {
        row.addEventListener('click', function () {
          const peerId = Number(row.dataset.peerId);
          if (!peerId) return;
          modal.classList.remove('show');
          // Make sure the (possibly brand-new) DM thread shows in the sidebar.
          const existing = threads.find(function (t) {
            return t.kind === 'dm' && t.key === 'dm:' + peerId;
          });
          if (!existing) {
            const u = users.find(function (x) { return x.id === peerId; });
            const name = u ? ((u.first_name || '') + ' ' + (u.last_name || '')).trim() : 'Direct message';
            threads.unshift({
              kind: 'dm',
              key: 'dm:' + peerId,
              title: name,
              subtitle: u ? roleLabel(u.role) : 'Direct message',
              body: '',
              created_at: null,
              sender: null,
            });
            renderThreadList(threads);
          }
          selectThread({ kind: 'dm', key: 'dm:' + peerId, peerId: peerId });
        });
      });
    } catch (err) {
      console.error('Failed to load staff users:', err);
      list.innerHTML =
        '<p class="text-muted" style="padding:1rem;">Could not load staff list.</p>';
    }
  }

  // ---------- Init ----------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    initThreadsPage();
    initDiscussionPanel();
  });
})();
