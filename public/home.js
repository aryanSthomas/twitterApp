// ── home.js — Public feed logic ───────────────────────────────────────────────

if (!requireLogin()) throw new Error('redirect');

const me = getUser();

document.getElementById('sidebar-avatar').textContent = initials(me.username);
document.getElementById('sidebar-name').textContent = me.username;
document.getElementById('compose-avatar').textContent = initials(me.username);

let quoteTargetId = null;
let postsCache = {};

function updateChar() {
    const left = 280 - document.getElementById('compose-input').value.length;
    document.getElementById('char-count').textContent = left;
}

async function loadFeed() {
    const feed = document.getElementById('feed');
    try {
        const posts = await apiFetch('/posts');
        posts.forEach(p => { postsCache[p.id] = p; });
        if (posts.length === 0) {
            feed.innerHTML = '<div class="empty-feed">No posts yet — be the first!</div>';
            return;
        }
        feed.innerHTML = posts.map(renderPost).join('');
    } catch (err) {
        feed.innerHTML = `<div class="loading">Error: ${err.message}</div>`;
    }
}

function renderPost(post) {
    const isMe = post.author.id === me.id;
    const quotedHtml = post.quotedPost
        ? `<div class="quoted-post">
        <div class="post-author">@${esc(post.quotedPost.author.username)}</div>
        <div class="post-content">${esc(post.quotedPost.content)}</div>
       </div>`
        : '';

    return `
  <div class="post" id="post-${post.id}">
    <div class="avatar avatar-sm">${initials(post.author.username)}</div>
    <div class="post-body">
      <div class="post-meta">
        <span class="post-author">@${esc(post.author.username)}</span>
        ${isMe ? '<span style="font-size:12px;color:var(--accent)">You</span>' : ''}
        <span class="post-time">${timeAgo(post.createdAt)}</span>
      </div>
      <div class="post-content">${esc(post.content)}</div>
      ${quotedHtml}
      <div class="post-actions">
        <button class="btn btn-ghost btn-sm like-btn ${post.likedByMe ? 'liked' : ''}" data-post-id="${post.id}">
          ${post.likedByMe ? '❤️' : '🤍'} <span class="like-count">${post.likes || 0}</span>
        </button>
        <button class="btn btn-ghost btn-sm quote-btn" data-post-id="${post.id}">
          🔗 Quote
        </button>
      </div>
    </div>
  </div>`;
}

function esc(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function submitPost() {
    const input = document.getElementById('compose-input');
    const content = input.value.trim();
    if (!content) return;
    try {
        await apiFetch('/posts', { method: 'POST', body: JSON.stringify({ content }) });
        input.value = '';
        updateChar();
        await loadFeed();
    } catch (err) {
        alert(err.message);
    }
}

function openQuote(postId) {
    const post = postsCache[postId];
    if (!post) return;
    quoteTargetId = postId;
    document.getElementById('qp-author').textContent = '@' + post.author.username;
    document.getElementById('qp-content').textContent = post.content;
    document.getElementById('quote-input').value = '';
    document.getElementById('quote-overlay').classList.add('open');
    document.getElementById('quote-input').focus();
}

function closeQuote() {
    quoteTargetId = null;
    document.getElementById('quote-overlay').classList.remove('open');
}

async function submitQuote() {
    const content = document.getElementById('quote-input').value.trim();
    if (!content) return;
    try {
        await apiFetch(`/posts/${quoteTargetId}/quote`, {
            method: 'POST',
            body: JSON.stringify({ content }),
        });
        closeQuote();
        await loadFeed();
    } catch (err) {
        alert(err.message);
    }
}

document.getElementById('quote-overlay').addEventListener('click', function (e) {
    if (e.target === this) closeQuote();
});

async function toggleLike(postId) {
    const btn = document.querySelector(`.like-btn[data-post-id="${postId}"]`);
    if (btn) {
        const liked = btn.classList.toggle('liked');
        const countEl = btn.querySelector('.like-count');
        const count = parseInt(countEl.textContent, 10);
        countEl.textContent = liked ? count + 1 : Math.max(0, count - 1);
        // update emoji
        btn.childNodes[1].textContent = liked ? '❤️' : '🤍';
    }
    try {
        await apiFetch(`/posts/${postId}/like`, { method: 'POST' });
    } catch (err) {
        await loadFeed(); // revert on failure
    }
}

document.getElementById('feed').addEventListener('click', function (e) {
    const likeBtn = e.target.closest('.like-btn');
    const quoteBtn = e.target.closest('.quote-btn');
    if (likeBtn) toggleLike(likeBtn.dataset.postId);
    if (quoteBtn) openQuote(quoteBtn.dataset.postId);
});

loadFeed();
setInterval(loadFeed, 15000);
