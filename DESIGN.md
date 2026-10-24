---
name: 拾级
description: Read English at word level, one word at a time.
colors:
  gold-leaf: "#8a6410"
  warm-paper: "#f2efe8"
  deep-ink: "#1c1a15"
  white-card: "#fffefb"
  paper-edge: "#e6e2d8"
  muted-ink: "#6b6352"
typography:
  display-cn:
    fontFamily: "Shiji Brush, STKaiti, KaiTi, Songti SC, serif"
    fontSize: "clamp(104px, 20vw, 268px)"
    fontWeight: 400
    lineHeight: 0.86
    letterSpacing: "0.05em"
  display-latin:
    fontFamily: "Shiji Serif, Songti SC, Georgia, serif"
    fontSize: "clamp(19px, 2.5vw, 30px)"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.8
    letterSpacing: "normal"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0.24em"
rounded:
  card: "12px"
  article-card: "10px"
  field: "8px"
  pill: "20px"
  mark: "1px"
  round: "50%"
spacing:
  xs: "6px"
  sm: "10px"
  md: "20px"
  lg: "48px"
  section: "clamp(64px, 9vw, 132px)"
components:
  button-primary:
    backgroundColor: "{colors.gold-leaf}"
    textColor: "#fffdf5"
    typography: "body"
    rounded: "{rounded.field}"
    padding: "8px 22px"
  button-enter:
    backgroundColor: "{colors.deep-ink}"
    textColor: "#fffdf5"
    typography: "body"
    rounded: "3px"
    padding: "14px 26px 15px"
  icon-button:
    backgroundColor: "{colors.white-card}"
    textColor: "{colors.gold-leaf}"
    rounded: "{rounded.round}"
    size: "40px"
  card:
    backgroundColor: "{colors.white-card}"
    textColor: "{colors.deep-ink}"
    rounded: "{rounded.article-card}"
    padding: "12px"
  note-panel:
    backgroundColor: "{colors.warm-paper}"
    textColor: "{colors.deep-ink}"
    rounded: "{rounded.card}"
    padding: "20px 22px"
---

# Design System: 拾级

## Overview

**Creative North Star: "The Ruled Page"**

拾级 is a page from a Chinese exercise book: warm cream paper, faint gold rules, and a hand that looks written rather than rendered. The sentence being read is never a paragraph under a heading; it is a sheet of ruled paper with a live word on it. The design treats reading as a climb, so the layout is built from a stepped line and the bottom edge of a button — instead of boxes and dividers.

The world has two voices. The cover — the landing page and the article library — speaks at display scale with two curated faces shipped as files; the reader stays quiet and utilitarian on the system stack, because there the content is the user's own article and the chrome must not compete with it. Both are the same world: same paper, same ink, same gold, same hairline. The cover's own rules live in `web/cover.css`, so the reader's palette is never disturbed by the cover's.

Nothing is imitated. There is no texture image, no embossed metal, no gradient pretending to be light. Depth comes from one shadow used sparingly on paper panels, and contrast comes from the ink band at the end of the page. Gold is a line or a small solid mark, never the colour of running text.

**Key Characteristics:**

