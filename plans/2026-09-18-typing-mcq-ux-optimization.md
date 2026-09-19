# Plan — Tối ưu UX thẻ Typing & MCQ + Preview parity

- **Ngày:** 2026-09-18
- **Trạng thái:** đã triển khai xong — suite ALL GREEN, `--publish` = PUBLISH READY
- **Skill dùng:** `ui-ux-pro-max` (long-text measure, progressive disclosure, density/touch, dark mode, text reflow)

## Quyết định đã khóa

1. Cue-card dàn gần hết bề ngang nhưng chặn measure `min(100%, 68ch)`, căn trái (`text-wrap: pretty`).
2. Font câu hỏi giảm theo đề xuất `clamp(1.0625rem, 2.4vw, 1.4375rem)` (~17–23px), weight 800, line-height 1.3.
3. Bỏ hoàn toàn cơ chế hint (letter hint). Backup bản hiện tại trước để tham khảo/khôi phục.
4. Plan lưu trong `plans/`; backup trong `backups/` với tên rõ ràng.

## Backup

- `backups/2026-09-18_pre-ux-optimization_typing-mcq_has-hint/`
  - `Front.html`, `Back.html`, `_hna_typing.js`, `_hna_engine.js`, `_hna_styles_v7.css`
  - `mcq/_mcq_styles.css`, `preview/preview.html`, `mcq/preview/preview_mcq.html`
  - `README.md` mô tả: "bản trước tối ưu UX — còn hint, cue-card lớn".

## Nguyên tắc

- CSS một file dùng chung typing + mcq. `mcq/_mcq_styles.css` = head verbatim của `_hna_styles_v7.css` + block mcq; regen bằng `python3 /tmp/opencode/concat_css.py` (phải in `verbatim head match True`).
- Không hardcode màu; dùng token. Giữ bất biến: contrast WCAG AA, touch target ≥40/44px, monotonic type scale, motion contract, safety backdoor `#mcq-question-raw` / `.mcq-raw-ans`.

## Phase 1 — Preview typing parity

File: `preview/build-preview.js`.

- Toolbar 3 nhóm, KHÔNG shuffle: `Mặt Trước`/`Mặt Sau`; `Chế độ Tối (Dark Mode)`; `Mobile 375`/`Tablet 768`/`Desktop 1200`.
- State `face`; render `TPL_FRONT`/`TPL_BACK`.
- Back: set `window.__hnaTypedAnswerBuffer` bằng mẫu dài có 1 lỗi nhỏ để `_hna_diff.js` hiện visual diff.
- Night mode: gắn `night-mode` lên `<html>` và `<body>` trong srcdoc.
- Giữ converter `[sound:]` → `.replay-button`.

## Phase 2 — Thẻ Typing

File: `Front.html`, `_hna_styles_v7.css`, `_hna_typing.js`, `_hna_engine.js`, tests.

- **T1** `.meaning-row`/`.prompt-content`: `flex:1 1 auto; max-width:100%`, cap `min(100%, 68ch)`, `text-wrap: pretty`.
- **T2** `.prompt-content` font `clamp(1.0625rem, 2.4vw, 1.4375rem)`.
- **T3** audio (`{{audio_meaning}}`) cùng hàng POS badge; CSS row meta.
- **T4** placeholder: bỏ `min-width:0.8ch`/`margin:0 1px` char spans, bỏ `.word-group` padding, giảm font overlay `--fs-lg` → `--fs-md`; giữ `.word-group` cho word-level diff.
- **T5** giảm dọc: `.cue-card`, `.typing-area`, `.prompt-label`, `--typing-region-height`, `.type-input-wrapper min-height`.
- **T6** bỏ hint:
  - `Front.html`: xóa `#btn-hint`.
  - `_hna_typing.js`: xóa `_hintTier`/`_hintContainer`, `attachHintButton`, call.
  - `_hna_engine.js`: xóa `CtrlH`, action `clickBtn btn-hint`.
  - CSS: xóa `.btn-hint*`, `.typeans-hint-output`.
  - Tests: typing/ui/design/ram/tokens.
  - Giữ `.hint-reveal` ("Mer förklaring").
- **T7** `.type-input-wrapper` full width (bỏ `max-width:620px; margin:auto`).

## Phase 3 — Thẻ MCQ

