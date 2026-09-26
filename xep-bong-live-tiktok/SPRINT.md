# QUẢN LÝ SPRINT & TIẾN ĐỘ THỰC HIỆN: XẾP BÓNG TIKTOK LIVE

> **Thư mục:** `xep-bong-live-tiktok/`  
> **Trạng thái tổng quan:** 🟡 ĐANG THỰC HIỆN (Sprint 1)

---

## 📌 QUY TRẮC & TÍNH NĂNG CHỐNG GIAN LẬN (Anti-Abuse)
- **Kiểm tra Unfollow / Spam Follow**:
  - Lưu danh sách `Set` / Array các `userId` / `username` khán giả đã Follow trong phiên live.
  - Khi phát sinh sự kiện Follow: Nếu `username` này đã được tính lượt Follow trước đó (hoặc spam unfollow rồi follow lại) -> **Bỏ qua không cộng màn**.
  - Chỉ cộng **+1 màn** cho các tài khoản Follow mới hoàn toàn trong buổi stream.

---

## 🚦 TRẠNG THÁI CÁC SPRINT

### 🟢 Sprint 1: Xây dựng Bảng Điều Khiển Streamer (`control.html`, `control.css`, `control.js`)
* **Trạng thái:** 🟢 ĐÃ HOÀN THÀNH (3/3 công việc)
* **Chi tiết công việc:**
  - [x] **1.1. Giao diện `control.html` & `control.css`**: Form nhập TikTok Live ID, Lịch sử ID, Thống kê Live HUD, Bộ nút thao tác (Tạm dừng/Tiếp tục, Cộng màn thủ công, Reset).
  - [x] **1.2. Công cụ Giả lập & Chống Spam Follow**: Nút Test Follow / Gift, Xử lý lọc danh sách `followedUsers` chống Unfollow spam để cộng màn.
  - [x] **1.3. Đồng bộ Real-time**: Xây dựng module `BroadcastChannel('tiktok_xep_bong_channel')` và lưu `localStorage`.

---

### 🟢 Sprint 2: Nâng cấp Giao diện Màn hình Game Display (`index.html` & `style.css`)
* **Trạng thái:** 🟢 ĐÃ HOÀN THÀNH (3/3 công việc)
* **Chi tiết công việc:**
  - [x] **2.1. Thanh HUD Live**: Hiển thị bộ đếm `Màn hiện tại: X / Tổng số màn: Y` trên giao diện game.
  - [x] **2.2. Banner Trạng thái**: Hiển thị Banner nổi bật khi streamer *"Tạm dừng nhận thử thách"*.
  - [x] **2.3. Popup Toast & Marquee Ticker**: Thêm Banner chữ chạy thông báo (Ticker) tùy chỉnh từ Bảng điều khiển và Popup Toast hiệu ứng khi cộng màn.

---

### 🟢 Sprint 3: Kết nối Đồng bộ Real-time & Logic Game (`game.js`)
* **Trạng thái:** 🟢 ĐÃ HOÀN THÀNH (2/2 công việc)
* **Chi tiết công việc:**
  - [x] **3.1. Lắng nghe BroadcastChannel**: Cập nhật tổng màn chơi, chữ chạy thông báo, trạng thái Tạm dừng từ `control.js` thời gian thực.
  - [x] **3.2. Logic Thắng & Kết nối HUD**: Cập nhật bộ đếm thử thách `1 / 50` thời gian thực và đồng bộ 2 chiều với Bảng điều khiển.

---

### 🟢 Sprint 4: Kết nối TikTok Live WebSocket Client & Kiểm thử (Testing)
* **Trạng thái:** 🟢 ĐÃ HOÀN THÀNH TẤT CẢ
* **Chi tiết công việc:**
  - [x] **4.1. TikTok Connector & Simulation**: Giả lập và sẵn sàng nhận kết nối dữ liệu thời gian thực.
  - [x] **4.2. Kiểm thử toàn diện**: Đồng bộ hoàn hảo 2 cửa sổ/tab trình duyệt qua BroadcastChannel + localStorage.

---

## 📝 NHẬT KÝ TIẾN ĐỘ (LOG)
- **2026-09-26**: Khởi tạo `SPRINT.md`, thêm quy tắc chống gian lận Unfollow -> Bắt đầu triển khai **Sprint 1**.
