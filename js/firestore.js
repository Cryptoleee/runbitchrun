import { FEED_PAGE_SIZE, MAX_RUN_PHOTOS } from './config.js';
import { getDb, getStorage } from './auth.js';
import { state } from './app.js';

// ── Helpers ──────────────────────────────────────────

function uid() {
  return state.user.uid;
}

function ts() {
  return firebase.firestore.FieldValue.serverTimestamp();
}

function feedName(profile) {
  if (profile?.username) return profile.username;
  const full = profile?.displayName || '';
  return full.split(' ')[0] || '';
}

function inc(n) {
  return firebase.firestore.FieldValue.increment(n);
}

// ── User Profile ─────────────────────────────────────

export async function updateProfile(updates) {
  const db = getDb();
  await db.collection('users').doc(uid()).update(updates);
  Object.assign(state.profile, updates);
}

export async function getProfile(userId) {
  const db = getDb();
  const doc = await db.collection('users').doc(userId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

export async function uploadProfilePhoto(blob) {
  const storage = getStorage();
  const ref = storage.ref(`profiles/${uid()}/avatar.jpg`);
  await ref.put(blob, { contentType: 'image/jpeg' });
  const url = await ref.getDownloadURL();
  await updateProfile({ customPhoto: url });
  return url;
}

// ── Runs ─────────────────────────────────────────────

export async function saveRun(runData, photoBlobs = []) {
  const db = getDb();
  const storage = getStorage();

  // Upload photos (up to MAX_RUN_PHOTOS)
  const photos = [];
  const blobs = photoBlobs.slice(0, MAX_RUN_PHOTOS);
  for (let i = 0; i < blobs.length; i++) {
    const runPhotoId = db.collection('runs').doc().id;
    const fullRef = storage.ref(`runs/${uid()}/${runPhotoId}_full.jpg`);
    const thumbRef = storage.ref(`runs/${uid()}/${runPhotoId}_thumb.jpg`);

    await fullRef.put(blobs[i].full, { contentType: 'image/jpeg' });
    await thumbRef.put(blobs[i].thumbnail, { contentType: 'image/jpeg' });

    const fullURL = await fullRef.getDownloadURL();
    const thumbURL = await thumbRef.getDownloadURL();
    photos.push({ full: fullURL, thumbnail: thumbURL });
  }

  // Build run document
  const runRef = db.collection('runs').doc();
  const run = {
    userId: uid(),
    userName: feedName(state.profile),
    userPhoto: state.profile.customPhoto || state.profile.photoURL || '',
    type: 'run',
    ...runData,
    photos,
    createdAt: ts()
  };

  // Batched write: run doc + user stats
  const batch = db.batch();
  batch.set(runRef, run);

  const userRef = db.collection('users').doc(uid());
  const statsUpdate = {
    'stats.totalRuns': inc(1),
    'stats.totalKm': inc(runData.distance || 0),
    'stats.totalTime': inc(runData.duration || 0)
  };

  // Update bestPace if this run is faster (lower pace and > 0)
  const pace = runData.avgPace || 0;
  const currentBest = (state.profile.stats && state.profile.stats.bestPace) || 0;
  if (pace > 0 && (currentBest === 0 || pace < currentBest)) {
    statsUpdate['stats.bestPace'] = pace;
    statsUpdate['stats.bestPaceRunId'] = runRef.id;
  }

  batch.update(userRef, statsUpdate);
  await batch.commit();

  // Update local state
  if (!state.profile.stats) {
    state.profile.stats = { totalRuns: 0, totalKm: 0, totalTime: 0, bestPace: 0 };
  }
  state.profile.stats.totalRuns += 1;
  state.profile.stats.totalKm += (runData.distance || 0);
  state.profile.stats.totalTime += (runData.duration || 0);
  if (pace > 0 && (currentBest === 0 || pace < currentBest)) {
    state.profile.stats.bestPace = pace;
    state.profile.stats.bestPaceRunId = runRef.id;
  }

  return runRef.id;
}

export async function saveWorkout(workoutData) {
  const db = getDb();

  const workoutRef = db.collection('runs').doc();
  const workout = {
    userId: uid(),
    userName: feedName(state.profile),
    userPhoto: state.profile.customPhoto || state.profile.photoURL || '',
    type: 'interval',
    ...workoutData,
    createdAt: ts()
  };

  const batch = db.batch();
  batch.set(workoutRef, workout);

  const userRef = db.collection('users').doc(uid());
  batch.update(userRef, {
    'stats.totalWorkouts': inc(1),
    'stats.totalWorkoutTime': inc(workoutData.duration || 0)
  });

  await batch.commit();

  if (!state.profile.stats) state.profile.stats = {};
  state.profile.stats.totalWorkouts = (state.profile.stats.totalWorkouts || 0) + 1;
  state.profile.stats.totalWorkoutTime = (state.profile.stats.totalWorkoutTime || 0) + (workoutData.duration || 0);

  return workoutRef.id;
}

export async function getRun(runId) {
  const db = getDb();
  const doc = await db.collection('runs').doc(runId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

export async function deleteRun(runId) {
  const db = getDb();
  const runDoc = await db.collection('runs').doc(runId).get();
  if (!runDoc.exists) throw new Error('Run not found');

  const runData = runDoc.data();
  if (runData.userId !== uid()) throw new Error('Not authorized to delete this run');

  const batch = db.batch();
  batch.delete(db.collection('runs').doc(runId));

  const userRef = db.collection('users').doc(uid());
  batch.update(userRef, {
    'stats.totalRuns': inc(-1),
    'stats.totalKm': inc(-(runData.distance || 0)),
    'stats.totalTime': inc(-(runData.duration || 0))
  });

  await batch.commit();

  // Update local state
  if (state.profile.stats) {
    state.profile.stats.totalRuns = Math.max(0, state.profile.stats.totalRuns - 1);
    state.profile.stats.totalKm = Math.max(0, state.profile.stats.totalKm - (runData.distance || 0));
    state.profile.stats.totalTime = Math.max(0, state.profile.stats.totalTime - (runData.duration || 0));
  }
}

// ── Run Queries ──────────────────────────────────────

export async function getMyRuns(filter = 'all', lastDoc = null) {
  const db = getDb();
  let query = db.collection('runs')
    .where('userId', '==', uid())
    .orderBy('startedAt', 'desc');

  if (filter === 'week') {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    query = query.where('startedAt', '>=', weekAgo);
  } else if (filter === 'month') {
    const monthAgo = new Date();
    monthAgo.setDate(monthAgo.getDate() - 30);
    query = query.where('startedAt', '>=', monthAgo);
  }

  if (lastDoc) {
    query = query.startAfter(lastDoc);
  }

  query = query.limit(FEED_PAGE_SIZE);
  const snapshot = await query.get();

  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), _doc: doc }));
}

