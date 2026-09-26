# KẾ HOẠCH TRIỂN KHAI: GAME XẾP BÓNG TƯƠNG TÁC TIKTOK LIVE

> **Thư mục dự án:** `xep-bong-live-tiktok/`  
> **Mục tiêu:** Nâng cấp game Xếp bóng thành phiên bản tương tác TikTok Live dành cho Streamer, phân tách màn hình chơi game (OBS Display) và Bảng điều khiển dành riêng cho Streamer (Control Panel).

---

## 💡 1. NGUYÊN TẮC HOẠT ĐỘNG & TÍNH NĂNG CỐT LÕI

1. **Luồng chơi thử thách:**
   - Streamer bắt đầu từ **Màn 1**.
   - Số màn thử thách ban đầu mặc định là **50 màn** (có thể cấu hình lại trên Bảng điều khiển).
   - Tương tác từ khán giả TikTok Live (Follow / Tặng quà) **chỉ làm tăng tổng số màn thử thách** streamer phải chơi, không được bỏ qua màn hay bớt màn.
   - **Số màn không giới hạn 50**: Càng nhiều người tặng quà/follow thì số màn thử thách càng tăng lên (Ví dụ: Màn 12 / 68).

2. **Cơ chế Phân tách 2 Màn hình (Real-time Broadcast Sync):**
   - **Màn hình Game (`index.html`)**: Dùng cho khán giả xem trên Livestream/OBS. Giao diện sạch đẹp, hiển thị HUD tiến trình và Banner thông báo trạng thái.
   - **Trang Bảng Điều Khiển (`control.html`)**: Màn hình quản lý riêng cho Streamer để kết nối TikTok ID, điều chỉnh số màn, tạm dừng nhận thử thách, giả lập/theo dõi sự kiện TikTok Live.
   - **Đồng bộ thời gian thực**: Sử dụng `BroadcastChannel` (API trình duyệt) + `localStorage` để 2 tab/cửa sổ tự động đồng bộ tức thì.

3. **Nút "Tạm dừng nhận thử thách":**
   - Cho phép Streamer ngưng nhận thêm màn thưởng từ TikTok Live khi muốn chuẩn bị xuống live.
   - Hiển thị Banner nổi bật trên màn hình Game: *"Đã tạm dừng nhận thử thách! Streamer đang hoàn thành nốt các màn còn lại để xuống live."*

4. **Lưu lịch sử kết nối TikTok ID:**
   - Lưu danh sách các TikTok Username / Live ID đã từng nhập vào `localStorage` để kết nối lại nhanh chóng.

---

## 📐 2. KIẾN TRÚC TỆP DỰ ÁN (`xep-bong-live-tiktok/`)

```text
xep-bong-live-tiktok/
├── index.html              # Màn hình Game chính (OBS Display)
├── control.html            # Trang Bảng điều khiển dành riêng cho Streamer (MỚI)
├── control.css             # Style cho Trang Bảng điều khiển (MỚI)
├── control.js              # Logic điều khiển & đồng bộ sự kiện (MỚI)
├── game.js                 # Logic trò chơi Xếp bóng & nhận dữ liệu sync
├── style.css               # Style chung & HUD Live Display
├── PLAN.md                 # Tài liệu kế hoạch triển khai (File này)
└── README.md
```

---

## 📋 3. LỘ TRÌNH THỰC HIỆN CHI TIẾT (ROADMAP)

### **Giai đoạn 1: Xây dựng Trang Bảng Điều Khiển (`control.html` & `control.js`)**
- [ ] Thiết kế giao diện Dashboard Streamer (`control.html`, `control.css`) chuyên nghiệp, hiện đại:
  - **Khu vực 1: Kết nối TikTok Live**: Form nhập ID + Dropdown danh sách ID từng chơi (`localStorage`).
  - **Khu vực 2: Thống kê Live**: Tiến độ (`Màn hiện tại / Tổng màn`), Trạng thái (*Đang nhận* / *Đã tạm dừng*).
  - **Khu vực 3: Nút điều hướng & Thao tác**: 
    - Nút ⏸️ **Tạm dừng / ▶️ Tiếp tục nhận thử thách**.
    - Nút ➕ **Thêm thủ công số màn** (+1, +5, +10 màn).
    - Nút 🔄 **Đặt lại Thử thách** (Reset về Màn 1 / Mặc định 50 màn).
  - **Khu vực 4: Giả lập sự kiện TikTok (Live Simulation)**: Nút giả lập Viewer Follow (+1 màn), Tặng Quà (+N màn) kèm Bảng Nhật ký sự kiện (Event Log).
- [ ] Viết Module đồng bộ `BroadcastChannel('tiktok_xep_bong_channel')` trong `control.js` để bắn dữ liệu trạng thái sang màn hình Game.

### **Giai đoạn 2: Nâng cấp Màn hình Game chính (`index.html` & `game.js`)**
- [ ] Bổ sung UI HUD Live trên Màn hình Game (`index.html`):
  - Khung hiển thị tiến độ: `Màn hiện tại: X / Tổng số màn: Y`.
  - Banner thông báo trạng thái *"Tạm dừng nhận thử thách"*.
  - Popup/Toast thông báo khi có lượt Follow / Tặng quà mới cộng màn.
- [ ] Cập nhật `game.js`:
  - Lắng nghe channel `tiktok_xep_bong_channel` để cập nhật tổng số màn thử thách thời gian thực.
  - Xử lý luồng kết thúc: Khi thắng màn cuối cùng mà không còn màn thử thách nào phát sinh -> Hiển thị Màn hình Hoàn thành Thử thách Xuống Live.

### **Giai đoạn 3: Kiểm thử & Tối ưu hóa (Testing & Polish)**
- [ ] Kiểm thử mở song song `index.html` và `control.html` trên 2 tab/cửa sổ trình duyệt.
- [ ] Kiểm tra tính năng mở lại trình duyệt (khôi phục tiến trình từ `localStorage`).
- [ ] Tối ưu hóa hiệu ứng hình ảnh, thông báo trên stream.

---

## 🎯 4. QUY TRÌNH SỬ DỤNG CHO STREAMER

1. Streamer mở **`index.html`** và đưa vào nguồn quay Trình duyệt (Browser Source) trên OBS / TikTok Live Studio.
2. Streamer mở **`control.html`** ở màn hình thứ 2.
3. Nhập TikTok Username / Live ID trên Bảng điều khiển và bấm **"Bắt đầu Thử thách"**.
4. Trong lúc chơi:
   - Viewer Follow / Tặng quà -> Bảng điều khiển xử lý và tự động cộng màn vào game màn hình OBS.
   - Muốn nghỉ xuống live -> Bấm **"Tạm dừng nhận thử thách"**, game sẽ thông báo cho khán giả và streamer chơi nốt các màn còn thiếu để hoàn thành buổi live!
