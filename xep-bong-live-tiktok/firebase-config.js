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

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// User state
let currentUser = null;

// Theo dõi trạng thái đăng nhập
onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (window.onUserAuthChanged) {
    window.onUserAuthChanged(user);
  }
});

/**
 * Đăng nhập bằng Google Popup
 */
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

/**
 * Đăng xuất
 */
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

// Khởi tạo/Lấy ID định danh cho tài khoản hoặc thiết bị
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

/**
 * Lưu/Cập nhật điểm kỷ lục người chơi lên Firestore
 * Chỉ lưu level + timestamp (không lưu số bước).
 * Timestamp được giữ nguyên nếu level không đổi (người lên trước giữ thứ hạng cao hơn).
 * @param {string} name
 * @param {number} level
 * @param {number} _moves  – giữ tham số để không phá vỡ chữ ký hàm, không lưu
 * @param {string} gameId
 */
export async function saveScoreToFirebase(name, level, _moves, gameId = "xep-bong") {
  try {
    const userId = getUserId();
    const docRef = doc(db, `leaderboard_${gameId}`, userId);

    const displayName = currentUser ? (currentUser.displayName || "Gamer") : "Chưa cập nhật";
    const avatarUrl = currentUser ? currentUser.photoURL : null;
    const newLevel = Number(level) || 1;

    // Kiểm tra kỷ lục cũ
    const existingDoc = await getDoc(docRef);
    if (existingDoc.exists()) {
      const oldData = existingDoc.data();
      const oldLevel = Number(oldData.level) || 0;

      if (newLevel < oldLevel) {
        // Level mới thấp hơn → chỉ cập nhật tên/avatar nếu cần
        if (currentUser && displayName !== oldData.name) {
          await setDoc(docRef, { name: displayName, avatar: avatarUrl }, { merge: true });
        }
        return { success: true, updated: false, msg: "Kỷ lục cũ tốt hơn!" };
      }

      if (newLevel === oldLevel) {
        // Cùng level → timestamp cũ được giữ nguyên (người lên trước giữ thứ hạng)
        if (currentUser && displayName !== oldData.name) {
          await setDoc(docRef, { name: displayName, avatar: avatarUrl }, { merge: true });
        }
        return { success: true, updated: false, msg: "Cùng level, giữ timestamp gốc." };
      }
    }

    // Level cao hơn → ghi đè với timestamp mới
    await setDoc(docRef, {
      userId:    userId,
      name:      displayName,
      avatar:    avatarUrl,
      level:     newLevel,
      timestamp: serverTimestamp()
    });

    return { success: true, updated: true };
  } catch (error) {
    console.error("Lỗi khi lưu điểm:", error);
    return { success: false, error };
  }
}

/**
 * Lấy danh sách Top 10 cao thủ từ Firestore theo từng Game.
 * Tiêu chí xếp hạng: Level cao hơn → xếp trước.
 * Nếu cùng Level: timestamp nhỏ hơn (lên trước) → xếp trước.
 * @param {string} gameId
 */
export async function getTopScoresFromFirebase(gameId = "xep-bong") {
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

    // Cùng level → ai lên trước (timestamp nhỏ hơn) xếp cao hơn
    scores.sort((a, b) => {
      if (b.level !== a.level) return b.level - a.level;
      // timestamp có thể là Firestore Timestamp hoặc null
      const tA = a.timestamp ? (a.timestamp.toMillis ? a.timestamp.toMillis() : Number(a.timestamp)) : Infinity;
      const tB = b.timestamp ? (b.timestamp.toMillis ? b.timestamp.toMillis() : Number(b.timestamp)) : Infinity;
      return tA - tB; // nhỏ hơn = lên trước = xếp cao hơn
    });

    return scores.slice(0, 10);
  } catch (error) {
    console.error("Lỗi khi lấy bảng xếp hạng:", error);
    return [];
  }
}

/**
 * Kiểm tra xem người dùng hiện tại có thuộc Top 1000 không
 * @param {string} gameId 
 */
export async function getMyRank(gameId = "xep-bong") {
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
      return index + 1; // Trả về thứ hạng (1 -> 1000)
    }
    return null;
  } catch (error) {
    console.error("Lỗi khi lấy thứ hạng cá nhân:", error);
    return null;
  }
}

/**
 * Lấy dữ liệu lưu trữ của người dùng hiện tại từ Firebase
 * @param {string} gameId 
 */
export async function getUserScoreFromFirebase(gameId = "xep-bong") {
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

// Gắn hàm vào window để game.js dễ dàng gọi
window.saveScoreToFirebase = saveScoreToFirebase;
window.getTopScoresFromFirebase = getTopScoresFromFirebase;
window.getMyRank = getMyRank;
window.getUserScoreFromFirebase = getUserScoreFromFirebase;
window.loginWithGoogle = loginWithGoogle;
window.logoutGoogle = logoutGoogle;