File: `mcq/Front.html`, `mcq/Back.html`, CSS (chung hoặc block mcq).

- **M1** giảm dọc cue-card + `.mcq-area` margin.
- **M2** cue-card front == back (verify + test).
- **M3** `.verdict-banner` nhỏ hơn, giữ contrast AA.
- **M4** `{{#Explanation}}` → `<details class="expand-container">` + `expand-trigger` + `.expand-content`, đóng mặc định.

## Phase 4 — Tests, docs, publish

- Test mới/cập nhật cho T1–T7, M1–M4.
- Regen `mcq/_mcq_styles.css`; rebuild 2 preview.
- `node tests/run-all.js` ALL GREEN.
- Docs liên quan (`docs/BUG_LOG.md`, `ARCHITECTURE.md`, `docs/README.md`) nếu có mô tả hint/preview.
- `node tests/run-all.js --publish` khi được duyệt.

## Thứ tự

Backup → P1 → T6 → T1–T5,T7 → M1–M4 → tests/docs → preview → publish.

## Tiêu chí nghiệm thu

- Preview typing đủ toolbar, mặt sau hiện diff, dark mode, 3 kích thước, không shuffle.
- Prompt gọn, audio cùng hàng POS, typing area full width, placeholder không dàn, uttryck dài gọn.
- Hint biến mất hoàn toàn.
- MCQ cue-card nhỏ & bằng nhau 2 mặt; verdict nhỏ; explanation dropdown đóng mặc định.
- Suite ALL GREEN; preview rebuilt.

## Kết quả triển khai (2026-09-18)

- P1 preview parity: xong (`preview/build-preview.js`).
- T1–T7: xong. Hint xóa sạch khỏi template/JS/CSS/tests; `.hint-reveal` giữ nguyên.
- M1–M4: xong. Explanation chuyển sang `<details class="expand-container">` đóng mặc định.
- `verbatim head match True`; font prompt `clamp(1.0625rem, 2.4vw, 1.4375rem)`; `--typing-region-height: 64px`.
- `node tests/run-all.js`: preflight 26, unit 90, mcq 22, ram 17, design 78, ui 19 — 0 fail.
- `node tests/run-all.js --publish`: **PUBLISH READY** (đã stage + minify + re-test staged bundle, regen cả 2 preview từ bundle staged).

## Round 4 — Mobile/tablet UX (2026-09-18)

### Quyết định đã khóa (người dùng chọn tất cả phương án khuyến nghị)

1. Settings menu mobile → **popover nổi gọn** cạnh nút gear, auto-width, font/icon/toggle nhỏ hơn, touch ≥40px.
2. Back quá dài mobile → **ẩn mục phụ mặc định + giới hạn chiều cao ảnh + diff gọn**, vẫn cuộn cả trang.
3. Aurora → **khớp chính xác thẻ, mọi breakpoint**: lớp animation tỉ lệ theo kích thước thẻ (bỏ overhang cố định; overscan & quãng di chuyển chuyển sang % của layer box).
4. Diff dài → **kẹp 2 dòng + bấm mở rộng**.
5. Khối kéo lệch trái → **ép full-width toàn bộ khối nội dung chính** trên mobile.

### Thay đổi

- **CSS** (`_hna_styles_v7.css`, tier `≤768` source-last): bỏ override `.hna-aurora-host { ... fullscreen !important }`; `.swedish-word` → `--fs-xl`; `.prompt-content` bỏ cap `68ch` + `max-inline-size: 100%` + font nhỏ hơn; `.aurora-card` viền `--border-accent` 1.5px; `.settings-menu` `min(240px, calc(100vw - 24px))` + gradient accent giữ nguyên; `.menu-item`/`.menu-link` gọn; `.diff-row.diff-clamped` + `.diff-toggle`; `.recall-thumb img` `max-height`.
- **Aurora JS** (`_hna_aurora.js`, `mcq/_mcq_aurora.js`): bỏ bail `≤768` + wrapper `innerWidth > 768`; host luôn = rect card **chính xác** (không overhang); cả 4 đường re-sync chạy mọi breakpoint.
- **Aurora tỉ lệ** (`_hna_styles_v7.css`): `.aurora-bg` `inset: 0`; `.aurora-bg::before/::after` & `.aurora-bg--mid` overscan `-120px` → `-20%`; quãng di chuyển keyframe `hnaAuroraBase/Overlay/Mid` từ `px` → `%` của layer box → animation tự scale theo kích thước từng thẻ.
- **Diff JS** (`_hna_diff.js`): `applyDiffClamp()` thêm toggle 2 dòng (chỉ khi `matchMedia('(max-width:768px)')`, no-op trong jsdom).
- **Typing `Back.html`**: `#expand-info-details` bỏ `open` khi mobile.
- **MCQ explanation**: `.expand-content` alpha `0.06` → `0.14`.