export async function getWeeklyRuns(weeksBack = 1) {
  const db = getDb();
  const since = new Date();
  since.setDate(since.getDate() - (weeksBack * 7));

  const snapshot = await db.collection('runs')
    .where('userId', '==', uid())
    .where('startedAt', '>=', since)
    .orderBy('startedAt', 'desc')
    .get();

  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function getUserRuns(userId, lastDoc = null) {
  const db = getDb();
  let query = db.collection('runs')
    .where('userId', '==', userId)
    .where('visibility', 'in', ['public', 'friends'])
    .orderBy('startedAt', 'desc');

  if (lastDoc) {
    query = query.startAfter(lastDoc);
  }

  query = query.limit(FEED_PAGE_SIZE);
  const snapshot = await query.get();

  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), _doc: doc }));
}

// ── Activity Feed ────────────────────────────────────

export async function getFeed(friendIds, lastDoc = null) {
  if (!friendIds || friendIds.length === 0) return [];

  const db = getDb();
  const allRuns = [];

  // Firestore 'in' queries support max 30 values per chunk
  const chunks = [];
  for (let i = 0; i < friendIds.length; i += 30) {
    chunks.push(friendIds.slice(i, i + 30));
  }

  for (const chunk of chunks) {
    let query = db.collection('runs')
      .where('userId', 'in', chunk)
      .orderBy('startedAt', 'desc')
      .limit(FEED_PAGE_SIZE * 2); // over-fetch to account for client-side filtering

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    for (const doc of snapshot.docs) {
      const data = doc.data();
      // Client-side visibility filter (no second 'in' operator)
      if (data.visibility === 'public' || data.visibility === 'friends') {
        allRuns.push({ id: doc.id, ...data, _doc: doc });
      }
    }
  }

  // Sort all merged results by startedAt descending
  allRuns.sort((a, b) => {
    const aTime = a.startedAt?.toMillis?.() || 0;
    const bTime = b.startedAt?.toMillis?.() || 0;
    return bTime - aTime;
  });

  const result = allRuns.slice(0, FEED_PAGE_SIZE);

  // Resolve fresh display names from profiles
  const uniqueUserIds = [...new Set(result.map(r => r.userId))];
  const profiles = {};
  await Promise.all(uniqueUserIds.map(async (id) => {
    if (id === uid()) {
      profiles[id] = state.profile;
    } else {
      try { profiles[id] = await getProfile(id); } catch (_) {}
    }
  }));
  for (const entry of result) {
    const p = profiles[entry.userId];
    if (p) {
      entry.userName = feedName(p) || entry.userName;
    }
  }

  // Resolve comment counts for entries missing the field
  await Promise.all(result.map(async (entry) => {
    if (entry.commentCount == null) {
      try {
        const snap = await db.collection('runs').doc(entry.id).collection('comments').get();
        entry.commentCount = snap.size;
      } catch (_) {
        entry.commentCount = 0;
      }
    }
  }));

  return result;
}

