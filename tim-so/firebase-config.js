import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, query, orderBy, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyApcZd718BoEh0-8A3QrXJrs3dV2CeMz4w",
  authDomain: "captain-game-14c88.firebaseapp.com",
  projectId: "captain-game-14c88",
  storageBucket: "captain-game-14c88.firebasestorage.app",
  messagingSenderId: "505116764724",
  appId: "1:505116764724:web:0eb335bccbfef56e19b861",
  measurementId: "G-Y5H3XF6PKR"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

let currentUser = null;

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (window.onUserAuthChanged) {
    window.onUserAuthChanged(user);
  }
});

export async function loginWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    localStorage.setItem('captain_player_name', user.displayName || 'Gamer');
    return { success: true, user };
  } catch (error) {
    console.error("Lỗi đăng nhập Google:", error);
    return { success: false, error };
  }
}

export async function logoutGoogle() {
  try {
    await signOut(auth);
    localStorage.removeItem('captain_player_name');
    return { success: true };
  } catch (error) {
    console.error("Lỗi đăng xuất:", error);
    return { success: false, error };
  }
}

function getUserId() {
  if (currentUser) {
    return 'user_' + currentUser.uid;
  }
  let devId = localStorage.getItem('captain_device_id');
  if (!devId) {
    devId = 'dev_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    localStorage.setItem('captain_device_id', devId);
  }
  return devId;
}

export async function saveScoreToFirebase(name, level, _moves, gameId = "tim-so") {
  try {
    const userId = getUserId();
    const docRef = doc(db, `leaderboard_${gameId}`, userId);

    const displayName = currentUser ? (currentUser.displayName || "Gamer") : "Chưa cập nhật";
    const avatarUrl = currentUser ? currentUser.photoURL : null;
    const newLevel = Number(level) || 1;

    const existingDoc = await getDoc(docRef);
    if (existingDoc.exists()) {
      const oldData = existingDoc.data();
      const oldLevel = Number(oldData.level) || 0;

      if (newLevel < oldLevel) {
        if (currentUser && displayName !== oldData.name) {
          await setDoc(docRef, { name: displayName, avatar: avatarUrl }, { merge: true });
        }
        return { success: true, updated: false, msg: "Kỷ lục cũ tốt hơn!" };
      }

      if (newLevel === oldLevel) {
        if (currentUser && displayName !== oldData.name) {
          await setDoc(docRef, { name: displayName, avatar: avatarUrl }, { merge: true });
        }
        return { success: true, updated: false, msg: "Cùng level, giữ timestamp gốc." };
      }
    }

    await setDoc(docRef, {
      userId: userId,
      name: displayName,
      avatar: avatarUrl,
      level: newLevel,
      timestamp: serverTimestamp()
    });

    return { success: true, updated: true };
  } catch (error) {
    console.error("Lỗi khi lưu điểm:", error);
    return { success: false, error };
  }
}

export async function getTopScoresFromFirebase(gameId = "tim-so") {
  try {
    const q = query(
      collection(db, `leaderboard_${gameId}`),
      orderBy("level", "desc"),
      limit(50)
    );
    const querySnapshot = await getDocs(q);
    const scores = [];
    querySnapshot.forEach((doc) => {
      scores.push(doc.data());
    });

    scores.sort((a, b) => {
      if (b.level !== a.level) return b.level - a.level;
      const tA = a.timestamp ? (a.timestamp.toMillis ? a.timestamp.toMillis() : Number(a.timestamp)) : Infinity;
      const tB = b.timestamp ? (b.timestamp.toMillis ? b.timestamp.toMillis() : Number(b.timestamp)) : Infinity;
      return tA - tB;
    });

    return scores.slice(0, 10);
  } catch (error) {
    console.error("Lỗi khi lấy bảng xếp hạng:", error);
    return [];
  }
}

export async function getMyRank(gameId = "tim-so") {
  try {
    const userId = getUserId();
    if (!userId) return null;

    const q = query(
      collection(db, `leaderboard_${gameId}`),
      orderBy("level", "desc"),
      limit(1000)
    );
    const querySnapshot = await getDocs(q);
    const scores = [];
    querySnapshot.forEach((doc) => {
      scores.push(doc.data());
    });

    scores.sort((a, b) => {
      if (b.level !== a.level) return b.level - a.level;
      const tA = a.timestamp ? (a.timestamp.toMillis ? a.timestamp.toMillis() : Number(a.timestamp)) : Infinity;
      const tB = b.timestamp ? (b.timestamp.toMillis ? b.timestamp.toMillis() : Number(b.timestamp)) : Infinity;
      return tA - tB;
    });

    const index = scores.findIndex(s => (s.userId && s.deviceId) ? (s.userId === userId || s.deviceId === userId) : (s.userId === userId || s.deviceId === userId));
    if (index !== -1) {
      return index + 1;
    }
    return null;
  } catch (error) {
    console.error("Lỗi khi lấy thứ hạng cá nhân:", error);
    return null;
  }
}

export async function getUserScoreFromFirebase(gameId = "tim-so") {
  try {
    if (!currentUser) return null;
    const userId = 'user_' + currentUser.uid;
    const docRef = doc(db, `leaderboard_${gameId}`, userId);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return docSnap.data();
    }
    return null;
  } catch (error) {
    console.error("Lỗi khi lấy dữ liệu tiến trình từ Firebase:", error);
    return null;
  }
}

window.saveScoreToFirebase = saveScoreToFirebase;
window.getTopScoresFromFirebase = getTopScoresFromFirebase;
window.getMyRank = getMyRank;
window.getUserScoreFromFirebase = getUserScoreFromFirebase;
window.loginWithGoogle = loginWithGoogle;
window.logoutGoogle = logoutGoogle;
