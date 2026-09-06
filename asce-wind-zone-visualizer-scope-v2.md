# ASCE 7-22 Wind Zone Visualizer — Engineering Scope & Roadmap

**Revision 2** — geometry-only scope. Pressure calculation and external hazard APIs deferred.

---

## 1. Purpose & Scope Boundaries

A browser-based tool that takes a building footprint and roof configuration and returns a labeled, dimensioned map of ASCE 7-22 Components & Cladding wind zones — in 2D plan and in 3D.

### In scope

- Zone **geometry and classification** for roofs and walls
- Reporting the parameter `a` and every assumption used to derive it
- 2D and 3D visualization
- SVG / DXF export of the zone map

### Explicitly out of scope

- Ultimate wind speed lookup (ATC Hazards or equivalent)
- Velocity pressure `q_z`, `GCp`, or net design pressures `p`
- Effective wind area and fastener/attachment schedules
- Anything constituting sealed engineering design

The tool answers *"where are the zones and how big are they."* It does not answer *"what pressure applies."* This boundary is deliberate: zone geometry is a defensible, verifiable computation, while pressures carry design liability and a much larger input surface (exposure, risk category, enclosure, topographic factors). See §7.

---

## 2. Technical Stack

Client-heavy SPA. All geometry generation and rendering execute in the browser.

| Layer | Technology | Notes |
|---|---|---|
| UI | React or Vue | Form state, validation, layout |
| 3D | Three.js / React Three Fiber | WebGL, raycasting, camera |
| Zone engine | Pure TypeScript, zero UI deps | Headless, unit-testable, independently publishable |
| Export | `svg.js` / `dxf-writer` or equivalent | 2D plan output |

The zone engine must be importable and testable with no DOM. This is the single most important architectural constraint in the document — it is what makes §6 possible.

---

## 3. Data Model

### 3.1 Units

**Internal representation is always feet and degrees.** Conversion happens only at the UI boundary. There is no `units` field on the model; unit preference is view state.

### 3.2 Schema

```typescript
interface RoofPlane {
  ridgeLine?: [Vec2, Vec2];      // required for gable/hip; defines eave vs. rake edges
  pitchDegrees: number;          // canonical
  pitchRise?: number;            // x:12 convenience, derived, for display only
  overhangDepth: number;         // 0 if none; measured horizontally from wall face
  parapetHeight: number;         // 0 if none
}

interface FootprintNode {
  id: string;
  vertices: Vec2[];              // closed loop, CCW, wall-face centerline
  eaveHeight: number;
  roofType: 'flat' | 'gable' | 'hip' | 'monoslope';
  roof: RoofPlane;
}

interface BuildingModel {
  structures: FootprintNode[];
  aBasis: 'boundingRect' | 'shortestEdge' | 'perWing';  // see §4.3
  metadata?: ProjectMetadata;    // reserved; not used in computation
}
```

### 3.3 Notes on changes from Rev 1

- **`adjacencyEdges` removed.** Hand-declared adjacency drifts out of sync the moment a vertex moves. Derive topology at compute time by detecting coincident edges within a tolerance (suggest 0.01 ft).
- **`ridgeLine` added.** Without it, a `gable` footprint has no way to distinguish eave edges from rake edges, and pitched-roof zoning is undefined (§4.2).
- **Overhang and parapet added.** Overhangs carry distinct zone designations. Parapets above a threshold height modify corner zone treatment on low-slope roofs — *verify the exact provision and threshold against the standard before implementing.*
- **`ProjectMetadata`** (exposure category, risk category, enclosure classification) is carried but unused. It exists so that files created today remain forward-compatible if pressure calculation is ever added. Do not surface these in the UI in the current scope — collecting inputs the tool ignores implies a capability it lacks.

---

## 4. Zone Determination Engine

### 4.1 The parameter `a`

```
a = min(0.1 × L_min, 0.4 × h)
a ≥ max(0.04 × L_min, 3 ft)
```

Where `L_min` is the **least horizontal dimension** of the building.