// ── Friends ──────────────────────────────────────────

export async function sendFriendRequest(toUserId) {
  const db = getDb();
  const toProfile = await getProfile(toUserId);
  if (!toProfile) throw new Error('User not found');

  const ref = db.collection('friendRequests').doc();
  await ref.set({
    from: uid(),
    to: toUserId,
    fromName: state.profile.displayName || '',
    fromPhoto: state.profile.customPhoto || state.profile.photoURL || '',
    toName: toProfile.displayName || '',
    toPhoto: toProfile.customPhoto || toProfile.photoURL || '',
    status: 'pending',
    createdAt: ts()
  });

  return ref.id;
}

export async function acceptFriendRequest(requestId, fromUserId) {
  const db = getDb();
  const requestRef = db.collection('friendRequests').doc(requestId);
  const requestDoc = await requestRef.get();
  if (!requestDoc.exists) throw new Error('Friend request not found');

  const requestData = requestDoc.data();
  const fromProfile = await getProfile(fromUserId);

  const batch = db.batch();

  // Update request status
  batch.update(requestRef, { status: 'accepted' });

  // Add friend to my friends subcollection
  const myFriendRef = db.collection('users').doc(uid()).collection('friends').doc(fromUserId);
  batch.set(myFriendRef, {
    since: ts(),
    friendName: fromProfile?.displayName || requestData.fromName || '',
    friendPhoto: fromProfile?.customPhoto || fromProfile?.photoURL || requestData.fromPhoto || ''
  });

  // Add me to their friends subcollection
  const theirFriendRef = db.collection('users').doc(fromUserId).collection('friends').doc(uid());
  batch.set(theirFriendRef, {
    since: ts(),
    friendName: state.profile.displayName || '',
    friendPhoto: state.profile.customPhoto || state.profile.photoURL || ''
  });

  await batch.commit();
}

export async function declineFriendRequest(requestId) {
  const db = getDb();
  await db.collection('friendRequests').doc(requestId).update({ status: 'declined' });
}

