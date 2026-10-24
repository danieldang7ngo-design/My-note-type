#!/usr/bin/env python3
"""Theme pack ↔ styling contract check.

Guards `apply_theme.py` against future edits to the CSS or to the themes:

  1. every token a theme overrides still exists in the styling token block
     (`:root` for light, `.night-mode` for dark) — renaming a token in the CSS
     without updating the themes is exactly the silent breakage this catches;
  2. every theme in `themes/` still builds a CSS block (mesh generation, value
     formatting) without raising;
  3. applying a theme then stripping it returns the styling byte-for-byte;
  4. switching themes repeatedly never stacks blocks (one block, always);
  5. a block whose END marker was lost is removed instead of surviving as dead
     CSS.

Run directly (`python3 hna-theme-pack/verify_theme_contract.py`) or from the
pre-flight test bucket. Exit code 1 + a list of problems when anything drifted.
"""
import importlib.util
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
STYLING = os.path.join(ROOT, 'dist', 'styling.css')
APPLY = os.path.join(HERE, 'apply_theme.py')

# The stylesheet is written with several rules per line, so the token blocks
# are NOT at column 0 — match them by selector, not by line start.
TOKEN_BLOCK_RE = re.compile(r'(:root|\.night-mode)\s*\{([^{}]*)\}')
VAR_DECL_RE = re.compile(r'(--[a-zA-Z0-9\-]+)\s*:')


def load_module():
    spec = importlib.util.spec_from_file_location('apply_theme', APPLY)
    if spec is None or spec.loader is None:
        raise SystemExit('[FAIL] cannot import %s' % APPLY)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def tokens_by_selector(css):
    """{' :root': set(...), ' .night-mode': set(...)} for the token blocks."""
    out = {}
    for m in TOKEN_BLOCK_RE.finditer(css):
        selectors = [s.strip() for s in m.group(1).split(',')]
        names = set(VAR_DECL_RE.findall(m.group(2)))
        if not names:
            continue
        for sel in selectors:
            out.setdefault(sel, set()).update(names)
    return out


def theme_apply(mod, css, theme):
    """Mirror of apply_theme.main(): strip, build, append."""
    light, dark = dict(theme['light']), dict(theme['dark'])
    mesh_light, mesh_dark = mod.build_mesh_css_vars(light, dark)
    light.update(mesh_light)
    dark.update(mesh_dark)
    return (mod.strip_existing_theme_block(css).rstrip() + '\n\n'
            + mod.build_css_block(theme['slug'], light, dark) + '\n')


def count_blocks(css):
    return len(re.findall(r'/\* === THEME:[^:]+:START === \*/', css))


def main(argv):
    quiet = '--quiet' in argv
    problems = []
    notes = []

    if not os.path.exists(STYLING):
        print('[FAIL] missing %s — run `npm run build:templates` first' % STYLING)
        return 1
    base = open(STYLING, encoding='utf-8').read()
    mod = load_module()
    themes = mod.load_themes()
    if not themes:
        print('[FAIL] no themes loaded from themes/*.json')
        return 1

    declared = tokens_by_selector(base)
    root_tokens = declared.get(':root', set())
    dark_tokens = declared.get('.night-mode', set())
    if not root_tokens or not dark_tokens:
        print('[FAIL] could not read the :root / .night-mode token blocks from %s' % STYLING)
        return 1

    # 1 + 2: every theme's overrides must still be part of the contract, and
    # every theme must build a block.
    for theme in themes:
        slug = theme.get('slug') or theme.get('name')
        # Dark mode inherits :root, so a dark override may target any token the
        # styling declares in either block (e.g. --blob-*-rgb lives in :root only).
        for mode, pool in (('light', root_tokens), ('dark', root_tokens | dark_tokens)):
            missing = sorted(set(theme[mode]) - pool)
            if missing:
                problems.append('%s: %s mode overrides %s, which the styling no longer defines'
                                % (slug, mode, ', '.join(missing)))
        try:
            block = mod.build_css_block(slug, dict(theme['light']), dict(theme['dark']))
        except Exception as e:                      # noqa: BLE001 - report, don't crash
            problems.append('%s: build_css_block raised %r' % (slug, e))
            continue
        if 'THEME:%s:START' % theme['slug'] not in block or 'THEME:%s:END' % theme['slug'] not in block:
            problems.append('%s: block is missing its START/END markers' % slug)
        if '!important' not in block:
            problems.append('%s: block lost the !important overrides' % slug)

    # 3: apply → strip is an identity on the styling.
    sample = themes[0]
    applied = theme_apply(mod, base, sample)
    stripped = mod.strip_existing_theme_block(applied)
    if stripped != mod.strip_existing_theme_block(base):
        problems.append('apply(%s) then strip does not return the original styling' % sample['slug'])
    if count_blocks(applied) != 1:
        problems.append('apply(%s) produced %d theme blocks' % (sample['slug'], count_blocks(applied)))

    # 4: repeated switches never stack.
    css = base
    chain = []
    for theme in themes[:5]:
        css = theme_apply(mod, css, theme)
        chain.append(theme['slug'])
        if count_blocks(css) != 1:
            problems.append('after switching %s → %s there are %d blocks'
                            % ('/'.join(chain), theme['slug'], count_blocks(css)))
            break
    if len(css) > len(base) + 60000:
        problems.append('styling grew past one theme block (%d → %d bytes)' % (len(base), len(css)))

    # 5: an unterminated block must not survive.
    broken = base.rstrip() + '\n\n/* === THEME:zz-broken:START === */\n:root { --aurora-1: #000 !important; }\n'
    recovered = mod.strip_existing_theme_block(broken, warn=False)
    if 'zz-broken' in recovered:
        problems.append('a theme block without its END marker survived the strip (dead CSS)')

    if problems:
        print('THEME CONTRACT BROKEN (%d problems)' % len(problems))
        for p in problems:
            print('  - ' + p)
        return 1

    if not quiet:
        print('theme contract OK — %d themes, %d light / %d dark tokens, one block per apply'
              % (len(themes), len(root_tokens), len(dark_tokens)))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