`h` is **mean roof height**, except for roof slopes ≤ 10° where **eave height** is used. Because `h` depends on pitch and pitch is a model input, this branch must live inside the engine, not in a form.

`a` is a **plan** dimension. Zone bands on sloped surfaces are laid out in plan and projected onto the roof plane. Offsetting along the slope is a common and easy bug — assert against it in tests.

### 4.2 Two distinct zoning algorithms

Rev 1 assumed all zones are concentric inward offsets. This is wrong for pitched roofs and is the largest correction in this revision.

**Algorithm A — offset-based.** Applies to low-slope roofs (θ ≤ 7°) and all wall surfaces.

- Roof: inward offsets at `a` and `2a` produce concentric bands. Zones 3 (corners), 2 (edges), 1 (interior), and 1' where the interior region is large enough to develop it. Zone 1' exists **only** on low-slope roofs and only above a threshold — it is not simply "whatever survives two offsets."
- Walls: Zone 5 is a strip of width `a` from each corner, full height; Zone 4 is the remainder.

**Algorithm B — topology-based.** Applies to gable, hip, and monoslope roofs.

Since ASCE 7-16, pitched roof zones are driven by roof topology — ridge lines, hip lines, eaves, rakes — not by distance from the footprint edge. Zone designations use suffixes (`2e`, `2n`, `2r`, `3e`, `3r`) distinguishing edge, end, and ridge regions. A ridge band cannot be produced by any inward offset of a footprint.

Additionally, **the zone set differs by pitch band** (roughly 7°–20°, 20°–27°, 27°–45°), and gable and hip roofs have separate figures. Each band is a distinct case in the engine, not a parameter variation.

> **Implementation instruction:** transcribe zone sets, boundaries, and band breakpoints directly from the ASCE 7-22 Chapter 30 Part 1 figures. Do not infer them from 7-10 or earlier nomenclature, and do not assume figure numbering matches 7-16. Record the figure reference next to each case in code comments.

### 4.3 Handling ambiguity honestly

ASCE gives no direct guidance for re-entrant (L-shaped) footprints. There is no code-sanctioned `L_min` for an L-shape, and it is unclear whether an inside corner is treated as a corner for wall Zone 5.

The engine **must not silently resolve this.** The `aBasis` field lets the user choose (bounding rectangle / shortest edge / per-wing), and every output — screen, export, report — states the basis used and flags the result as an engineering judgment not directly supported by the standard. Surfacing ambiguity is the feature; computing past it is the failure mode.

---

## 5. Rendering Approach

**Zones are geometry, not overlays.** The engine already produces 2D sub-polygons per zone. Triangulate each (earcut) and transform it into the roof plane as the actual rendered mesh.

This eliminates coplanar surfaces entirely — no z-fighting, no decal projection pipeline, no artifacts where planes intersect. The decal-mapping work item from Rev 1 is deleted.

Interaction: hover a zone → display its classification, area, and the governing dimension (`a` or `2a`).

---

## 6. Validation Fixtures — Build First

Before any UI work, build a fixture suite of hand-calculated cases with known answers and unit-test the engine against them. Sources: ASCE 7 commentary worked examples, SEAOC and ATC wind design guides.

Minimum coverage:

- `a` governed by each of the four branches (0.1·L_min, 0.4h, 0.04·L_min floor, 3 ft floor)
- Square footprint (degenerate `L_min`)
- Building where `2a` exceeds half the least dimension (bands collide — define the behavior)
- Each pitch band, gable and hip
- θ = 7°, 10°, 20°, 27°, 45° exactly (boundary conditions on both the algorithm switch and the `h` definition)
- Overhang and no-overhang variants
- One L-shape per `aBasis` mode

Without this, the tool is unfalsifiable. With it, a surprising Zone 3 is diagnosable in minutes rather than being a question of faith.

---

## 7. Positioning & Liability

Because pressures are out of scope, the output is a **dimensioned geometry reference**, not a design deliverable. Label exports accordingly: *preliminary, for coordination and takeoff, not for construction, not sealed.*