### Kết quả

- RAM test host = rect card chính xác (500→500/34, 480→480/60).
- Test mới: 5 design pins + 1 unit (`applyDiffClamp`, harness expose).
- Regen `mcq/_mcq_styles.css` (`verbatim head match True`); rebuild 2 preview.
- `node tests/run-all.js`: preflight 26, unit 91, mcq 22, ram 17, design 83, ui 19 — **ALL GREEN**.

## Round 5 — Hiệu chỉnh Aurora / trục ngang mặt sau / nền giải thích (2026-09-18)

### Báo lỗi của người dùng

1. Lớp "glass" (`.glass-pseudo`) không khớp lớp nền aurora về vị trí/kích thước trên mobile + tablet (cả hai loại thẻ, cả hai mặt).
2. Mặt sau thẻ bị lệch sang phải, không căn giữa màn hình, mất thông tin một phần (mobile + tablet, cả typing lẫn MCQ).
3. Phần "phần giải thích thêm" nền bán trong suốt không cùng surface với đáp án.

### Thay đổi

- **Aurora host trượt theo thẻ** (`_hna_styles_v7.css` + `_hna_aurora.js` + `mcq/_mcq_aurora.js`): `.hna-aurora-host` từ `position: fixed` → `position: absolute`; vị trí ghi bằng tọa độ document `rect.left + window.pageXOffset` / `rect.top + window.pageYOffset` (host là `body.firstChild`, `body` tĩnh → cây chứa gốc của body, cuộn theo trang; không cần scroll listener, invariants RAM giữ nguyên). File JS typing và MCQ byte-identical.
- **Symmetric width mặt sau** (`_hna_styles_v7.css`): rule `.aurora-card.card-front` mở rộng thành `.aurora-card.card-front, .aurora-card.card-back` — cả hai mặt dùng đúng `width: min(848px, calc(100vw - 32px)); min-width: 0; max-width: min(848px, calc(100vw - 32px)); box-sizing: border-box; margin: auto;` → hình học mặt sau khớp y hệt mặt trước (đã biết căn giữa đúng) ở mọi breakpoint, không còn phụ thuộc `width: 100%`/`min-width: min(848px, 95vw)` tầng chung.
- **Nền giải thích đặc** (`_hna_styles_v7.css`): `.expand-content` `background: rgba(var(--aurora-accent-rgb), 0.14)` → `var(--surface-elevated)` (đục hoàn toàn cả 2 theme: `#F4F8F5` / `#16201A`); khớp bề mặt đáp án (nút `.mcq-option-btn` `background: transparent` trên glass). `backdrop-filter` vẫn bị cấm.

### Kết quả

- Level fix: `.hna-aurora-host` `position: absolute` (design pin mới); `.expand-content` `background: var(--surface-elevated)` + "không còn `rgba(var(--aurora-accent-rgb)`" (design pin mới `explanation plate is solid, matching the option-answer surface`).
- Design pin `baseline card widths` cập nhật: description/assert chuyển sang `.aurora-card.card-back` chia sẻ recipe `min(848px, calc(100vw - 32px))`.
- RAM test host geometry giữ nguyên (12/34/700/500, 60/480) — jsdom `pageXOffset` = 0 nên không cần sửa.
- Regen `mcq/_mcq_styles.css` (`verbatim head match True`, sha256 `f5f3ee0f...`); rebuild 2 preview.
- `node tests/run-all.js`: preflight 26, unit 91, mcq 22, ram 17, design 83, ui 19 — **ALL GREEN**. Publish chưa chạy (chờ nghiệm thu trên máy thật).

## Round 6 — Nền `.expand-content` theo glass (giống example / nút đáp án) (2026-09-18)

