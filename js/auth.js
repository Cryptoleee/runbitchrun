import { firebaseConfig } from './config.js';
import { navigateTo, setUser } from './app.js';
import { showToast } from './ui.js';

const isNative = typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();

let auth;
let db;

function hideSplash() {
  const splash = document.getElementById('splash-screen');
  if (splash) splash.remove();
}

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

  // Wait for redirect result to resolve BEFORE setting up auth state listener.
  // This prevents the race condition where onAuthStateChanged fires with null
  // before the redirect sign-in result is processed (causing a flash of login page).
  auth.getRedirectResult()
    .then((result) => {
      console.log('[auth] getRedirectResult:', result ? 'has user' : 'no redirect');
    })
    .catch((err) => {
      console.error('[auth] Redirect error:', err);
      showToast('Redirect error: ' + (err.code || err.message), 'error');
    })
    .then(() => {
      console.log('[auth] Setting up onAuthStateChanged');
      auth.onAuthStateChanged(async (user) => {
        console.log('[auth] onAuthStateChanged:', user ? user.email : 'null');
        if (user) {
          try {
            const profile = await getOrCreateProfile(user);
            setUser(user, profile);
            hideSplash();
            navigateTo('home', { force: true });
          } catch (err) {
            console.error('[auth] Profile error:', err);
            showToast('Profile error: ' + (err.code || err.message), 'error');
            setUser(user, {
              displayName: user.displayName || 'Runner',
              photoURL: user.photoURL || '',
              customPhoto: '',
              email: user.email || '',
              username: '',
              weight: 70,
              units: 'metric',
              autoPause: true,
              defaultVisibility: 'public',
              stats: { totalRuns: 0, totalKm: 0, totalTime: 0, bestPace: 0, totalWorkouts: 0, totalWorkoutTime: 0 }
            });
            hideSplash();
            navigateTo('home', { force: true });
          }
        } else {
          setUser(null, null);
          hideSplash();
          navigateTo('login', { force: true, skipHistory: true });
        }
      });
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
    username: '',
    weight: 70,
    units: 'metric',
    autoPause: true,
    defaultVisibility: 'public',
    stats: { totalRuns: 0, totalKm: 0, totalTime: 0, bestPace: 0, totalWorkouts: 0, totalWorkoutTime: 0 },
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  await docRef.set(profile);
  return profile;
}

async function signIn(provider) {
  if (isNative) {
    try {
      const FirebaseAuthentication = window.Capacitor.Plugins.FirebaseAuthentication;
      const result = await FirebaseAuthentication.signInWithGoogle();
      const credential = firebase.auth.GoogleAuthProvider.credential(result.credential?.idToken);
      await auth.signInWithCredential(credential);
    } catch (error) {
      console.error('Native sign-in error:', error);
      showToast(error.message || 'Sign-in failed. Please try again.', 'error');
    }
    return;
  }

  try {
    await auth.signInWithPopup(provider);
  } catch (error) {
    console.error('Sign-in error:', error);
    if (error.code === 'auth/popup-blocked' || error.code === 'auth/popup-closed-by-user') {
      try {
        await auth.signInWithRedirect(provider);
      } catch (redirectErr) {
        showToast(redirectErr.message || 'Sign-in failed. Please try again.', 'error');
      }
    } else {
      showToast(error.message || 'Sign-in failed. Please try again.', 'error');
    }
  }
}

async function signOut() {
  if (isNative) {
    try {
      const FirebaseAuthentication = window.Capacitor.Plugins.FirebaseAuthentication;
      await FirebaseAuthentication.signOut();
    } catch (_) {}
  }
  await auth.signOut();
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