The natural high-value use is estimating and coordination — communicating zone extents to subs, sanity-checking a submittal's attachment layout against zone boundaries, and quantifying per-zone areas. That framing is both more useful day-to-day and considerably safer than a design tool.

---

## 8. Phased Roadmap

Rev 1's Phase 2 and 3 are reordered. Complex geometry contains all the hard math and none of the early utility; export is cheap and disproportionately valuable.

### Phase 1 — Low-Slope Rectangles, End to End

- Inputs: `L`, `B`, eave height, parapet height, overhang depth
- `a` calculation with full branch logic and displayed derivation
- Algorithm A: roof zones 1', 1, 2, 3 and wall zones 4, 5
- 3D view with zones as subdivided meshes
- Hover tooltips: zone, area, governing dimension
- **SVG + DXF export of the 2D zone plan** (pulled forward from Rev 1 Phase 3)
- Validation fixture suite green

Ship criterion: a roofing estimator can produce a dimensioned zone plan for a flat-roof rectangle and hand it to a sub.

### Phase 2 — Pitched Roofs

- Ridge line input and derivation
- Algorithm B for gable and hip, all pitch bands
- Monoslope
- Overhang zone strips
- Zone geometry projected onto sloped planes
- Fixtures extended to every band boundary

### Phase 3 — Complex Footprints

- 2D vertex editor
- Straight-skeleton inward offsetting for non-convex polygons (re-entrant corners break naive vector scaling)
- `aBasis` selection UI with assumption reporting
- Derived adjacency between structures
- Multi-level roofs: **visualization only.** Render adjacent roofs at differing heights, but do not attempt step-down turbulence rules.

### Parking Lot — Not Scheduled

- Stepped-roof interaction rules. ASCE's treatment of step-down turbulence is limited; implementing it means making judgment calls the code does not back. This is a research effort, not a sprint.
- Wind speed lookup, `q_z`, `GCp`, net pressures
- Effective wind area and fastener density output
- PDF report generation

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Pitched-roof zones misread from an older edition | Transcribe from 7-22 figures directly; cite figure reference in code; fixture per band |
| L-shape `a` derivation presented as authoritative | `aBasis` is explicit and always reported; outputs flagged as judgment |
| Users treat output as design | Non-sealed labeling on all exports; positioned for takeoff and coordination |
| `a` bands collide on small buildings | Defined behavior + fixture, not an unhandled edge case |
| Non-convex offsetting fails at interior corners | Straight-skeleton algorithm; Phase 3 only, after simpler cases are proven |
| Slope-vs-plan offsetting bug | Assertion in test suite; zones laid out in plan, then projected |

---

## 10. Addendum — 2026-09-06: Roof zone source changed to FM Global 1-28

During implementation, the reference figures actually available (`docs/reference/fm-1-28-*.png`) turned out to be from **FM Global Property Loss Prevention Data Sheet 1-28, "Wind Design"** (Fig. 3.2.2a–d), not ASCE 7-22 Chapter 30 directly. Web search to independently verify the ASCE 7-22 low-slope figure produced conflicting secondary-source signals, so rather than guess, the engine now implements what's actually sourced:

- **Low-slope roof zones (Algorithm A, θ ≤ 7°) now come from FM 1-28 Fig. 3.2.2a**, not the `a`-parameter offset method originally described in §4.2. Zone width is dimensioned directly off mean roof height `h`:
  - Zone 2: perimeter band, width `0.6h` from each edge.
  - Zone 3: **L-shaped** corner (not a square `a×a`), legs `0.6h` long by `0.2h` wide — the far inner corner of that `0.6h × 0.6h` square reverts to Zone 2.
  - Zone 1: interior, from `0.6h` to `1.2h` from all edges.
  - Zone 1′: exists **only** when the least horizontal dimension exceeds `2.4h`; otherwise Zone 1 continues to the building's center with no 1′ distinction. This confirms the "only above a threshold" caveat originally noted in §4.2 — the threshold and boundary values were guessed wrong there, but the qualitative behavior was right.
  - Implemented in `packages/engine/src/lowSlopeRoofZones.ts`. Collision behavior when bands or corner legs from opposite/adjacent edges would overlap (small buildings) is clamped per-axis to the building's own half-dimension and covered by fixtures.