### Báo lỗi của người dùng

1. Thẻ typing: phần "extra information" (`.expand-content`) dùng nền đặc
   `--surface-elevated` bị **lệch tone** với phần còn lại — nên làm nền **giống
   `.example-box`**.
2. Thẻ MCQ: phần "GIẢI THÍCH CHI TIẾT" (`.expand-content`) phải có nền **giống
   màu nền của các nút ANSWER/DISTRACTION** (`.mcq-option-btn`).

### Phát hiện quan trọng

MCQ option buttons THỰC SỰ là `glass-pseudo` (`mcq/_mcq_logic.js` line 137:
`btn.className = 'mcq-option-btn glass-pseudo'`, line 228 thêm `is-static`) —
giả định ở Round 5 ("`.mcq-option-btn` `background: transparent` trên glass")
đúng, nhưng kết luận "dùng `--surface-elevated` đục" là **sai hướng**: user
muốn nền glass chứ không phải tấm đặc tối.

### Thay đổi

- **Template** (`Back.html` + `mcq/Back.html`): `<div class="expand-content">`
  → `<div class="expand-content glass-pseudo">`.
- **Typing** (`_hna_styles_v7.css`): `.expand-content` `background:
  var(--surface-elevated)` → `background: transparent` + đúng bộ glass knob của
  `.example-box` (`--glass-mesh-opacity: 0.20; --glass-sheen-alpha: 0.26;
  --glass-edge-alpha: 0.32; --glass-crown: 0.20; --glass-foot: 0.02;`) + shadow
  mềm giống example.
- **MCQ** (`mcq_block.css` → `mcq/_mcq_styles.css`): override
  `.mcq-area .expand-content` dùng đúng knob của `.mcq-option-btn`
  (`--surface-transparency-alpha: 0.55`, night `0.75` + `--glass-foot: 0.2`),
  `border: none`, `border-radius: var(--radius-md)`. `.mcq-area
  .expand-content .giaithich` cũng đổi sang `color: var(--text-primary)` (bỏ
  rail blob trái + padding chung) cho khớp màu chữ với nút ANSWER/DISTRACTION.
  `backdrop-filter` vẫn bị cấm.

### Kết quả

- Design pin cũ được thay bằng pin mới: `'design: explanation plate is a glass
  surface matching the example-box (typing) / option buttons (mcq)'` — assert
  `background: transparent`, không còn `--surface-elevated`, có glass crown
  knob, và class `glass-pseudo` trong `Back.html`.
- Regen `mcq/_mcq_styles.css` (`verbatim head match True`, sha256
  `c49eebcc...`); rebuild 2 preview.
- `node tests/run-all.js`: preflight 26, unit 91, mcq 22, ram 17, design 83,
  ui 19 — **ALL GREEN**. Publish chưa chạy (chờ nghiệm thu trên máy thật).

## Round 7 — Mobile: gắn lớp aurora với card glass (theo scroll + khớp góc) (2026-09-18)

### Báo lỗi của người dùng

1. Kéo thả chữ trên điện thoại thì **card glass (glass-pseudo) chạy theo mà
   lớp aurora đứng yên** — hai lớp tách nhau khi cuộn.
2. Trên mobile, **2 góc trên của hai lớp lệch nhau** (thấy hai cung bo góc
   chồng lên nhau) — chỉ thấy ở top vì card cao hơn màn hình.

### Phát hiện quan trọng

1. **Scroll container thật là `body`, không phải window**: `html, body {
   height: 100%; overflow-y: auto }` khiến điện thoại cuộn bên trong `body`;
   `window.pageXOffset/pageYOffset` luôn = 0. Host `position: absolute` mà
   `body` không được `position` → containing block là **ICB** → host đứng yên
   trong viewport trong khi card (trong luồng `body`) cuộn lên.
2. **`clip-path` không theo `border-radius` trên mobile**: base `.aurora-card`
   giữ `clip-path: inset(0 round var(--radius-lg))` (32 px); ≤768/≤480 chỉ đổi
   `border-radius` sang `--radius-md` (16 px) mà không override `clip-path`.
   Silhouette thật (do clip-path thắng) = 32 px trong khi host copy
   `border-radius` = 16 px → hai góc lệch.
