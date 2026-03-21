import { state } from './app.js';
import {
  getFriends, getPendingRequests, getSentRequests, sendFriendRequest,
  acceptFriendRequest, declineFriendRequest, removeFriend,
  searchUsers, syncAcceptedRequests, getFeed,
  addReaction, removeReaction, getReactions,
  addComment, deleteComment, subscribeToComments,
  getWeeklyLeaderboard
} from './firestore.js';
import {
  showToast, openBottomSheet, closeBottomSheet,
  formatDistance, formatPace, formatDuration, formatTimeAgo
} from './ui.js';

// ── Helpers ──────────────────────────────────────────

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ── Friends Management ───────────────────────────────

export async function loadFriends() {
  await syncAcceptedRequests();
  const friends = await getFriends();
  state.friends = friends.map(f => f.id);
  return friends;
}

export async function loadPendingRequests() {
  return getPendingRequests();
}

export async function loadSentRequests() {
  return getSentRequests();
}

export async function handleSendRequest(userId) {
  try {
    await sendFriendRequest(userId);
    showToast('Friend request sent!', 'success');
  } catch (err) {
    showToast(err.message || 'Failed to send request', 'error');
  }
}

export async function handleAcceptRequest(requestId, fromUserId) {
  try {
    await acceptFriendRequest(requestId, fromUserId);
    showToast('Friend request accepted!', 'success');
    await loadFriends();
  } catch (err) {
    showToast(err.message || 'Failed to accept request', 'error');
  }
}

export async function handleDeclineRequest(requestId) {
  await declineFriendRequest(requestId);
  showToast('Request declined');
}

export async function handleRemoveFriend(friendId) {
  await removeFriend(friendId);
  state.friends = state.friends.filter(id => id !== friendId);
  showToast('Friend removed');
}

export async function handleSearchUsers(query) {
  if (!query || query.length < 2) return [];
  return searchUsers(query);
}

// ── Leaderboard ─────────────────────────────────────

export async function loadLeaderboard() {
  return getWeeklyLeaderboard(state.friends || []);
}

// ── Feed ─────────────────────────────────────────────

export async function loadFeed() {
  // Include self in the social feed
  const feedIds = [...(state.friends || [])];
  if (state.user && !feedIds.includes(state.user.uid)) {
    feedIds.push(state.user.uid);
  }
  if (feedIds.length === 0) return [];
  return getFeed(feedIds);
}

// ── Reactions ────────────────────────────────────────

export async function handleReaction(runId, type) {
  const reactions = await getReactions(runId);
  const existing = reactions.find(r => r.userId === state.user.uid);

  if (existing && existing.type === type) {
    await removeReaction(runId);
  } else {
    await addReaction(runId, type);
  }

  return getReactions(runId);
}

export function renderReactions(reactions, runId) {
  const counts = { like: 0, fire: 0, clap: 0 };
  let userReaction = null;

  for (const r of reactions) {
    if (counts[r.type] !== undefined) counts[r.type]++;
    if (r.userId === state.user.uid) userReaction = r.type;
  }

  const types = [
    { key: 'like', emoji: '\u2764\uFE0F' },
    { key: 'fire', emoji: '\uD83D\uDD25' },
    { key: 'clap', emoji: '\uD83D\uDC4F' }
  ];

  const buttons = types.map(({ key, emoji }) => {
    const active = userReaction === key;
    const activeClass = active ? 'bg-primary-container/20 ring-1' : '';
    const count = counts[key];
    return `<button class="reaction-btn ${activeClass}" data-type="${key}" data-run-id="${runId}" style="display:inline-flex;align-items:center;gap:4px;padding:6px 12px;border-radius:20px;border:none;background:${active ? 'rgba(183,254,0,0.15)' : 'rgba(255,255,255,0.06)'};cursor:pointer;font-size:14px;${active ? 'box-shadow:0 0 0 1px rgba(183,254,0,0.4);' : ''}">${emoji}${count > 0 ? ` <span style="color:#aaa;font-size:12px;">${count}</span>` : ''}</button>`;
  });

  return `<div style="display:flex;gap:8px;align-items:center;">${buttons.join('')}</div>`;
}

// ── Comments ─────────────────────────────────────────