- **Wall zones (Zone 4/5) are unchanged** — still the `a`-parameter formula from §4.1/§4.2 (`a` from `computeA`, Zone 5 = corner strip of width `a`, full height). No FM source contradicted this, so it wasn't touched. This means the engine now uses **two different governing standards for two different parts of the same building** — documented per-module in code comments, not hidden.
- **Steep-roof zones (Algorithm B, Phase 2)**: FM 1-28 Fig. 3.2.2d (`a`-based, pitch bands 7°–27° and 27°–45°) was also provided but not yet transcribed into code — deferred to Phase 2 as originally planned. The reference image is saved; the exact zone layout (which region is Zone 2 vs 3 relative to ridge/eave/rake) needs careful transcription before implementation, not assumption from the low-slope logic.
- **Abutting/adjoining roofs** (FM 1-28 Fig. 3.2.2b/c: zone treatment when a taller building's roof abuts a lower one, split at the <10 ft vs ≥10 ft height-difference threshold) is a **concrete, sourced rule** for exactly the case §8/§9 parks as "stepped-roof interaction... a research effort, not a sprint." Worth revisiting that classification now that a source exists — likely still Phase 3+ (it requires the multi-structure adjacency detection already deferred there), but no longer purely speculative.

**Net effect on §1–§9 above:** treat every reference to "ASCE 7-22" in §4.2's roof-zone discussion as superseded by this addendum for low-slope roofs. Wall zones, the `a` formula itself (§4.1), and the Phase roadmap (§8) are unaffected until Phase 2 steep-roof work reconciles Fig. 3.2.2d against them.

### 10.1 Update — 2026-09-06: Gable roof zones (Fig. 3.2.2d) implemented

Jumped ahead of the Phase 1→2 roadmap order (§8) to transcribe Fig. 3.2.2d while the FM source was already open. Implemented in `packages/engine/src/steepRoofZones.ts` and `gableGeometry.ts`, gable roofType only (hip/monoslope still throw "not yet implemented").

**Mean roof height for gable roofs above 10°** is now real geometry (`meanRoofHeight.ts`): `ridgeHeight = eaveHeight + (perpExtent/2)·tan(pitch)`, `h = (eaveHeight + ridgeHeight)/2`. This is standard roof geometry, not a standard-specific figure, so it doesn't carry the same verification risk as zone boundaries. It requires the ridge to be centered (equal run to both eaves) — an off-center ridge with a single `pitchDegrees` value would imply two slopes meeting at inconsistent heights, so that case throws rather than silently picking a side.

**Zone geometry, transcribed exactly as drawn** — flagged here because one detail is genuinely counter-intuitive and worth the user spot-checking against their own copy of Fig. 3.2.2d before relying on it:

- **7° < θ ≤ 27° (Fig. 3.2.2d-1):** Zone 3 sits where the near-ridge band (width `2a`, centered on the ridge) overlaps the near-rake band (depth `a` from each gable-end wall) — i.e., at the two points where the ridge meets a gable end. This is **not** the building's outer plan corner. Zone 2 covers either band alone; Zone 1 is the field beyond both.
- **27° < θ ≤ 45° (Fig. 3.2.2d-2):** The ridge-adjacent elevation disappears entirely. Zone 3 moves to the **true building corners** (rake ∩ eave, an `a×a` square); the rest of the rake band — including the portion straddling the ridge — is Zone 2; the field beyond the rake band is Zone 1 with no separate ridge treatment.
- Both bands use `a` (wall/steep-roof parameter), not `h` — confirmed by the dimension labels in both sub-figures.
- Collision clamping (small buildings) follows the same per-axis half-dimension pattern as the low-slope and wall zones, and is covered by fixtures at the 7°, 27°, and 45° pitch-band boundaries.
- `θ > 45°` and hip/monoslope roofs are not covered by any figure reviewed yet — still throws.