3. `body { position: relative }` **an toàn**: `.btn-settings` / `.settings-menu`
   là `position: fixed`; `#correct-answer` ẩn; `body::before` fixed.

### Thay đổi

- **CSS** (`_hna_styles_v7.css`): base `body` thêm `position: relative` → body
  thành containing block của host, host absolute lồng trong `body` tự cuộn
  theo card trên máy thật (nhóm hai lớp vào cùng scroll context) — **không
  cần scroll listener** (ngân sách listener giữ nguyên: 4 document / 1
  window resize).
- **JS** (`_hna_aurora.js` + `mcq/_mcq_aurora.js`, giữ byte-identical bằng
  `cp`): toạ độ host chuyển từ `rect + window.pageXOffset/pageYOffset` sang
  content coords theo `body`:
  `left = rect.left - bodyRect.left + body.scrollLeft`,
  `top = rect.top - bodyRect.top + body.scrollTop`.
  Công thức đúng cho cả hai trường hợp (window cuộn → bodyRect dịch chuyển,
  `body.scroll*` = 0; body tự cuộn → bodyRect cố định, `scroll*` tăng).
  Trong jsdom `bodyRect` = toàn-0 và `scroll*` = 0 nên các assert `'12px'` /
  `'34px'` cũ vẫn đúng.
- **CSS** (≤768 + ≤480 `.aurora-card`): thêm `clip-path: inset(0 round
  var(--radius-md)); -webkit-clip-path: inset(0 round var(--radius-md));` để
  silhouette bằng đúng `border-radius`. Desktop giữ `--radius-lg`.

### Kết quả

- RAM test mới `'ram: aurora host translates the rect into body content coords
  (body is the scroll container)'` (ram 18) — stub rect + `body.scrollTop =
  100`, assert `top = 130 - 0 + 100 = '230px'`.
- Design pin mới `'design: body is the aurora host containing block — relative
  body + mobile clip-path matches radius'` (design 84) — pin `body { position:
  relative }` và clip-path == border-radius ở ≤768/≤480.
- Giữ pin cũ: `.hna-aurora-host` vẫn `position: absolute`, không có override
  fullscreen ≤768.
- Rebuild 2 preview. `node tests/run-all.js`: preflight 26, unit 91, mcq 22,
  ram 18, design 84, ui 19 — **ALL GREEN**. Chưa publish (chờ nghiệm thu máy
  thật cho Round 7 và MCQ Round 6).

## Round 8 — Mobile back: hero = cỡ câu hỏi cue-card, metadata 1 hàng, diff nhỏ hơn (2026-09-18)

### Báo lỗi của người dùng

1. Mặt sau typing trên mobile: hero (`.swedish-word`) **to hơn** câu hỏi
   trong cue-card mặt trước.
2. POS / IPA / nút replay bị đẩy thành **3 hàng riêng** thay vì cùng 1 hàng.
3. Visual diff **vẫn còn to**; hero mặt sau + chữ diff phải **xuống dòng
   nguyên cả chữ** (dàng hết hàng ngang rồi mới xuống).

### Thay đổi

- `.swedish-word` (≤768) `font-size: var(--fs-xl)` → `clamp(0.9375rem, 3.8vw,
  1.25rem)` — **đúng bằng** clamp của `.prompt-content` mặt trước.
- `.word-meta .ipa` (≤480) bỏ `flex-basis: 100%` → `flex: 0 1 auto;
  min-width: 0; white-space: nowrap`; `.pos-badge` thêm `white-space: nowrap`
  → pos/IPA/replay trên một hàng, wrap theo đơn vị cả chữ khi hết chỗ.
- `.diff-row-correct`: `--fs-md` → `--fs-sm`; `.diff-row-typed`: `--fs-sm` →
  `--fs-2xs` (cả base lẫn reassert ≤768).
- `overflow-wrap: anywhere` → `break-word` trên `.swedish-word` + 2 diff rows;
  `.swedish-word` bỏ `text-wrap: balance` → `normal` (hết hàng mới xuống).

### Kết quả

- Design pin mới + cập nhật pin hero cũ → design 85. Rebuild 2 preview.
- `node tests/run-all.js`: preflight 26, unit 91, mcq 22, ram 18, design 85,
  ui 19 — **ALL GREEN**. Chuẩn bị publish.

## Publish — 2026-09-18 (Round 6–8)
