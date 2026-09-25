import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { getFirestore, doc, getDoc, collection, getDocs, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

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

/** Lấy thông tin Hạng của thiết bị hiện tại trong Top Bảng xếp hạng game */
export async function getMyLeaderboardRank(gameId = "xep-bong") {
  try {
    const devId = localStorage.getItem('captain_device_id');
    if (!devId) return null;

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
      return a.moves - b.moves;
    });

    const index = scores.findIndex(s => s.deviceId === devId);
    if (index !== -1 && index < 10) {
      return {
        rank: index + 1,
        level: scores[index].level,
        moves: scores[index].moves,
        name: scores[index].name
      };
    }
    return null; // Không nằm trong Top 10
  } catch (err) {
    console.error("Lỗi khi kiểm tra thứ hạng:", err);
    return null;
  }
}

window.getMyLeaderboardRank = getMyLeaderboardRank;
