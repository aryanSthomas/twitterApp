// ── messages.js — Direct messaging logic ─────────────────────────────────────

if (!requireLogin()) throw new Error('redirect');

const me = getUser();

document.getElementById('sidebar-avatar').textContent = initials(me.username);
document.getElementById('sidebar-name').textContent = me.username;

let selectedUser = null;
let pollInterval = null;
let usersCache = {};

async function loadUsers() {
    const list = document.getElementById('user-list');
    try {
        const users = await apiFetch('/users');
        users.forEach(u => { usersCache[u.id] = u; });
        if (users.length === 0) {
            list.innerHTML = '<div class="loading" style="padding:20px;font-size:13px;">No other users yet</div>';
            return;
        }
        list.innerHTML = users.map(u => `
      <div class="user-row" id="urow-${u.id}" data-user-id="${u.id}">
        <div class="avatar avatar-sm">${initials(u.username)}</div>
        <div class="user-row-name">@${esc(u.username)}</div>
      </div>
    `).join('');
    } catch (err) {
        list.innerHTML = `<div class="loading">Error: ${err.message}</div>`;
    }
}

document.getElementById('user-list').addEventListener('click', function (e) {
    const row = e.target.closest('.user-row');
    if (row && row.dataset.userId) {
        const user = usersCache[row.dataset.userId];
        if (user) selectUser(user);
    }
});

function selectUser(user) {
    selectedUser = user;

    document.querySelectorAll('.user-row').forEach(r => r.classList.remove('selected'));
    const row = document.getElementById(`urow-${user.id}`);
    if (row) row.classList.add('selected');

    document.getElementById('thread-empty').classList.add('hidden');
    document.getElementById('thread-header').classList.remove('hidden');
    document.getElementById('thread-msgs').classList.remove('hidden');
    document.getElementById('thread-input-row').classList.remove('hidden');

    document.getElementById('thread-header').textContent = `@${user.username}`;
    document.getElementById('msg-input').focus();

    clearInterval(pollInterval);
    loadThread();
    pollInterval = setInterval(loadThread, 5000);
}

async function loadThread() {
    if (!selectedUser) return;
    const container = document.getElementById('thread-msgs');
    const wasAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 30;

    try {
        const msgs = await apiFetch(`/messages/${selectedUser.id}`);
        container.innerHTML = msgs.length === 0
            ? '<div class="msg-empty-thread">No messages yet — say hi!</div>'
            : msgs.map(renderMsg).join('');

        if (wasAtBottom || msgs.length === 0) {
            container.scrollTop = container.scrollHeight;
        }
    } catch (err) {
        container.innerHTML = `<div class="loading">Error: ${err.message}</div>`;
    }
}

function renderMsg(m) {
    const mine = m.from.id === me.id;
    return `
    <div class="bubble-row ${mine ? 'mine' : 'theirs'}">
      <div class="bubble-wrap">
        <div class="bubble">${esc(m.content)}</div>
        <div class="bubble-time">${timeAgo(m.createdAt)}</div>
      </div>
    </div>`;
}

async function sendMessage() {
    if (!selectedUser) return;
    const input = document.getElementById('msg-input');
    const content = input.value.trim();
    if (!content) return;
    input.value = '';
    try {
        await apiFetch('/messages', {
            method: 'POST',
            body: JSON.stringify({ toId: selectedUser.id, content }),
        });
        await loadThread();
    } catch (err) {
        alert(err.message);
    }
}

function esc(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

loadUsers();
