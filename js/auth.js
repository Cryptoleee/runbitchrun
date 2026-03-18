import { firebaseConfig } from './config.js';
import { navigateTo, setUser } from './app.js';
import { showToast } from './ui.js';

let auth;
let db;

function initAuth() {
  firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db = firebase.firestore();
  const provider = new firebase.auth.GoogleAuthProvider();

  db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
    if (err.code === 'failed-precondition') {
      console.warn('Firestore persistence failed: multiple tabs open.');
    } else if (err.code === 'unimplemented') {
      console.warn('Firestore persistence not available in this browser.');
    }
  });

  auth.onAuthStateChanged(async (user) => {
    if (user) {
      const profile = await getOrCreateProfile(user);
      setUser(user, profile);
      navigateTo('home', { force: true });
    } else {
      setUser(null, null);
      navigateTo('login', { force: true, skipHistory: true });
    }
  });

  const loginBtn = document.querySelector('#btn-google-login');
  if (loginBtn) {
    loginBtn.addEventListener('click', () => signIn(provider));
  }
}

async function getOrCreateProfile(user) {
  const docRef = db.collection('users').doc(user.uid);
  const doc = await docRef.get();

  if (doc.exists) {
    return doc.data();
  }

  const profile = {
    displayName: user.displayName || 'Runner',
    photoURL: user.photoURL || '',
    customPhoto: '',
    email: user.email || '',
    weight: 70,
    units: 'metric',
    autoPause: true,
    defaultVisibility: 'public',
    stats: { totalRuns: 0, totalKm: 0, totalTime: 0, bestPace: 0 },
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  await docRef.set(profile);
  return profile;
}

async function signIn(provider) {
  try {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );

    if (isMobile) {
      await auth.signInWithRedirect(provider);
    } else {
      await auth.signInWithPopup(provider);
    }
  } catch (error) {
    console.error('Sign-in error:', error);
    showToast(error.message || 'Sign-in failed. Please try again.');
  }
}

function signOut() {
  auth.signOut();
  showToast('Signed out successfully.');
}

function getAuth() {
  return auth;
}

function getDb() {
  return db;
}

function getStorage() {
  return firebase.storage();
}

export { initAuth, signOut, getAuth, getDb, getStorage };