export function openComments(runId) {
  const html = `
    <div style="display:flex;flex-direction:column;height:100%;max-height:70vh;">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px;border-bottom:1px solid #2a2a2a;">
        <h3 style="font-size:18px;font-weight:600;color:#fff;margin:0;">Comments</h3>
        <button id="comments-close" style="background:none;border:none;color:#aaa;font-size:24px;cursor:pointer;padding:4px;">&times;</button>
      </div>
      <div id="comments-list" style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px;">
        <div style="display:flex;justify-content:center;padding:24px;">
          <div style="width:24px;height:24px;border:2px solid #b7fe00;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
        </div>
      </div>
      <div style="display:flex;gap:8px;padding:12px 16px;border-top:1px solid #2a2a2a;">
        <input id="comment-input" type="text" maxlength="500" placeholder="Add a comment..." style="flex:1;background:#1a1a1a;border:1px solid #333;border-radius:20px;padding:10px 16px;color:#fff;font-size:14px;outline:none;" />
        <button id="comment-send" style="background:#b7fe00;color:#0e0e0e;border:none;border-radius:50%;width:40px;height:40px;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;">
          <span style="margin-top:-1px;">&#9654;</span>
        </button>
      </div>
    </div>
  `;

  const sheet = openBottomSheet(html);

  // Close button
  const closeBtn = sheet.querySelector('#comments-close');
  if (closeBtn) closeBtn.addEventListener('click', closeBottomSheet);

  // Send comment handler
  async function sendComment() {
    const input = sheet.querySelector('#comment-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    try {
      await addComment(runId, text);
    } catch (err) {
      showToast('Failed to send comment', 'error');
    }
  }

  const sendBtn = sheet.querySelector('#comment-send');
  if (sendBtn) sendBtn.addEventListener('click', sendComment);

  const input = sheet.querySelector('#comment-input');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendComment();
      }
    });
  }

  // Subscribe to real-time comments
  const unsubscribe = subscribeToComments(runId, (comments) => {
    const list = sheet.querySelector('#comments-list');
    if (!list) return;

    if (comments.length === 0) {
      list.innerHTML = '<p style="color:#666;text-align:center;padding:24px;font-size:14px;">No comments yet. Be the first!</p>';
      return;
    }

    list.innerHTML = comments.map(c => {
      const time = c.createdAt?.toDate ? formatTimeAgo(c.createdAt.toDate()) : '';
      const isOwn = c.userId === state.user.uid;
      const photo = c.userPhoto || '';
      const avatarContent = photo
        ? `<img src="${escapeHtml(photo)}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;" />`
        : `<div style="width:32px;height:32px;border-radius:50%;background:#333;display:flex;align-items:center;justify-content:center;color:#aaa;font-size:14px;">${escapeHtml((c.userName || '?')[0])}</div>`;

      return `
        <div style="display:flex;gap:10px;align-items:flex-start;">
          ${avatarContent}
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:baseline;gap:8px;">
              <span style="font-weight:600;font-size:13px;color:#fff;">${escapeHtml(c.userName || 'Unknown')}</span>
              <span style="font-size:11px;color:#666;">${time}</span>
            </div>
            <p style="margin:2px 0 0;font-size:14px;color:#ccc;word-break:break-word;">${escapeHtml(c.text || '')}</p>
          </div>
          ${isOwn ? `<button class="delete-comment-btn" data-comment-id="${c.id}" style="background:none;border:none;color:#666;font-size:16px;cursor:pointer;padding:4px;flex-shrink:0;">&times;</button>` : ''}
        </div>
      `;
    }).join('');

    // Bind delete buttons
    list.querySelectorAll('.delete-comment-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const commentId = btn.dataset.commentId;
        try {
          await deleteComment(runId, commentId);
        } catch (err) {
          showToast('Failed to delete comment', 'error');
        }
      });
    });

    // Auto-scroll to bottom
    list.scrollTop = list.scrollHeight;
  });

  // Unsubscribe when sheet is removed from DOM
  const observer = new MutationObserver(() => {
    if (!document.body.contains(sheet)) {
      unsubscribe();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// ── Social Feed Item Renderer (Stitch design) ───────

export function renderSocialFeedItem(run) {
  const units = state.profile?.units || 'metric';
  const isWorkout = (run.type || 'run') === 'interval';
  const timeAgo = run.startedAt?.toDate ? formatTimeAgo(run.startedAt.toDate()) : (run.startedAt ? formatTimeAgo(run.startedAt) : '');

  const photo = run.userPhoto || '';
  const avatarHtml = photo
    ? `<img class="w-full h-full object-cover" src="${escapeHtml(photo)}" alt="" />`
    : `<div class="w-full h-full flex items-center justify-center font-headline font-bold text-on-surface-variant">${escapeHtml((run.userName || '?')[0])}</div>`;

  const borderColor = isWorkout ? 'border-[#FF5C00]' : 'border-[#B8FF00]';
  const glowColor = isWorkout ? '#FF5C00' : '#B8FF00';
  const typeIcon = isWorkout ? 'fitness_center' : 'directions_run';
  const label = isWorkout ? 'Interval Workout' : 'Run';

  let statsHtml;
  if (isWorkout) {
    const rounds = run.completedRounds || run.config?.rounds || 0;
    const workSec = run.config?.workSeconds || 0;
    const restSec = run.config?.restSeconds || 0;
    statsHtml = `
      <div class="space-y-1">
        <p class="font-label text-[9px] text-on-surface-variant font-bold uppercase tracking-widest">Rounds</p>
        <p class="font-headline text-2xl font-bold">${rounds}</p>
      </div>
      <div class="space-y-1">
        <p class="font-label text-[9px] text-on-surface-variant font-bold uppercase tracking-widest">Work</p>
        <p class="font-headline text-2xl font-bold">${workSec}<span class="text-xs ml-1 text-on-surface-variant">SEC</span></p>
      </div>
      <div class="space-y-1">
        <p class="font-label text-[9px] text-on-surface-variant font-bold uppercase tracking-widest">Rest</p>
        <p class="font-headline text-2xl font-bold">${restSec}<span class="text-xs ml-1 text-on-surface-variant">SEC</span></p>
      </div>
    `;
  } else {
    const dist = formatDistance(run.distance || 0, units);
    const pace = formatPace(run.avgPace || 0, units);
    const duration = formatDuration(run.duration || 0);
    statsHtml = `
      <div class="space-y-1">
        <p class="font-label text-[9px] text-on-surface-variant font-bold uppercase tracking-widest">Distance</p>
        <p class="font-headline text-2xl font-bold">${dist.value}<span class="text-xs ml-1 text-on-surface-variant">${dist.unit}</span></p>
      </div>
      <div class="space-y-1">
        <p class="font-label text-[9px] text-on-surface-variant font-bold uppercase tracking-widest">Pace</p>
        <p class="font-headline text-2xl font-bold">${pace.value}<span class="text-xs ml-1 text-on-surface-variant">${pace.unit}</span></p>
      </div>
      <div class="space-y-1">
        <p class="font-label text-[9px] text-on-surface-variant font-bold uppercase tracking-widest">Time</p>
        <p class="font-headline text-2xl font-bold">${duration}</p>
      </div>
    `;
  }

  // Photos strip
  const photosHtml = run.photos && run.photos.length > 0
    ? `<div class="flex gap-2 overflow-x-auto hide-scrollbar pb-1 mb-4">
        ${run.photos.map(p => `<img src="${escapeHtml(p.thumbnail || p.full)}" data-full="${escapeHtml(p.full || p.thumbnail)}" data-run-id="${run.id}" data-user-name="${escapeHtml(run.userName || '')}" data-time="${timeAgo}" class="photo-thumb h-20 rounded-xl object-cover flex-shrink-0 cursor-pointer active:scale-95 transition-transform" />`).join('')}
      </div>`
    : '';

  return `
    <div class="social-feed-card rounded-2xl p-5 border-l-4 ${borderColor} backdrop-blur-md" style="background:linear-gradient(135deg, #1a1919 40%, ${glowColor}12 100%);" data-run-id="${run.id}" data-run-type="${run.type || 'run'}">
      <div class="flex justify-between items-start mb-6">
        <button class="feed-user-link flex items-center gap-3 text-left active:scale-95 transition-transform" data-uid="${run.userId || ''}">
          <div class="w-10 h-10 rounded-xl overflow-hidden bg-surface-container-highest">
            ${avatarHtml}
          </div>
          <div>
            <h4 class="font-headline font-bold text-sm uppercase">${escapeHtml(run.userName || 'Unknown')}</h4>
            <p class="font-label text-[10px] text-on-surface-variant uppercase tracking-tighter">${escapeHtml(label)} &bull; ${timeAgo}</p>
          </div>
        </button>
        <span class="material-symbols-outlined text-on-surface-variant text-xl">${typeIcon}</span>
      </div>
      ${photosHtml}
      <div class="grid grid-cols-3 gap-4 mb-6">
        ${statsHtml}
      </div>
      <div class="flex items-center justify-between pt-4 border-t border-white/5">
        <div id="reactions-${run.id}"></div>
        <div class="flex items-center gap-4 text-on-surface-variant">
          <button class="comment-btn relative flex items-center gap-1.5 active:scale-90 transition-transform" data-run-id="${run.id}">
            <span class="material-symbols-outlined text-xl">chat_bubble</span>
            ${(run.commentCount || 0) > 0 ? `<span class="text-[10px] font-bold text-on-surface-variant">${run.commentCount}</span>` : ''}
          </button>
        </div>
      </div>
    </div>
  `;
}

// ── Feed Item Renderer ───────────────────────────────

export function renderFeedItem(run) {
  const units = state.profile?.units || 'metric';
  const dist = formatDistance(run.distance || 0, units);
  const pace = formatPace(run.avgPace || 0, units);
  const duration = formatDuration(run.duration || 0);
  const timeAgo = run.startedAt?.toDate ? formatTimeAgo(run.startedAt.toDate()) : (run.startedAt ? formatTimeAgo(run.startedAt) : '');

  const photo = run.userPhoto || '';
  const avatarContent = photo
    ? `<img src="${escapeHtml(photo)}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;" />`
    : `<div style="width:40px;height:40px;border-radius:50%;background:#333;display:flex;align-items:center;justify-content:center;color:#aaa;font-size:18px;">${escapeHtml((run.userName || '?')[0])}</div>`;

  const mapSnapshot = run.mapSnapshot
    ? `<img src="${escapeHtml(run.mapSnapshot)}" class="feed-map-snapshot" data-run-id="${run.id}" onclick="this.dispatchEvent(new CustomEvent('view-run',{bubbles:true,detail:{runId:'${run.id}'}}))" style="width:100%;border-radius:12px;cursor:pointer;margin:12px 0;" />`
    : '';

  const photosHtml = run.photos && run.photos.length > 0
    ? `<div style="display:flex;gap:8px;overflow-x:auto;padding:8px 0;-webkit-overflow-scrolling:touch;">
        ${run.photos.map(p => `<img src="${escapeHtml(p.thumbnail || p.full)}" data-full="${escapeHtml(p.full || p.thumbnail)}" data-run-id="${run.id}" data-user-name="${escapeHtml(run.userName || '')}" class="photo-thumb" style="height:80px;border-radius:8px;object-fit:cover;flex-shrink:0;cursor:pointer;" />`).join('')}
      </div>`
    : '';

  return `
    <div class="feed-item" style="background:#1a1a1a;border-radius:16px;padding:16px;margin-bottom:12px;">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
        ${avatarContent}
        <div style="flex:1;">
          <div style="font-weight:600;font-size:15px;color:#fff;">${escapeHtml(run.userName || 'Unknown')}</div>
          <div style="font-size:12px;color:#666;">${timeAgo}</div>
        </div>
      </div>
      ${mapSnapshot}
      <div style="display:flex;justify-content:space-around;padding:12px 0;border-top:1px solid #2a2a2a;border-bottom:1px solid #2a2a2a;">
        <div style="text-align:center;">
          <div style="font-size:18px;font-weight:700;color:#fff;">${dist.value}</div>
          <div style="font-size:11px;color:#666;">${dist.unit}</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:18px;font-weight:700;color:#fff;">${duration}</div>
          <div style="font-size:11px;color:#666;">TIME</div>
        </div>
        <div style="text-align:center;">
          <div style="font-size:18px;font-weight:700;color:#fff;">${pace.value}</div>
          <div style="font-size:11px;color:#666;">${pace.unit}</div>
        </div>
      </div>
      ${photosHtml}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;">
        <div id="reactions-${run.id}"></div>
        <button class="comment-btn" data-run-id="${run.id}" style="background:none;border:none;color:#aaa;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:4px;padding:6px 12px;">
          <span style="font-size:18px;">&#128172;</span>${(run.commentCount || 0) > 0 ? ` <span style="font-size:12px;font-weight:600;">${run.commentCount}</span>` : ' Comment'}
        </button>
      </div>
    </div>
  `;
}
