# HNA MCQ Note Type

A variant of the HNA note type optimized for Multiple Choice Questions (MCQ). It retains the entire color variable system, Aurora visual effects, and glassmorphic UI of the HNA `v7` ecosystem.

## Fields (Data Schema)

You **must** use exactly these 6 core fields (plus any optional tags):

1. **Question**: The main query. (Supports HTML, MathJax).
2. **Answer 1 (CORRECT)**: **Always put the right answer here.** The engine randomly shuffles it during review.
3. **Answer 2 (Distractor 1)**: First wrong choice.
4. **Answer 3 (Distractor 2)**: Second wrong choice (optional).
5. **Answer 4 (Distractor 3)**: Third wrong choice (optional).
6. **Explanation**: Detailed answer explanation shown on the back side.

## Setup in Anki

1. Open Anki -> Tools -> Manage Note Types -> Add -> Clone: Basic -> Name it "HNA MCQ".
2. Edit its Fields to match the 6 fields above exact names don't matter, but their **order matters**. (Or map them correctly in the template).
3. Open Cards...
4. Paste the content of `Front.html` to the Front Template.
5. Paste the content of `Back.html` to the Back Template.
6. Check your `collection.media` folder for the required fonts (`_Inter.ttf`, `_JetBrainsMono.ttf`) and make sure you paste the content of `_mcq_styles.css` (or `_hna_styles_v7.css`) in the Styling tab.

Enjoy fully randomized MCQ reviews with native multi-platform instant card flipping and audio feedback!