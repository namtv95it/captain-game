import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, query, orderBy, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBPRP43YeHZOyYzq_wpJDX7XoHJhgor2IE",
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

// Khởi tạo/Lấy Device ID định danh cho thiết bị này
function getDeviceId() {
  let devId = localStorage.getItem('captain_device_id');
  if (!devId) {
    devId = 'dev_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
    localStorage.setItem('captain_device_id', devId);
  }
  return devId;
}

/**
 * Lưu/Cập nhật điểm kỷ lục người chơi lên Firestore theo thiết bị (Device ID)
 * @param {string} name 
 * @param {number} level 
 * @param {number} moves 
 * @param {string} gameId 
 */
export async function saveScoreToFirebase(name, level, moves, gameId = "xep-hinh") {
  try {
    const deviceId = getDeviceId();
    const docRef = doc(db, `leaderboard_${gameId}`, deviceId);

    // Kiểm tra kỷ lục cũ của thiết bị này trên Firebase
    const existingDoc = await getDoc(docRef);
    if (existingDoc.exists()) {
      const oldData = existingDoc.data();
      const oldLevel = Number(oldData.level) || 0;
      const oldMoves = Number(oldData.moves) || Infinity;

      const newLevel = Number(level) || 1;
      const newMoves = Number(moves) || 0;

      // Nếu điểm mới không vượt qua kỷ lục cũ -> chỉ cập nhật lại Tên nếu tên thay đổi
      if (newLevel < oldLevel || (newLevel === oldLevel && newMoves >= oldMoves)) {
        if (name && name !== oldData.name) {
          await setDoc(docRef, { name: name }, { merge: true });
        }
        return { success: true, updated: false, msg: "Kỷ lục cũ tốt hơn!" };
      }
    }

    // Cập nhật kỷ lục mới
    await setDoc(docRef, {
      deviceId: deviceId,
      name: name || "Chưa cập nhật",
      level: Number(level) || 1,
      moves: Number(moves) || 0,
      timestamp: serverTimestamp()
    });

    return { success: true, updated: true };
  } catch (error) {
    console.error("Lỗi khi lưu điểm:", error);
    return { success: false, error };
  }
}

/**
 * Lấy danh sách Top 10 cao thủ từ Firestore theo từng Game
 * @param {string} gameId
 */
export async function getTopScoresFromFirebase(gameId = "xep-hinh") {
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

    // Sắp xếp phụ theo số bước (moves) tăng dần ở Client-side để không yêu cầu Index
    scores.sort((a, b) => {
      if (b.level !== a.level) {
        return b.level - a.level;
      }
      return a.moves - b.moves;
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
export async function getMyRank(gameId = "xep-hinh") {
  try {
    const devId = localStorage.getItem('captain_device_id');
    if (!devId) return null;

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
      return a.moves - b.moves;
    });

    const index = scores.findIndex(s => s.deviceId === devId);
    if (index !== -1) {
      return index + 1; // Trả về thứ hạng (1 -> 1000)
    }
    return null;
  } catch (error) {
    console.error("Lỗi khi lấy thứ hạng cá nhân:", error);
    return null;
  }
}

// Gắn hàm vào window để game.js dễ dàng gọi
window.saveScoreToFirebase = saveScoreToFirebase;
window.getTopScoresFromFirebase = getTopScoresFromFirebase;
window.getMyRank = getMyRank;