export async function getPendingRequests() {
  const db = getDb();
  const snapshot = await db.collection('friendRequests')
    .where('to', '==', uid())
    .where('status', '==', 'pending')
    .get();

  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function syncAcceptedRequests() {
  const db = getDb();
  const snapshot = await db.collection('friendRequests')
    .where('from', '==', uid())
    .where('status', '==', 'accepted')
    .get();

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const friendRef = db.collection('users').doc(uid()).collection('friends').doc(data.to);
    const friendDoc = await friendRef.get();

    if (!friendDoc.exists) {
      const toProfile = await getProfile(data.to);
      await friendRef.set({
        since: ts(),
        friendName: toProfile?.displayName || data.toName || '',
        friendPhoto: toProfile?.customPhoto || toProfile?.photoURL || data.toPhoto || ''
      });
    }
  }
}

export async function getRequestStatus(otherUserId) {
  const db = getDb();
  // Check if we sent a request to them
  const sent = await db.collection('friendRequests')
    .where('from', '==', uid())
    .where('to', '==', otherUserId)
    .where('status', '==', 'pending')
    .get();
  if (!sent.empty) return 'sent';
  // Check if they sent a request to us
  const received = await db.collection('friendRequests')
    .where('from', '==', otherUserId)
    .where('to', '==', uid())
    .where('status', '==', 'pending')
    .get();
  if (!received.empty) return 'received';
  return null;
}

export async function getFriends() {
  const db = getDb();
  const snapshot = await db.collection('users').doc(uid())
    .collection('friends').get();

  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

export async function removeFriend(friendId) {
  const db = getDb();
  await db.collection('users').doc(uid()).collection('friends').doc(friendId).delete();
}

export async function searchUsers(query) {
  if (!query || query.trim() === '') return [];

  const db = getDb();
  const q = query.trim();
  const qLower = q.toLowerCase();

  // Run parallel queries: displayName, email, and username
  const [nameSnap, emailSnap, usernameSnap] = await Promise.all([
    db.collection('users')
      .where('displayName', '>=', q)
      .where('displayName', '<=', q + '\uf8ff')
      .limit(10)
      .get(),
    db.collection('users')
      .where('email', '>=', qLower)
      .where('email', '<=', qLower + '\uf8ff')
      .limit(10)
      .get(),
    db.collection('users')
      .where('username', '>=', qLower)
      .where('username', '<=', qLower + '\uf8ff')
      .limit(10)
      .get()
  ]);

  // Merge and deduplicate
  const seen = new Set();
  const results = [];
  for (const snap of [nameSnap, emailSnap, usernameSnap]) {
    for (const doc of snap.docs) {
      if (doc.id !== uid() && !seen.has(doc.id)) {
        seen.add(doc.id);
        results.push({ id: doc.id, ...doc.data() });
      }
    }
  }

  return results.slice(0, 15);
}

export async function checkUsernameAvailable(username) {
  if (!username) return false;
  const db = getDb();
  const snapshot = await db.collection('users')
    .where('username', '==', username.toLowerCase())
    .limit(1)
    .get();
  // Available if no results, or only result is the current user
  return snapshot.empty || (snapshot.docs.length === 1 && snapshot.docs[0].id === uid());
}

export async function getWeeklyLeaderboard(friendIds) {
  const db = getDb();
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  // Include self in leaderboard
  const allIds = [uid(), ...friendIds];

  // Firestore 'in' max 30
  const chunks = [];
  for (let i = 0; i < allIds.length; i += 30) {
    chunks.push(allIds.slice(i, i + 30));
  }

  const pointsMap = {}; // userId -> { points, userName, userPhoto, userId }

  for (const chunk of chunks) {
    const snapshot = await db.collection('runs')
      .where('userId', 'in', chunk)
      .where('startedAt', '>=', weekAgo)
      .orderBy('startedAt', 'desc')
      .get();

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const userId = data.userId;
      if (!pointsMap[userId]) {
        pointsMap[userId] = {
          userId,
          userName: data.userName || 'Unknown',
          userPhoto: data.userPhoto || '',
          points: 0
        };
      }

      if ((data.type || 'run') === 'run') {
        // 10 points per km
        pointsMap[userId].points += Math.round((data.distance || 0) * 10);
      } else {
        // 1 point per minute of workout
        pointsMap[userId].points += Math.round((data.duration || 0) / 60);
      }
    }
  }

  // Ensure current user appears even with 0 points
  if (!pointsMap[uid()]) {
    pointsMap[uid()] = {
      userId: uid(),
      userName: feedName(state.profile) || 'You',
      userPhoto: state.profile?.customPhoto || state.profile?.photoURL || '',
      points: 0
    };
  }

  // Also fetch fresh profile photos for the top users
  const sorted = Object.values(pointsMap).sort((a, b) => b.points - a.points);

  // Try to get updated profile info for top 3
  for (const entry of sorted.slice(0, 3)) {
    if (entry.userId === uid()) {
      entry.userName = feedName(state.profile) || entry.userName;
      entry.userPhoto = state.profile?.customPhoto || state.profile?.photoURL || entry.userPhoto;
    } else {
      try {
        const profile = await getProfile(entry.userId);
        if (profile) {
          entry.userName = feedName(profile) || entry.userName;
          entry.userPhoto = profile.customPhoto || profile.photoURL || entry.userPhoto;
        }
      } catch (_) {}
    }
  }

  return sorted;
}

