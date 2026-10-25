# HNA True-False Note Type

A variant of the HNA note type optimized for True-False drills (beta). It retains the entire color variable system, Aurora visual effects, and glassmorphic UI of the HNA `v7` ecosystem.

## Fields (Data Schema)

You **must** use exactly these fields (plus any optional tags):

1. **Question**: The main query. (Supports HTML, MathJax).
2. **Statement-1** … **Statement-4**: The four statements to judge.
3. **Answer-1** … **Answer-4**: Truth per statement. `T`/`TRUE`/`1`/`D`/`Đ`/`ĐÚNG`/`Y`/`YES`/`+` count as ĐÚNG; `F`/`FALSE`/`0`/`S`/`SAI`/`N`/`NO`/`-` count as SAI. Empty truth skips the slot; any other token fails closed (static fallback stays, no interactive rows).
4. **Explanation**: Detailed answer explanation shown on the back side.

## Interaction

- Each statement row has two halves: **ĐÚNG** (left) / **SAI** (right), exposed as radio buttons.
- The **KIỂM TRA** button stays disabled until every statement is answered; re-clicking the same side keeps the answer, the other side switches.
- The back re-renders the stored row order, flags the correct side with ✓, a wrong pick with ✗, and lists misses in đề order (`Câu 2: đáp án SAI — bạn chọn ĐÚNG`); unanswered rows say `chưa trả lời`.
- Keyboard on the front: `1`–`4` focus a row, `T`/`F` answer it, arrows move. Modifiers, editable targets, composing and `Space` are ignored.

## Setup in Anki

1. Open Anki -> Tools -> Manage Note Types -> Add -> Clone: Basic -> Name it "HNA TF".
2. Edit its Fields to match the fields above (order matters). (Or map them correctly in the template).
3. Open Cards...
4. Paste the content of `Front.html` to the Front Template.
5. Paste the content of `Back.html` to the Back Template.
6. Check your `collection.media` folder for the required fonts (`_Inter.ttf`, `_JetBrainsMono.ttf`) and make sure you paste the content of `_tf_styles.css` in the Styling tab.

Enjoy fully graded True-False reviews with native multi-platform instant card flipping and audio feedback!
