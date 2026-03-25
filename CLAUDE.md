# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start development server (Next.js, http://localhost:3000)
npm run build    # Production build
npm run lint     # Run ESLint
```

There are no automated tests configured in this project.

## What This App Does

**Old Hangul Font Smith** is a browser-based tool that takes a modern Hangul `.ttf`/`.otf` font and generates an Old Hangul font from it. It works by:

1. Analyzing the uploaded font's existing jamo (Korean letter) shapes
2. Letting the user edit per-jamo "varsets" (variant glyph shapes for different positional contexts)
3. Generating and downloading a new font file with Old Hangul syllable support via PUA (Private Use Area) Unicode codepoints and OpenType GSUB ligature substitution rules

## Architecture

### Core Data Model

**`JamoVarsets`** (`app/utils/types.ts`) is the central data structure — a `Record<jamoName, ConsonantSets | VowelSets>`. Each jamo has multiple variant glyph shapes (`varsets`) keyed by their positional context:
- Consonants have leading variants (`l1`–`l8`), trailing variants (`t1`–`t4`), and `canon`
- Vowels have variants (`v1`–`v4`) and `canon`

Each varset value is a `SerializedPathData | null` — null means the varset is not yet defined.

**`PathData`** (`app/pathUtils/PathData.ts`) is the main path class. It wraps fabric.js `TSimplePathData[]` and provides conversion to/from opentype.js, paper.js, and SVG. It also computes medial axis skeletons used for interpolation. Coordinates are normalized to a 1000-unit em square.

### Processing Pipeline

Heavy operations run in **Web Workers** managed by `FontProcessor` (`app/processors/fontProcessor.ts`):

- `analyzeFontWorker.ts` — parses the uploaded font, renders a sample image, and extracts jamo shapes from precomposed modern Hangul syllables into `JamoVarsets`
- `makeFontWorker.ts` — takes `JamoVarsets` + font file + options and builds the output font using `fonttools` via Pyodide (Python in the browser), emitting an OpenType font blob

Font generation (`app/processors/makeFont/makeFont.ts`) builds GSUB lookup tables mapping sequences of jamo PUA codepoints to precomposed Old Hangul syllable glyphs.

### State Management

Redux Toolkit store (`app/redux/store.ts`) holds `font.present.jamoVarsets` (wrapped with `redux-undo` for Ctrl+Z/Ctrl+Y support). Actions: `fontLoaded` (sets all varsets after analysis), `pathUpdated` (updates a single jamo+varset path).

Session state is persisted to `localStorage` as `SavedState[]` (via `react-use`'s `useLocalStorage`). Since the font binary isn't stored, users must re-upload the font file when resuming a saved session.

### UI Components

- `app/page.tsx` — Top-level page; manages app state machine (`IDLE → PROCESSING_FONT → READY_TO_GENERATE → GENERATING → COMPLETED`), file upload, save/load
- `app/components/Editor.tsx` — Jamo/varset selector + interactive glyph editor + varset map overview. Handles keyboard shortcuts (Ctrl+Z/Y/S)
- `app/components/GlyphView.tsx` — Canvas-based interactive glyph editor using fabric.js
- `app/components/VarsetMapView.tsx` — Grid overview of all jamo varsets

### Hangul-Specific Modules (`app/hangul/`)

- `hangulData.ts` — Master table of all jamo with their Unicode codepoints, compat forms, and positional roles
- `jamos.ts` — Varset grouping logic; `getSyllablesFor()` returns syllables that use a given jamo+varset, `getExampleEnvPaths()` provides background glyph previews
- `jamoBounds.ts` — Bounds data for extracting individual jamo from precomposed syllable glyphs
- `puaUniConv.ts` / `puaUniTable.ts` — Bidirectional mapping between standard Old Hangul Unicode and the font's PUA codepoints

### Path Utilities (`app/pathUtils/`)

- `medialAxis.ts`, `medialSkeleton.ts`, `medialSkeletonPoints.ts` — Medial axis transform for stroke skeleton extraction (used in interpolation)
- `localPrimitiveFitting.ts` — Fits geometric primitives (lines, curves) to medial axis graphs
- `reconstructPath.ts` — Reconstructs an outline path from a medial skeleton
- `convert.ts` — Converts between fabric.js, paper.js, and SVG path formats

## Tech Stack

- **Next.js** (App Router, `app/` directory), React 19, TypeScript
- **MUI** for UI components, **Tailwind CSS v4** for layout/utility styles
- **Redux Toolkit** + `redux-undo` for undoable state
- **fabric.js** — interactive canvas path editing
- **paper.js** — computational geometry (boolean ops, path analysis)
- **opentype.js** — font parsing on the main thread
- **Pyodide** + **fonttools** — font generation (Python running in browser via WASM) in the make-font worker
- **clipper-js** — polygon clipping operations
- **d3-delaunay** — Delaunay triangulation (used in medial axis computation)

## Key Conventions

- `initDrawContexts()` (`app/utils/init.ts`) must be called once on the client to initialize both paper.js and fabric.js globals before any path operations
- Both workers also call `paper.setup()` independently since workers have their own scope
- Path coordinates are always in 1000-unit em space (normalized from the font's actual `unitsPerEm`)
- `schedulerYield()` is used before heavy synchronous operations to allow the UI to re-render first