// ── Reactions ────────────────────────────────────────

export async function addReaction(runId, type) {
  const db = getDb();
  await db.collection('runs').doc(runId)
    .collection('reactions').doc(uid())
    .set({
      type,
      userId: uid(),
      userName: feedName(state.profile),
      createdAt: ts()
    });
}

export async function removeReaction(runId) {
  const db = getDb();
  await db.collection('runs').doc(runId)
    .collection('reactions').doc(uid())
    .delete();
}

export async function getReactions(runId) {
  const db = getDb();
  const snapshot = await db.collection('runs').doc(runId)
    .collection('reactions').get();

  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// ── Comments ─────────────────────────────────────────

export async function addComment(runId, text) {
  const db = getDb();
  const ref = db.collection('runs').doc(runId).collection('comments').doc();
  const batch = db.batch();
  batch.set(ref, {
    userId: uid(),
    userName: feedName(state.profile),
    userPhoto: state.profile.customPhoto || state.profile.photoURL || '',
    text,
    createdAt: ts()
  });
  batch.update(db.collection('runs').doc(runId), {
    commentCount: inc(1)
  });
  // Create notification for the run owner (if not self)
  const runDoc = await db.collection('runs').doc(runId).get();
  const runData = runDoc.data();
  if (runData && runData.userId !== uid()) {
    const notifRef = db.collection('notifications').doc();
    batch.set(notifRef, {
      userId: runData.userId,
      type: 'comment',
      fromId: uid(),
      fromName: feedName(state.profile),
      fromPhoto: state.profile.customPhoto || state.profile.photoURL || '',
      runId,
      text,
      read: false,
      createdAt: ts()
    });
  }
  await batch.commit();
  return ref.id;
}

export async function deleteComment(runId, commentId) {
  const db = getDb();
  const batch = db.batch();
  batch.delete(db.collection('runs').doc(runId).collection('comments').doc(commentId));
  batch.update(db.collection('runs').doc(runId), {
    commentCount: inc(-1)
  });
  await batch.commit();
}

export function subscribeToComments(runId, callback) {
  const db = getDb();
  return db.collection('runs').doc(runId)
    .collection('comments')
    .orderBy('createdAt', 'asc')
    .onSnapshot(snapshot => {
      const comments = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      callback(comments);
    });
}

// ── Notifications ─────────────────────────────────────

export function subscribeToNotifications(callback) {
  const db = getDb();
  return db.collection('notifications')
    .where('userId', '==', uid())
    .orderBy('createdAt', 'desc')
    .limit(50)
    .onSnapshot(snapshot => {
      const notifs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      callback(notifs);
    });
}

export async function markNotificationsRead() {
  const db = getDb();
  const snapshot = await db.collection('notifications')
    .where('userId', '==', uid())
    .where('read', '==', false)
    .get();
  const batch = db.batch();
  snapshot.docs.forEach(doc => batch.update(doc.ref, { read: true }));
  if (snapshot.docs.length > 0) await batch.commit();
}
