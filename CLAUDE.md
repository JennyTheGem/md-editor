# @uplift-beyond/md-editor

Reusable React markdown editor on CodeMirror 6 (live preview, tables, slash and emoji menus, opt-in timestamp pills). Standalone repo, consumed by EZReplay-V3 through a `file:` link. `README.md` is the user guide, `src/index.ts` the only public entry.

## Rules

- **No host app imports.** Never import from EZReplay-V3 or any other app, and no i18next, zustand or app stores. The app passes everything in as options.
- **Strings:** every UI string is a phrase read with `state.phrase(...)`, keys listed in `src/phrases.ts` (`MD_PHRASES`). The host translates via `EditorState.phrases`.
- **Theme:** only through `--md-*` CSS variables with fallbacks in `src/theme.ts`. No CSS files, no hex literals except the `MD_COLORS` palette, no side-stripe borders, no vertical margins on lines or widget roots.
- **Timestamps are opt-in.** Without `options.timestamps`: no pills, `#` is a plain character, no timestamp command or slash entry.
- **CodeMirror rules:** decorations come from the syntax tree, never a regex over the doc. Block widgets live in StateFields. Every WidgetType has an `eq` over visual content and `ignoreEvent() { return false }`. Plugin replaces never cross a line break. No raw keydown listeners, keymaps only. No innerHTML.
- **Writing:** no em dash or en dash anywhere. Very few, very short comments. YAGNI.

## Test

```sh
npm test            # vitest + jsdom, tests/ mirrors src/
npm run lint
npm run typecheck
```

Every change keeps all three green. jsdom has no layout: never assert coordinates or computed styles.
