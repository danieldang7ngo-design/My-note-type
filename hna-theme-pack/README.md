# HNA Theme Pack — v7

## 1. Audit biến màu

Đã đối chiếu toàn bộ biến màu khai báo trong `:root` / `.night-mode` của
`_hna_styles_v6.css` với schema mà `amber-blaze.json` (theme duy nhất có sẵn)
đang cover. `amber-blaze.json` gốc chỉ khai 7 biến/mode
(`--aurora-1/2/accent` + rgb, `--sweden-blue`) — bỏ sót **14 biến màu độc lập**
khác mà CSS có định nghĩa riêng cho light/dark: `--bg-base`,
`--aurora-card-base`, `--text-primary/secondary/muted`, `--surface-glass/
elevated/card`, `--cue-card-bg`, `--typeans-bg/typeans-bg-focus`,
`--glass-tint-rgb`, `--caret-glow`, `--sweden-yellow` (+rgb).

→ Đã bổ sung đủ 21 biến/mode cho **tất cả 31 theme** (30 theme mới +
`amber-blaze.json` được nâng cấp, giữ nguyên màu gốc bạn đã chọn, chỉ thêm
phần còn thiếu).

**Cập nhật (v7 sync qua `recompute_themes.py`):** 31 theme đã được chạy lại để
bám đúng token contract của `_hna_styles_v7.css`:
- Bỏ 3 key đã chết trong v7: `--cue-card-bg`, `--typeans-bg`,
  `--typeans-bg-focus` (không còn trong `:root`/`.night-mode`).
- Thêm `--glass-lift-rgb` (light: mix trắng với `--aurora-1` 30%; dark: mix đen
  với `--aurora-1` 35%) — giờ mỗi mode có **24 biến**.
- Các token glass/surface giờ được dẫn xuất từ palette của từng theme thay vì
  hardcode: `--glass-tint-rgb` = `--aurora-1`, `--aurora-card-base` (light) =
  mix(`--bg-base`, `--aurora-2`, 28%), `--surface-glass/elevated` =
  `rgba(var(...), alpha)`. Riêng `--surface-card` ghi **triplet literal** của
  card base (vd `rgba(210, 221, 228, 0.92)`) — vì `rgba(var(--aurora-card-base),
  a)` với var là hex sẽ fail legacy parsing trong QtWebEngine cũ sau khi thay
  thế biến.
- `apply_theme.py` tự sinh 3 token mesh nền (`--aurora-mesh-blobs`,
  `--aurora-mesh-curtain`, `--constellation-layer`) qua hàm
  `build_mesh_css_vars()` từ `--aurora-1/--aurora-2/--aurora-accent` và
  `--blob-a/b/c/d-rgb` — theme JSON không cần (và không nên) khai báo chúng.
  Chạy lại `recompute_themes.py` sau khi sửa palette để cập nhật báo cáo
  tương phản.

**Cập nhật:** đã bổ sung thêm `--blob-a/b/c/d-rgb` (4 màu blob góc mesh nền —
đồng thời chính là 4 màu dùng cho phần "khúc xạ cạnh" ở `::after` của
`.cue-card/.recall-card/.card-tags/.type-input-wrapper`, vì CSS tái dùng
chung 4 biến này cho cả hai chỗ) vào toàn bộ 31 theme. Thay vì gán 4 màu
cầu vồng cố định giống hệt nhau ở mọi theme, mình giữ đúng "công thức" gốc
của bộ blob mặc định — 4 hue lệch nhau 1 khoảng cố định (~39°/98°/191°/246°)
so với `--aurora-accent` — rồi xoay cả bộ theo hue riêng của từng theme. Nhờ
vậy 4 góc mesh + viền khúc xạ luôn "ăn" với màu chủ đạo của theme đó thay vì
là một dải cầu vồng vô can hệ dán lên trên.

**Chủ ý KHÔNG đưa vào theme JSON** (giữ cố định, không theme-hoá), kèm lý do:
- `--diff-correct/wrong/fixed/orange-*` (màu phản hồi gõ đúng/sai) — đây là
  màu ngữ nghĩa (xanh=đúng, đỏ=sai...) nên cố ý giữ cố định giữa các theme để
  người dùng không bị "học lại" tín hiệu màu mỗi lần đổi theme.