- Warm paper (#f2efe8) on the cover, with gold rules at 20% alpha every 24px on the ruled sheet.
- A single gold accent used as a line, a mark, and the lit word; never as body text.
- Two display faces served from `web/fonts/`: Ma Shan Zheng (楷书) for Chinese, Instrument Serif for Latin.
- Structure drawn with 1.5-2px rules, not with borders, dividers, or cards.
- One shadow vocabulary, reserved for panels that sit on the paper.

## Colors

A warm paper field, a dark brown-black ink, and one old-gold accent: the palette of a printed book with a gold bookmark.

### Primary
- **Gold Leaf** (#8a6410 on the cover): the accent. Focus rings, the light climbing the stair, the sweep under the active word, the left edge of the lookup card, the bottom rule of the enter button. It is deeper than the app's #b8860b so it clears 4.5:1 as text on the cover's paper (4.68:1). In dark mode it lifts to #d9a92e, which reads at 8.5:1 on #14140f.

### Neutral
- **Warm Paper** (#f2efe8): the page field on the cover. Ruled with Gold Leaf at 20% alpha every 24px on the demo sheet, in step with its 28px line height.
- **Deep Ink** (#1c1a15): text, the closing band's background, the primary enter button's fill.
- **White Card** (#fffefb): lookup panel, article cards, the app's round icon buttons.
- **Paper Edge** (#e6e2d8): hairline borders on panels and cards.
- **Muted Ink** (#6b6352): secondary text, taglines, hints, the lede. Never for anything the user must act on.

Dark mode swaps the paper for #14140f and cards for #21201a everywhere, including the reading page; the gold rises to #d9a92e and the ink becomes #ece7db. The cover's rule colour flips with it, so the ruled sheet survives the theme change.

### Named Rules
**The Gold Is A Line Rule.** On the cover gold is only a line: a 2px rule, the stair, a mark, the word underline, or a 2px edge that thickens on hover. It is never a fill there, and never the colour of a sentence. Inside the app there is one licensed fill, the primary button, so that the single act of leaving a view reads as a physical key. Any gold fill must carry text at 4.5:1 or better (dark mode's #16171b on #e0b552 measures 9.3:1 and is the model; light mode's paper-on-#b8860b measures 3.2:1 and is a known gap to correct, not a precedent). Gold never colours body text, running labels, or small icon glyphs; those use ink.

**The One Field Rule.** The cover has exactly one surface: the paper. Panels on it are white cards; nothing else is allowed to introduce a second background tone.

## Typography

**Display Font:** Ma Shan Zheng (Chinese, a 楷书 hand) and Instrument Serif (Latin), both shipped as woff2 and declared before any system serif. The Chinese face is a subset of 289 glyphs; the Latin one ships whole.
**Body Font:** the platform UI stack (-apple-system, Segoe UI, PingFang SC, Microsoft YaHei), at 17px/1.8.

**Character:** A brushed Chinese hand against a high-contrast Latin serif. The pairing reads as a calligraphic title page: the Chinese is a brush that wrote the name, the Latin is a printed book beneath it.

### Hierarchy
- **Display** (400, clamp(104px, 20vw, 268px), 0.86): the cover title 拾级, the section titles 读原文不是背单词 / 三阶, and the closing line 拾级而上. Letter-spacing 0.05em.
- **Display Latin** (400, clamp(19px, 2.5vw, 30px), 1.5): the English line under the title and the demo sentence, both set in the Latin display face.
- **Title** (400, clamp(24px, 2.6vw, 34px), 1.35): the three rung names, set in the Chinese display face.
- **Body** (400, 17px, 1.8): app text and landing prose; measure capped at 34em on rungs and 30em on the hero lede.
- **Label** (400, 12px, letter-spacing 0.24em): 一阶 / 二阶 / 三阶, SHIJI, card hints. Uppercase only for the Latin sub-mark.

### Named Rules
**The Shipped Face Rule.** Any text larger than 40px uses a face that ships in `web/fonts/`. A system serif is a fallback for a shipped face, never the face itself.

**The Quiet Chrome Rule.** The reader keeps the system UI stack. The display faces exist for the cover — the landing page and the article library — not for the tool.

## Layout

The cover is a single scrolling page, and its first viewport is one centred column: the title 拾级 in brush, a stair line beneath it, an English line, the lede, and the enter button. The stack is `min-height: calc(100dvh - 76px)` so the paper fills the screen, and the hero's own grid reserves the last row for the 逐词·逐句·逐篇 mark.

The stair is an SVG path, not a set of boxes: one line stepped seven times, with a second copy of the same path in gold whose dash offset travels, so the light climbing it is literally the same shape as the stair. It is the product's name drawn as a thing that moves.

The demo section is a ruled sheet: one English sentence, its words on the sheet, and a panel below that holds either the lookup card or the marked-translation card. The two cards share one grid cell (`grid-area: 1 / 1`), so swapping between them never pushes the layout around. The sheet's rules are 24px apart and its text is 28px, so the rules sit just under each line's baseline the way a real sheet does.

The three-rung section is a grid: heading left, one-line lede right-aligned on the same baseline, then three full-width rules. The rules all end on the right margin, which is what keeps the section framed instead of drifting.

The app is a different model: the library is `100dvh` with its own scrolling grid (`repeat(auto-fill, minmax(150px, 1fr))`), and the reader is a centred 860px column. Page padding is 24px 16px 64px in the reader and zero in the library. The vocabulary ledger follows the library: nav, editorial intro and search/sort stay put while only the word-card grid scrolls, so a long list never takes the search field with it.

### Named Rules
**The Page Fills First Rule.** The cover occupies the first viewport. If the flight and the title do not fit in one screen at 1440x780, the flight shrinks, not the whitespace.

**The Undrifted Rule.** Any section that steps must also close: stepped left edges are always paired with a shared right margin.

## Elevation & Depth

Flat by default. The cover has no shadow at all except the lookup card's; depth there comes from the ruled sheet, the gold stair, and finally the full-width ink band that ends the page. The app uses one shadow token (`0 2px 8px rgba(120, 105, 60, 0.12)`, dark `0 2px 10px rgba(0, 0, 0, 0.5)`) on panels, cards, and round buttons so they read as paper laid on the desk.

### Shadow Vocabulary
- **Panel rest** (`0 1px 2px rgba(28, 26, 21, 0.05), 0 12px 32px rgba(28, 26, 21, 0.07)` on the cover): white cards, note panels, the lookup card. No hover elevation on the cover.

### Named Rules
**The No Lift Rule.** On the cover, nothing grows a shadow on hover; hover changes a colour or a rule's length, never the height of the surface. The library's article card is the one exception: it lifts 2px and takes the shadow token, and the grid keeps 4px of top padding inside its scrollport so the lifted border is never clipped.

## Shapes

Corners are gently rounded paper: 12px on panels, 10px on article cards, 8px on fields and the gold button, 20px on the sentence-mode pill, 50% on icon buttons. The cover's exception is the enter button, a 3px near-square block: it is a step, not a pill.

The recurring line is 1.5-2px: the stair, the rung rules, the sheet's ruled lines, and the panel borders. The old 6x6px gold bullet is gone — the cover labels its steps with a gold 阶 mark instead.

### Named Rules
**The Step, Not A Pill Rule.** Buttons that enter a place (进入拾级) are near-square ink or paper blocks with a 2px gold bottom edge. Round shapes belong to icon buttons only.

## Components

### Buttons
- **Shape:** the enter button is a 3px-radius block, `padding: 14px 26px 15px`, with a 2px gold rule on its bottom edge at 60% opacity that goes to 100% and doubles in thickness on hover and `:focus-visible`.
- **Primary:** the app's confirm button is gold fill (#b8860b) with #fffdf5 text, 8px radius, `padding: 8px 22px`.
- **Icon:** 40px circle, white card fill, 1px paper-edge border, gold glyph; hover inverts to a gold fill with paper-coloured glyph.

### Cards / Containers
- **Corner Style:** 12px for note panels, 10px for article cards.
- **Background:** white card on panels; warm paper on the library grid.
- **Border:** 1px paper-edge, turning gold on article-card hover; the card lifts 2px, and the grid's 4px top padding keeps the lifted border inside the scrollport.
- **Internal Padding:** 12px cards, 20px 22px note panels.
- **Signature:** note panels carry the ruled-paper gradient (gold at 7% every 34px), which is the same rule rhythm as the cover's demo sheet at a smaller scale.

### Inputs / Fields
- **Style:** white fill, 1px paper-edge border, 8px radius, 16px text (avoids iOS zoom).
- **Focus:** 2px gold outline with 1px offset; no glow, no shadow change.

### Navigation
- **Library nav:** brand 拾级 in the system stack at 26px, with 首页, theme, settings and delete as 40px round buttons on the right. No underline on hover: the fill inverts. Settings opens a two-column paper sheet, not a second page: 900px max, z-index 130, a 168px left rule for API 设置 / 使用说明, and one scrolling content column.
- **Library tools:** 单词库 sits before 新建文章 as an outlined paper button with a small book glyph. Below 720px the label drops and it becomes a 36px square, so adding the entry never pushes the toolbar into a second row.
- **Ledger tools:** 拼写练习 sits to the left of the theme button, same outlined treatment, and collapses to an icon at 720px the same way. Every tool page therefore offers the next activity in the same visual register as its own header.

### The Word Ledger
The vocabulary page is a ledger, not a dashboard. Its top is editorial rather than card-based: a small gold eyebrow (`LEXICON · 生词簿`), the total in the serif face at 44–64px with tabular numerals, one line of lede, and a muted stats line (`累计点开 N 次 · 最近一条 …`). No stat tiles, no coloured KPI blocks.

Below it, one search field and a three-way segmented control (最近 / 高频 / A–Z) share a hairline with the result count. The grid is `repeat(auto-fill, minmax(240px, 1fr))`; each word is one paper card:

- **Word:** the serif face at 24px, allowed to break anywhere so a long compound cannot widen its column.
- **Count:** a small outlined capsule in the top-right corner; frequency is information, not a badge to compete with the word.
- **IPA / POS:** IPA in the phonetic face, part of speech as a muted gold chip. Both are omitted when the dictionary has neither.
- **Gloss:** at most three lines, with the full text in `title`. A word no source defined says 词典暂未收录释义 in italic, never an empty card.
- **Footer:** relative last-seen time on the left, a small circled 听 mark on the right. The whole card is one button that speaks the word, so there is no nested button; the mark is the affordance, not a second control.

Cards use the article card's 4px radius, 1px hairline and 2px hover lift, and the grid keeps 6px of top padding so the raised border is never clipped. Empty, no-match and read-error states all use the same centred block: a brush 词 mark, a serif title, one line of explanation, and a single action that changes with the state (去文章库 / 清空搜索 / 重试).

### The Spelling Drill
The drill is one sheet of dictation paper, not a dashboard of progress. Nav, the four-stop order slider and the theme button sit in the header; below them a single centred card holds the whole task: an eyebrow that names the order and the position (`最近 · 第 3 / 41 题`), the Chinese gloss set in the Chinese serif face at 22–30px, then the part-of-speech chip and the IPA — the IPA being a button, because hearing the word is part of spelling it.

The reveal is one grid on the stage, two rows of cells written from the same cell list, each row tagged with its `grid-row`. The column width comes from a single `--cell: 1.15ch` resolved against the stage's own font size — two rows each declaring `repeat(--cols, 1.1ch)` would drift apart the moment their sizes differ, and the correct word would stop sitting above the letters it is being compared with:

- **Top row:** the correct spelling at 0.86em — nearly the size of the reader's own letters, because it is the thing being learned — with the syllable separator `·` occupying its own column rather than sitting on top of a letter. It appears only when the answer was wrong; a correct answer gets no correction line at all, and the grid keeps a single row.
- **Bottom row:** the letters the reader typed. Matching letters are green, wrong letters red with a dotted underline, letters they left out stay as an empty dashed slot marked 缺, letters they added are struck through and marked 多. Blank cells hold the rows in register where the other row has a separator or an extra letter. Marks always sit under the answer row, since the correction line is above it.

Because the two rows share columns, an answer of the wrong length still lines up with the word it is judged against; nothing shifts and no colour moves to a letter the reader did not type. Colour is never the only signal: every state also carries an underline style, a strike-through, or a written 缺/多 mark, one line of legend names the two rows, and the result line repeats the score in words for a screen reader.

Submitting empties the field and returns focus to it, so the reveal reads as "look here", not "you are stuck here". That is the rule the whole page runs on: **The Next Keystroke Rule.** A reveal is a moment of reading, never a state the reader has to escape — typing dismisses it, clicking the letters hands the keyboard back to the field, and `3` or 重写 clears the line and starts the same word over without scoring anything. Enter scores an attempt; a second Enter on a correct card steps to the next word, and on a wrong card does nothing, because skipping the word you just missed is the one thing a drill must not do. Every action on the page ends with the caret in the field, so the keyboard is never left on a button.

The keys are `1`/`↑` and `2`/`↓` for the previous and next card, `` ` `` (and a bare Ctrl press) for the pronunciation, `3` for 重写 and Enter for 提交. Arrow keys are handed back to the caret whenever there is unsubmitted text in the field, Ctrl combos are never intercepted, and a bare Ctrl press ignores key repeat so holding it does not stammer.

The order control is four stops (最近 / 高频 / A–Z / 易错) under a sliding paper thumb. It is a group of buttons with `aria-pressed`, so it is keyboard-reachable and reads as a choice, while the thumb carries the "slider" affordance. Changing the order never moves the word on screen: the queue is rebuilt and the cursor re-anchored to the same word, so the new order takes effect from the next card. Its choice is stored under `english-app:spell-order` and survives a reload.

Under the card the actions sit centred in one row — 上一个 · 重写 · 提交 · 下一个, 提交 the only filled button — with the key legend, quieter, below them.

The warm palette gets exactly one new hue for this page — `--right` (#2f7a4d light, #7ac48f dark). `--wrong` deliberately reuses the existing -danger family rather than introducing a second red.

### The Settings Sheet
The settings sheet belongs to the reader's paper world, not a separate admin surface. Provider cards are paper cards separated by hairlines; switches are small 开/关 pills; model status is written text plus a muted gold/danger colour, never colour alone. The left rail is a rule, and on narrow screens it becomes a horizontal tab strip above the content. Every key is shown only as a mask (`sk-…abcd`) or a source label; the raw secret never enters the page.
- **Header buttons:** the reader's back arrow is the same round button as the theme toggle.
- **Browser tab:** the icon is the stair mark in gold on warm paper, shipped inline so it appears before any stylesheet loads. The title is always brand-first and names the view, never the article: 拾级 on the cover, 拾级 · 文章库, 拾级 · 单词库, 拾级 · 拼写练习, and 拾级 · 阅读 while reading — the last one being the prototype's own `<title>` wording. The article title belongs to the paper and the topbar, where the text it describes is on screen.

### The Speaker
The reader can read a sentence aloud, and the small speaker next to the sentence number is the control that starts it. The speaker sits right after the number because the two of them are the two things that act on a sentence, and a speaker floating at the end of a line belongs to nothing.

It is invisible until the sentence is hovered or focused. An article is a wall of sentences, and a wall of speaker icons is a wall of noise. On a touch screen, where there is no hover, it is always there: a button nobody can see is a button nobody finds.

The icon is drawn, never typed. A glyph like the speaker emoji renders differently on every platform and is announced by a screen reader before the button's own label.

### The Word Being Read
The word being said right now is the one thing on the page that moves without being asked. It takes the paper's flash colour, and the sentence number turns gold so there is a sign of the reading even when the engine does not report word positions.

The highlight is allowed to be absent. The engine reports where it is with a boundary event, and that event is not universal: Safari does not send it, and some Chrome voices send it sparsely. When it does not arrive, the sentence is still read and the number still turns gold. The position is never guessed, because a guessed highlight sends a reader's eyes to the wrong word.

### The Sentence-Part Tints
The grading panel marks a sentence's components with one background tint per role: 主 (blue), 谓 (amber), 宾 (green), 定 (violet), 状 (teal), 补 (rose), 表 (yellow), 同 (warm grey). Each tint has a stronger `--role-*-edge` used for a clause's dashed underline.

- The unit is a block — a whole noun phrase, adverbial phrase or clause — never one word at a time.
- Punctuation keeps the paper background. A clause's own components are expanded on a separate line below, rather than nested inside its fill.
- Every block carries a written corner label (主/谓/…/定从), so colour is never the only signal; the legend repeats all eight roles plus 从句.
- A corner label is one unbreakable mark: "定从" may move to the next line but never splits into "定" / "从". A clause row keeps its label and text on the same row, with the text wrapping at the right.
- The grading reply below the marks is a stack of fixed points. Model Markdown headings, bullets and one-paragraph numbering are all normalised before display, so the reading rhythm does not change between replies. The stored grading text is untouched.
- These are low-saturation paper washes, not new brand colours. Gold stays reserved for the live word and the primary action.

The reading page reuses the same eight tints, written corner marks, legend and clause expansion in its grading panel.

### The Margin Conversation
The reading page now carries the margin conversation, with the standalone prototype (`M:\Ai\project\shiji-reader`) kept as its static visual reference. It is a margin, not an app: no card surface in the column, a 22×2px gold mark over the title, a hairline under the header and above the composer, and the same paper/ink/gold tokens as the page.

- The header follows the sentence the reader last touched — looked up, practised, or read aloud. Before any touch it falls back to the scroll position and says 正在读; afterwards it says 最近一句 · 查词/翻译/朗读, and scrolling no longer rewrites it. Every message freezes its `第 NN 句` tag at send time.
- **The Recent Touch Rule.** The margin follows the sentence the reader last touched, not the scroll position. Scroll is only the initial fallback; the source is named beside the sentence number.

### The Article Editor
The paper header and the library share one title + body dialog. It is a paper sheet over a dimmed page, with a gold primary action and an inline error; the body is required, the title may be left blank (the first line is used). The same dialog creates from the library's “+” card or toolbar and edits from the reader's pencil button; saving re-renders the article without reloading the page.
- Replies are serif marginalia with a 2px gold-soft rule; reader messages are compact paper-deep blocks. The gold fill belongs to the one send button, not to the conversation.
- Below 960px the column becomes a paper drawer with a scrim. The topbar gains a 问 button; the page is inert while the drawer is open.
- **The Margin Stays Out Of The Prose Rule.** In paragraph mode the book's vertical margin rule is hidden. Sentences flow as prose, and a rule at the old gutter would cross the words.

### The Export Sheet
The weak-word list leaves the app as a Word document, never as a screenshot of the page. An “导出” control sits on the 卡住的词 heading line, right-aligned; it is disabled until the article has a clicked word, and it opens the same paper dialog grammar as the article editor.

- **Eight sheets, one action.** Every layout is rebuilt from a reference file rather than screenshotted: 彩色卡片 keeps the FLASHCARDS title, four-colour legend, instruction band and four-cell cards at eight per page; 经典绿 and 清新蓝 share the two-block No./Word/Meaning grid at fifty; 拼写测试 keeps its orange/teal two-way header at twenty-five; 艾宾浩斯 keeps the eight D1–D90 review columns; 高密度 and 经典完整 keep their column rules and header colours; 速查表 keeps the dark header and group bands. Gold stays reserved for the dialog's single confirm button.
- **Content is a choice, except where the sheet is a test.** 仅单词 keeps the word, IPA and part of speech; 仅中文 keeps the gloss; 单词 + 中文 keeps both, and the unselected side stays as an empty tinted cell. 拼写测试 locks that choice because its two halves are the exercise: left gives the word, right gives the meaning. No example sentences are invented; example columns stay blank.
- **The article stays out of the paper.** Each sheet keeps the template's own title and subtitle. The article name belongs to the download filename, not to the page.
- **Word only.** The sheet is a `.docx`; there is no PDF path and no print dialog to negotiate. The file name names the template and the date, and the export never writes back to the article.

## Do's and Don'ts

### Do:
- **Do** keep the cover to paper, ink, and gold. A new surface either sits on the paper as a white card or belongs in the app.
- **Do** draw structure with rules (1.5-2px) and let the gold mark the one thing that is live.
- **Do** ship display faces as woff2 and subset the Chinese face to the characters the page actually uses.
- **Do** cap display sizes against viewport height as well as width, and pair every stepped left edge with a right margin.
- **Do** keep the reading reachable: the speaker is a real button, it is reachable by keyboard, and the space bar stops the reading without taking the space bar away from a text field.

### Don't:
- **Don't** use gold for running text or small labels; pair the gold mark with ink text instead.
- **Don't** guard a click handler against the narrowest element type. The speaker is an SVG, and an SVG element is not an HTMLElement; a guard written that way throws the click away and the button silently does nothing.
- **Don't** put glyph icons on the cover. The mark is drawn (SVG); the app's ☀ ⚙ 🗑 glyphs are tolerated legacy chrome, not a pattern to copy.
- **Don't** add a kicker or eyebrow above any heading, or numbered 01/02/03 labels to sections that are not steps.
- **Don't** use gradient text, hard offset shadows, coloured side stripes, or a second background tone on the cover. The gold foil on the title is a mask over a solid colour, not a gradient fill.
- **Don't** put the app's system display font on a landing-page heading; the two display faces are the only large voices.
- **Don't** paint decoration above content: the ruled field sits on a negative layer (`isolation: isolate` on the stage, `z-index: -1` on the field) so it never crosses the panel or the words.