- Các bóng đổ trắng/đen mờ dùng làm lớp "gloss" kính (vd
  `rgba(255,255,255,0.1)` trên `.aurora-card::before/after`, viền sáng
  `.btn-settings`...) — đây là hiệu ứng ánh sáng trung tính chuẩn của mọi theme
  kính (glassmorphism), không phải màu thương hiệu.

## 2. Hardcode đã fix trong `_hna_styles_v7.css`

Tìm thấy 2 chỗ màu bị hardcode thật sự (không qua biến nào cả) trong phần
*rule* (ngoài phần khai báo token ở đầu file):

1. `rgba(19, 33, 31, 0.10)` — xuất hiện ở box-shadow của `.btn-settings`
   (2 chỗ: desktop dòng ~975 và mobile media query dòng ~2198). Đây là một bộ
   rgb "mồ côi", không khớp với bộ `rgba(36, 31, 25, ...)` mà toàn bộ hệ
   `--shadow-*` còn lại đang dùng — nhiều khả năng là gõ nhầm/sót lại từ bản cũ.
2. `color: #fff;` trên `#typeans-overlay` — màu chữ hardcode cứng, không qua
   biến.

**Đã fix:** thêm 2 token mới `--shadow-ink-rgb` (36,31,25 ở light /
0,0,0 ở dark) và `--typing-overlay-text` (#FFFFFF cả 2 mode), rồi thay TOÀN
BỘ các chỗ `rgba(36, 31, 25, ...)` / `rgba(19, 33, 31, ...)` / `color: #fff`
bằng `var(...)`. Giá trị hiển thị ra không đổi (vẫn y hệt bản v6) — chỉ khác
là giờ mọi màu bóng đổ đều gọi chung 1 biến, và không còn literal nào lọt
ra ngoài phần token gốc nữa. Hai biến mới này để mặc định (không đưa vào 30
theme JSON) vì chúng là hiệu ứng bóng/chữ trung tính, không phải màu thương
hiệu — nhưng bạn có thể ghi đè trong bất kỳ theme JSON nào nếu muốn.

## 3. 30 theme mới

Mỗi theme là 1 câu chuyện/hình ảnh riêng (không lặp mô-típ "X rực rỡ" như
mẫu cũ), phủ đủ 24 biến màu/mode (21 biến ở bản đầu + 4 màu blob góc mesh/
khúc xạ cạnh mới bổ sung, − 3 key đã chết ở v7, + 1 `--glass-lift-rgb`), đã
kiểm tra:
- Không trùng tên file (slug) hay đụng hue quá gần `amber-blaze` (~30°) hoặc
  theme mặc định (xanh lá, ~152–160°) — những theme có hue gần đó (vd
  `clay-desert`, `charcoal-ink`, `mint-frost`, `jade-court`) được tách biệt
  bằng độ bão hoà/nền trung tính khác hẳn để không bị "lai" cảm giác.
- Độ tương phản chữ/nền: tất cả đều ≥ 15:1 (vượt xa chuẩn AAA 7:1), cả
  light lẫn dark, cả trên `--bg-base` lẫn `--aurora-card-base`.

| Slug | Tên | Câu chuyện |
|---|---|---|
| `amber-blaze` | Amber Blaze | Cam hoang hon ruc ro |
| `arctic-ice` | Băng Cực Bắc | Ánh sáng trắng xanh phản chiếu trên tảng băng trôi |
| `brass-clockwork` | Đồng Thau Bánh Răng | Cỗ máy cổ chạy đều dưới lớp bụi thời gian |
| `charcoal-ink` | Mực Tàu Than Củi | Nét bút lông đen tuyền lướt trên giấy dó trắng |
| `cherry-neon` | Neon Anh Đào Phố Đêm | Biển hiệu hồng rực trên con phố mưa ướt |
| `citrus-zest` | Vỏ Chanh Vàng Nắng | Mùi the mát bung ra khi dao lướt qua vỏ trái |
| `clay-desert` | Đất Nung Sa Mạc | Bụi đất khô nứt dưới cái nắng gắt trưa hè |
| `coral-dawn` | San Hô Bình Minh | Ánh nắng đầu ngày nhuộm hồng mặt biển |
| `crimson-opera` | Nhung Đỏ Sân Khấu | Tấm màn nhung đỏ thẫm trước giờ mở màn |
| `denim-worn` | Vải Bò Sờn Cũ | Chiếc quần jean bạc màu qua bao mùa mặc |
| `ember-coal` | Than Hồng Cuối Lò | Đốm lửa cam đỏ le lói giữa đêm lạnh |
| `fern-forest` | Rừng Dương Xỉ Ẩm | Hơi ẩm và mùi đất sau cơn mưa rừng |
| `golden-wheat` | Lúa Mì Chín Vàng | Cánh đồng óng ánh trước mùa gặt tháng chín |
| `honey-amber` | Mật Ong Rừng Già | Giọt mật sánh vàng chảy chậm trên vách tổ |
| `jade-court` | Ngọc Bích Cung Đình | Chiếc vòng cẩm thạch mát lạnh trên cổ tay hoàng hậu |
| `lavender-dusk` | Oải Hương Chạng Vạng | Cánh đồng tím ngát lúc mặt trời khuất núi |
| `midnight-navy` | Hải Quân Nửa Đêm | Boong tàu tối om giữa đại dương không trăng |
| `mint-frost` | Bạc Hà Sương Giá | Lá bạc hà giòn tan trong ly nước đá buổi trưa |
| `olive-grove` | Vườn Ô-liu Địa Trung Hải | Hàng cây lặng lẽ dưới nắng chiều Nam Âu |
| `orchid-secret` | Phong Lan Bí Ẩn | Loài hoa hiếm chỉ nở trong hốc đá sâu rừng |
| `peach-blossom` | Đào Phai Tháng Giêng | Cánh đào mỏng manh run trong sương sớm |
| `plum-velvet` | Nhung Mận Chín | Trái mận tím thẫm vừa hái còn ướt sương |
| `rose-quartz` | Thạch Anh Hồng | Khối đá hồng nhạt trong suốt dưới nắng bàn |
| `sage-quiet` | Xô Thơm Tĩnh Lặng | Bụi cây khô mọc ven đường mòn vắng người |
| `seafoam-tide` | Bọt Sóng Thủy Triều | Bong bóng trắng vỡ tan trên bờ cát ướt |
| `spring-meadow` | Đồng Cỏ Non Tháng Tư | Sương đêm còn đọng trên thảm cỏ mới nhú |
| `storm-slate` | Đá Phiến Trước Bão | Bầu trời xám xịt báo hiệu cơn giông sắp tới |
| `sunset-mesa` | Cao Nguyên Hoàng Hôn | Vách đá đỏ rực dưới ánh chiều tà miền Tây |
| `teal-harbor` | Bến Cảng Xanh Cổ Vịt | Nước biển sẫm màu nơi con tàu cũ neo đậu |
| `violet-storm` | Giông Tím Cuối Trời | Tia chớp xé toạc bầu trời tím sẫm |
| `wine-cellar` | Hầm Rượu Vang Cổ | Mùi gỗ sồi và rượu ủ lâu năm trong bóng tối |

## 4. Cách dùng

Copy `_hna_styles_v7.css` đè lên file CSS cũ trong `collection.media` (đổi
tên lại thành đúng tên file cũ nếu note type của bạn đang trỏ tới tên khác),
copy `apply_theme.py` + toàn bộ thư mục `themes/` vào cùng chỗ bạn đang chạy
script hiện tại (không cần sửa gì `apply_theme.py`, nó tự đọc mọi key trong
JSON theme, không hardcode danh sách biến; riêng 3 token mesh nền thì tự sinh
mỗi lần áp theme qua `build_mesh_css_vars()`, xem mục 1). Sau đó
`python3 apply_theme.py` như cũ. Nếu bạn sửa màu trong bất kỳ theme JSON nào,
chạy lại `python3 recompute_themes.py` trong `hna-theme-pack/` để cập nhật
các token dẫn xuất và báo cáo tương phản (script này đọc whitelist trực tiếp
từ `_hna_styles_v7.css` gốc ở thư mục cha, không hardcode danh sách biến).
