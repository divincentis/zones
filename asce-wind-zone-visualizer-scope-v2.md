# ASCE 7-22 Wind Zone Visualizer — Engineering Scope & Roadmap

**Revision 2** — geometry-only scope. Pressure calculation and external hazard APIs deferred.

---

## 1. Purpose & Scope Boundaries

A browser-based tool that takes a building footprint and roof configuration and returns a labeled, dimensioned map of ASCE 7-22 Components & Cladding wind zones — in 2D plan and in 3D.

### In scope

- Zone **geometry and classification** for roofs and walls
- Reporting the parameter `a` and every assumption used to derive it
- 2D and 3D visualization
- PDF export of the user-selected 3D view plus tabular zone data

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
| Export | `jsPDF` or equivalent | PDF: captured 3D view + zone/area table |

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
- **PDF export**: the user-selected 3D view plus a tabular zone/area summary (pulled forward from Rev 1 Phase 3, replacing that phase's SVG/DXF plan export — see §10.2)
- Validation fixture suite green

Ship criterion: a roofing estimator can produce a zone summary PDF for a flat-roof rectangle and hand it to a sub.

### Phase 2 — Pitched Roofs

- Ridge line input and derivation
- Algorithm B for gable and hip, all pitch bands — **gable and monoslope done (§10.1, §10.5); hip deferred indefinitely, no source (§10.5, §10.8)**
- Monoslope — done (§10.5)
- Overhang zone strips
- Zone geometry projected onto sloped planes
- Fixtures extended to every band boundary

### Phase 3 — Complex Footprints — **deferred indefinitely, may never be implemented (§10.8)**

- 2D vertex editor
- Straight-skeleton inward offsetting for non-convex polygons (re-entrant corners break naive vector scaling)
- `aBasis` selection UI with assumption reporting
- Derived adjacency between structures
- Multi-level roofs: **visualization only.** Render adjacent roofs at differing heights, but do not attempt step-down turbulence rules.

### Parking Lot — Not Scheduled

- Stepped-roof interaction rules. ASCE's treatment of step-down turbulence is limited; implementing it means making judgment calls the code does not back. This is a research effort, not a sprint.
- Wind speed lookup, `q_z`, `GCp`, net pressures
- Effective wind area and fastener density output

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

### 10.2 Update — 2026-09-06: Export scope narrowed to PDF only

Decided before any export code was written, so this is a scope change, not a rip-out. Every reference to "SVG / DXF export" or "2D plan output" above (§1, §2, §8 Phase 1) is superseded: the tool exports a **PDF** containing the 3D view the user has framed/selected plus a tabular zone/area summary. No 2D CAD-format export (SVG or DXF) is planned.

Rationale:

- A DXF/SVG plan implies a precision CAD deliverable — a stronger claim than §7's "preliminary, for coordination and takeoff, not for construction, not sealed" positioning wants to make.
- The ship criterion in §8 ("hand it to a sub") is satisfied by a PDF with a captured view and a dimensioned area table; it doesn't require a 2D-plan renderer or DXF entity/layer conventions.
- The engine already exposes per-zone polygons and areas, so the PDF path is a canvas screenshot plus a table — materially less surface area to carry through Phase 2 (topology-based zones) and Phase 3 (re-entrant footprints) than a maintained SVG/DXF exporter would be.

If a genuine CAD-import need for DXF surfaces later, it's addable in Phase 3+ once geometry stabilizes.

### 10.3 Update — 2026-09-06: Gable roofs wired into the web UI

§10.1 implemented gable zone geometry in the engine only; the web app was still hardcoded to `roofType: 'flat'`. Closed that gap end to end, ahead of the Phase 1→2 roadmap order (§8) for the same reason as §10.1 — the engine work was already there.

- `BuildingForm` gained a roof-type selector (flat / gable), a pitch input, and a ridge-orientation choice (along Length or Width). Overhang and parapet inputs are hidden for gable — neither is implemented for steep roofs in the engine (§10.1), and the UI shouldn't collect inputs it silently drops.
- `buildModel.computeZones` routes to `computeLowSlopeRoofZones` or `computeSteepRoofZones` based on pitch (≤7° vs >7°), matching the engine's own branch. `ComputationResult.roof` is now a union of the two result types; `isSteepRoofResult` discriminates it everywhere the UI reads roof-specific fields (hover tooltips, dimension annotations, the assumptions panel, PDF export).
- **3D rendering — zones as actual sloped meshes**, per §5's "zones are geometry, not overlays" principle: roof zone piece corners are now placed by a `gableRoofHeight` function (height as a function of perpendicular distance from the ridge, clamped at 0/eave), not the flat `eaveHeight` used for low-slope roofs.
- **Non-obvious bug caught during manual QA, not by the engine test suite** (which only checks *areas*, not rendered geometry): several zone pieces span across the ridge centerline (e.g. Zone 3 in Fig. 3.2.2d-1, the ridge-straddling Zone 2/1 field pieces in both bands). Naively lifting a piece's 4 corners to their gable-slope heights and rendering it as one flat quad cuts off the ridge peak, producing a visibly warped, non-planar patch. Fixed by splitting any piece that straddles the local ridge coordinate into two sub-rectangles at the ridge before height-lifting, so every rendered quad is an exact planar slice of one roof pitch. See `splitGableRoofPiece` in `Scene3D.tsx`.
- **Gable-end wall infill**: the engine's wall zones (§4.2, unchanged) are flat rectangles up to `eaveHeight` on every edge, including the two rake (gable-end) walls — there's no engine-computed zone for the triangular wall area between the eave line and the sloped roof above it. Rendered that triangle in a plain neutral gray with no hover interaction, explicitly *not* a wind zone color, purely so the 3D view doesn't show through to the roof underside at the gable ends. This is a rendering-only addition — it carries no engine data and isn't counted in any zone area.

**Net effect:** a user can now build a gable-roof rectangle end to end — form input, 3D view with real sloped zone meshes, 2D plan, hover detail, PDF export — matching what Phase 1 already delivered for flat roofs. Hip and monoslope roof types remain unimplemented (both engine and UI still throw/hide accordingly).

### 10.4 Update — 2026-09-06: Hip and monoslope — geometry plumbing only, zones deliberately still unimplemented

Asked to extend hip and monoslope next. Checked `docs/reference/` first: the only steep-roof source figure on file (`fm-1-28-fig-3.2.2d-steep.png`) contains exactly the two gable sub-figures already transcribed in §10.1 — nothing for hip or monoslope. Scope §4.2 already flags that "gable and hip roofs have separate figures," and monoslope's asymmetric single slope can't reuse a mirror-symmetric gable figure at all. Rather than infer zone boundaries from reasoning (exactly the risk §9's risk table and §4.2's implementation instruction warn against), asked the user how to proceed; they chose to do the geometry/UI plumbing that doesn't depend on a source figure and explicitly hold off on zone geometry.

- **`gableGeometry.ts` renamed to `ridgeGeometry.ts`** (`resolveGableGeometry` → `resolveRidgeGeometry`, `GableGeometry` → `RidgeGeometry`). Its ridge-centering logic never actually depended on `roofType` — gable and hip share the same ridge **height** formula (perpendicular span and pitch only; hipped vs. gabled ends only change the roof's shape at the ends, not the ridge cross-section), so `meanRoofHeight.ts` now resolves `h` for hip the same way it does gable. This is genuinely roofType-agnostic geometry, not a zone-figure risk, so it's safe to implement without a source.
- **New `monoslopeGeometry.ts` / `resolveMonoslopeGeometry`**: monoslope has no interior ridge — `RoofPlane` gained a `highEdge` field (one of the footprint's own four wall-face edges; the opposite edge is the low eave at `eaveHeight`). Mean height is the same "average of low and high" idea, rising across the *full* perpendicular span with no mirroring (unlike gable/hip, which rise across half the span twice).
- **Real, if incomplete, capability unlock**: wall zones (§4.2, Zone 4/5) only depend on `a`, which only depends on `h` — they don't reference roof-zone shape at all. So `computeWallZones` now genuinely works for hip and monoslope buildings once a valid `ridgeLine`/`highEdge` is supplied, even though `computeSteepRoofZones` still throws `"roofType \"hip\" is not yet supported (gable only)"` for both. Confirmed with dedicated tests (`wallZones.test.ts`, `monoslopeGeometry.test.ts`) and a regression test pinning down that steep roof-zone computation still rejects both.
- **Web UI**: roof type selector now offers Hip and Monoslope. Hip reuses the gable form block (pitch + ridge orientation); monoslope gets a pitch input and a "high side" selector (4 options — one of the two length-direction or two width-direction edges). Both show an explicit note that roof-zone geometry isn't sourced yet and computing above 7° will show an error — this isn't a hidden dead end, it's the same honest "cannot compute zones" panel already used for gable pitches above 45°. At pitch ≤ 7°, both fall back to the flat/low-slope algorithm automatically (which is roofType-agnostic) and render fully, same as gable.
- Because `App.tsx`'s `computeZones` still requires **both** roof and wall computation to succeed before showing any result, selecting Hip/Monoslope above 7° shows the full error panel, not a partial wall-only view — surfacing that partial capability to the user is a separate, not-yet-done UX decision, not attempted here.

**Still blocked on:** hip roof-ZONE geometry. Needs a source figure — FM 1-28 or ASCE 7-22 — placed under `docs/reference/` before implementation, same as §10.1's gable transcription. (Monoslope is now unblocked — see §10.5.)

### 10.5 Update — 2026-09-06: Monoslope roof zones implemented (Fig. 3.4.1a/b); hip confirmed to have no FM 1-28 coverage at all

User dropped the complete FM 1-28 PDF (`docs/reference/FMDS0128.pdf`, 99 pages) into `docs/reference/`, with an explicit instruction to keep scope to geometry — not grow into pressure/`GCp` calculations. Searched the full document text for both roof types before touching any code.

**Hip: confirmed unimplementable from this source.** The only "hip" occurrences in the entire 99-page document are Fig. 1a/1b (§A, cupola roofs) and §2.1.10 ("for other cupola roof shapes, such as hip-shaped, treat as a gabled roof") — both about small roof-top cupola structures, not a primary building's hip roof. There is no hip-roof section, figure, or table anywhere in FM 1-28. This is a genuine, confirmed gap in the source, not a search failure — hip roof-zone geometry stays unimplemented (`computeSteepRoofZones` still throws `"roofType \"hip\" is not yet supported (gable only)"`), and finding a different source (ASCE 7-22) is the only way to close it.

**Monoslope: real source found, §3.4.1 "Steep-Slope, Mono-Slope, and Shed Roofs", with Fig. 3.4.1a (3°–10°) and Fig. 3.4.1b (10°–30°).** Both are dimensioned in `a` (aParameter.ts), like the gable steep-roof figures — not `h`. Transcribed via a mix of the rendered page images and the PDF's underlying vector path data (extracted with `pdftocairo -svg` and parsed directly, to get exact coordinates rather than guessing from raster pixels) — the vector extraction surfaced a genuine ambiguity in one boundary that pixel-reading alone couldn't resolve cleanly, so **the low-side boundary geometry (the "jog," described below) was confirmed by the user directly against their copy of Fig. 3.4.1a**, page 34, before being implemented — not inferred alone. The two source figures are saved as `docs/reference/fm-1-28-fig-3.4.1a-monoslope.png` / `...-3.4.1b-monoslope.png` for future reference, alongside the existing gable/low-slope ones.

- **§3.4.1.A: monoslope ≤3° is explicitly "treated the same as low-slope gable roofs"** — routes to `computeLowSlopeRoofZones` (Fig. 3.2.2a), same as gable/hip's fallback but at a **narrower cutoff (3°, not 7°)** — this was a real, easy-to-miss discrepancy fixed in `buildModel.computeZones`, which previously routed every roof type through the same 7° threshold.
- **Fig. 3.4.1a (3°–10°) is asymmetric between the high and low edges** — a genuinely different shape than any figure transcribed so far: the high edge gets Zone 3' corners (`2a × 4a`) and a Zone 2' middle band, both the *same* width `2a` (no step between corner and middle on that edge — confirmed by careful visual re-inspection of the high-side vector coordinates, all at a constant offset). The low edge gets Zone 3 corners (`2a × 2a`) but a **narrower** Zone 2 middle band (width `a`, not `2a`) — the corner extends further into the field than the plain edge band does, so Zone 1's boundary along the low edge steps from `2a` (adjacent to each corner) to `a` (away from both). This is the detail the user confirmed directly.
- **Fig. 3.4.1b (10°–30°) is simpler and unprimed** — same high-edge Zone 3/Zone 2 (`2a`/`4a`) as 3.4.1a, but every other edge (low edge **and both ridge-parallel edges**) shares one uniform `a`-wide Zone 2 band wrapping around three sides, with **no separate corner zone at all** on that side.
- **>30° has no source** — FM 1-28 §2.1.7.B routes monoslope slopes above 3° to "ASCE 7 or Section 3.4," and Section 3.4.1 itself tops out at 30°; `computeMonoslopeRoofZones` throws rather than guessing, same pattern as gable's 45° ceiling.
- Implemented in `packages/engine/src/monoslopeRoofZones.ts`, using the existing `resolveMonoslopeGeometry` (§10.4) for frame/orientation. Verified two ways: 18 new tests including an **area-conservation check** (every zone piece's area must sum to exactly `W × L` — a strong self-consistency check independent of whether the zone *labels* are transcribed correctly) for both pitch bands, plus axis-agnosticism checks (same areas regardless of which footprint edge is "high" or which way the frame axes point).
- **3D rendering**: unlike gable, a monoslope roof is a single tilted plane with no ridge fold, so every rectangular zone piece is already exactly planar — no piece-splitting needed (contrast with `splitGableRoofPiece` in Scene3D.tsx). Added an envelope-infill component (`MonoslopeEnvelopeInfill`) for the same reason as the gable-end triangles: the engine's wall zones use a flat `eaveHeight` for all four walls (unchanged, roofType-agnostic formula), but a real monoslope building has a taller high-edge wall and two diagonally-sloped side walls. The infill (a plain rectangle for the high wall, two triangles for the sides) is cosmetic envelope fill only — not wind-zone data, same caveat as the gable-end triangles.
- **Web UI**: roof type selector's Monoslope option now computes and renders fully (form inputs, 3D view, 2D plan, hover detail, PDF export) for 3°–30°, falls back to the flat algorithm at ≤3°, and shows the same honest "cannot compute zones" error panel above 30° — verified live in the browser for both pitch bands and the >30° error case, cross-checked against the source figure's zone layout pixel-for-pixel (correct corner-width ratios, correct step location).

**Net effect:** hip remains the only roof type with no zone-geometry path at all (by source availability, not by choice). Flat, gable, and monoslope are all now fully implemented end-to-end; monoslope wall-zone/envelope simplifications are documented inline and in the UI, matching the project's existing disclosure pattern for gable.

### 10.6 Update — 2026-09-06: Parapet corner credit implemented for low-slope roofs

Closed the gap flagged since §3.3 ("Parapets above a threshold height modify corner zone treatment on low-slope roofs — verify the exact provision and threshold against the standard before implementing") and left unimplemented through §10.1–§10.5 (`parapetHeight` was collected and passed through the model, but AssumptionsPanel explicitly said it was "recorded but not yet applied"). Confirmed the exact provision in the full FM 1-28 text (already on file from §10.5): **Table 3.2.2a, note 2, p.21** — "If a parapet with a minimum height of 3 ft (0.9 m) is provided around the entire perimeter, Zone 2 values for GCP may be used in Zone 3."

- **Scope: low-slope only.** Table 3.2.2a is the ≤7° figure already implemented in `lowSlopeRoofZones.ts`; the equivalent steep-gable tables (3.2.2b/c/d) carry no such footnote, so this credit is not applied to gable/hip/monoslope-above-3°. Consistent with those roof types already hiding the parapet input entirely (§10.1, §10.3, §10.5).
- **"Entire perimeter" is automatic.** The data model has a single scalar `parapetHeight` per building — there's no way to model a partial parapet — so the note's "around the entire perimeter" qualifier is satisfied by definition whenever the height threshold is met. No new field needed.
- **Geometric effect:** since this project computes geometry, not pressures, "Zone 2 values... may be used in Zone 3" is implemented as reclassifying the corner geometry itself — the L-shaped corner pieces that would be Zone 3 are added as Zone 2 instead. Zone 3's area goes to exactly 0 for a qualifying building; Zone 2 absorbs it. No other zone (1, 1', or walls 4/5) is affected — confirmed by an explicit area-conservation test.
- Threshold is inclusive (`parapetHeight >= 3`) — "a parapet with a **minimum** height of 3 ft" reads as 3 ft itself qualifying; covered by a boundary-condition test at exactly 3 ft alongside 2.9 ft (no credit) and 6 ft (credit).
- Implemented in `packages/engine/src/lowSlopeRoofZones.ts` (`parapetCreditsCorners` flag on `LowSlopeRoofZoneResult`, exported threshold constant `PARAPET_CORNER_CREDIT_THRESHOLD_FT`). Surfaced in the web UI: `AssumptionsPanel`, PDF export, and the Zone 2 hover tooltip all state when the credit is active (or, if a parapet is set but under 3 ft, that it isn't).
- **Not yet browser-verified** — implemented and unit-tested (4 new fixture cases plus full engine suite green, 92 tests) but not exercised live in the running app; do that before relying on the UI wiring specifically.

### 10.7 Update — 2026-09-06: New reference doc reviewed (GAF ASCE 7-22 summary) — schema unaffected, hip still blocked

A new file appeared under `docs/reference/`: a saved copy of the GAF building-science blog post *"Prevailing Winds and Prevailing Codes: A Summary of Roof Related ASCE 7-22 Changes,"* checked in here as `asce-7-22-roof-zone-changes-gaf-summary.pdf`. Reviewed for two things: whether it unblocks hip (§10.5's confirmed gap), and whether it implies any schema change.

- **What it actually contains:** a marketing/explainer summary of how ASCE 7-22 Chapter 30 Part 1 changed C&C roof zones versus 7-16 — for gable, hip, and stepped (multi-level) roofs. It shows side-by-side "7-16 vs 7-22" zone-layout plan diagrams and states the zone count dropped from four labels (`1`, `2r`, `2e`, `3`) to three (`1`, `2`, `3`), and that corner Zone 3 on stepped roofs changed from a square to an L-shape.
- **Does not unblock hip.** The diagrams are illustrative plan-view sketches with zone numbers but **no dimension multipliers** (`a`, `2a`, `4a`, etc.) called out anywhere in the source — exactly the kind of secondary source §9's risk table warns against ("Pitched-roof zones misread from an older edition | Transcribe from 7-22 figures directly"). Implementing hip zones from this doc would mean guessing scale factors, not transcribing them. The actual ASCE 7-22 Chapter 30 Part 1 figures (or an equivalent primary source with dimensions) are still needed; `computeSteepRoofZones` continues to throw for `roofType: 'hip'`.
- **Corroborates a choice already made, though.** Our zone-ID types (`LowSlopeRoofZoneId`, `SteepRoofZoneId`, `MonoslopeRoofZoneId` — all `'1' | '2' | '3'` (+ `1'` low-slope only), no `2e`/`2r`/`3e` suffixes) already match the simplified 3-zone ASCE 7-22 scheme this doc describes, even though the actual figures transcribed are FM 1-28's. No rename needed.
- **Stepped-roof diagrams are relevant to the Parking Lot item** ("stepped-roof interaction rules," §8) if that ever gets picked up — same L-shaped-corner idea we already implement for low-slope Zone 3 (§10 addendum) turns out to be the general modern-ASCE pattern, not an FM-specific quirk. Still parked; no action taken.
- **Schema: confirmed still good, no changes made.** `RoofType` already includes `'hip'` (`types.ts`); `RoofPlane`'s `ridgeLine`/`pitchDegrees` model is already roofType-agnostic per §10.4 (hip reuses gable's ridge-height formula); zone-ID unions already use the unsuffixed scheme. Whenever a real hip source shows up, it plugs into the existing shape — no `FootprintNode`/`RoofPlane`/`BuildingModel` rework anticipated.

### 10.8 Update — 2026-09-07: Hip roof zones and Phase 3 deferred indefinitely

User decision, not a technical finding: both remaining open items are deferred and may never be implemented.

- **Hip roof-zone geometry** (§10.5's confirmed source gap). `computeSteepRoofZones` keeps throwing `"roofType \"hip\" is not yet supported (gable only)"`; the UI keeps its existing honest error panel for the case. No further searching for a source is planned unless the user raises it again.
- **Phase 3 — Complex Footprints** (§8): 2D vertex editor, straight-skeleton offsetting for re-entrant polygons, `aBasis` selection UI, multi-structure adjacency detection. None of this is scheduled.
- Everything shipped through §10.7 plus the stepped/abutting-zone work (FM 1-28 Fig. 3.2.2b/c, merged to `main` just before this decision) stands as the tool's functional ceiling for the foreseeable future: flat, gable, and monoslope roofs end-to-end, wall zones for all roof types including hip/monoslope (§10.4), parapet corner credit, and stepped/abutting-building zone treatment.
- Not a scope-boundary change (§1 is untouched) — just a prioritization call. If either item is picked back up later, §10.5 (hip) and §8 Phase 3 (complex footprints) still describe exactly what's missing and why.

### 10.9 Update — 2026-10-10: Height limit on Fig. 3.2.2a, and three figures that were on file but unused

A top-to-bottom read of `docs/reference/FMDS0128.txt` against the engine found one wrong result and three places where "no source" was no longer true. All four are from the same FM 1-28 PDF that has been on file since §10.5.

- **Fig. 3.2.2a has a height limit the engine never applied.** §3.2.2 (p.19) and Table 3.2.2a note 1 scope the `0.6h` layout to "h ≤ 60 ft (18 m), or h < 90 ft (27 m) and h/w ≤1.0". Above that, a 100 ft building got a 60 ft perimeter band and no Zone 1 at all. `heightRegime.ts` now classifies every building (`w` is the lesser plan dimension — Appendix A, p.53), `computeLowSlopeRoofZones` rejects a tall one, and the web app routes it to the new figure.
- **Fig. 3.2.2f — tall buildings (≥ 90 ft, or > 60 ft with h/w > 1).** New `tallRoofZones.ts`. Table 3.2.2f note 1 is the whole layout: Zone 2 width `a`, Zone 3 an L of `2a × 2a × a`, with `a` = 10% of the lesser plan dimension but not less than 3 ft. No Zone 1′. Note 2 repeats the parapet credit. This `a` is **not** `aParameter.ts`'s (no `0.4h` cap, no 4% floor); the two only differ when the lesser plan dimension exceeds `4h`, and each is kept as its own figure states it. Steeper roofs on tall buildings are unchanged — note 1 sends them back to Tables 3.2.2b–d.
- **Fig. 3.2.2e — wall zones are sourced after all.** The addendum above says no FM figure covered walls. Fig. 3.2.2e (p.24) does, and Table 3.2.2e's note is word for word the §4.1 `a` formula, so the geometry did not change — only the citation, now carried on `WallZoneResult.source`. What did change is height: the figure is drawn on a gabled building with the corner strips running up to the rake, so **walls now follow the roof surface** (`roofSurface.ts`). Gable-end triangles and a monoslope's taller high wall and sloped side walls are real Zone 4/5 pieces, counted in the areas, replacing the grey "envelope infill" of §10.3 and §10.5. A gable at ≤ 7° or monoslope at ≤ 3° is still modeled flat, walls included, to match its roof.
- **Fig. 3.4.6a/b — gables over 45°.** §3.4.6: "Treat the areas shown as either Zone 4 or 5 wall construction". `computeSteepRoofZones` now returns a `'45+'` band whose pieces carry wall zone ids: a Zone 5 strip `a` wide up each rake, a Zone 5 band at the peak, Zone 4 between. On the gable-end wall the strip continues up the rake, still `a` wide horizontally (Fig. 3.4.6b). Not board-rounded, so the roof strip stays in line with the wall strip under it.
- **Roof areas are now measured on the slope.** Pieces still carry plan areas (zones are laid out in plan, §4.1), but steep and monoslope results expose `slopeFactor` = 1/cos θ and every area the UI shows is multiplied by it, with a note saying so. Without it a roof treated as wall at 60° would have reported half its surface. Band widths remain plan dimensions.

**Judgment calls made here, surfaced in the UI rather than hidden:**

- *The peak band above 45°.* Fig. 3.4.6a dimensions it `a` on an elevation view. It is taken as a vertical drop of `a` (a plan run of `a / tan θ`). Reading it as `a` down the slope would be narrower by sin θ; the figure is not drawn to a stated slope, so it cannot settle which, and the wider reading was chosen.
- *Tall sections of a stepped building.* Fig. 3.2.2b/c are drawn with Fig. 3.2.2a's dimensions and Fig. 3.2.2f shows no abutting case. Rather than refuse a podium and tower, a region over the height limit keeps the free-edge rule of §10's stepped work and takes Fig. 3.2.2f's dimensions. This is an extrapolation, reported per region (`SteppedRegionSummary.regime`) and stated in the panel and PDF. For a tower with every edge free it reduces exactly to `computeTallRoofZones` (asserted). If this is not wanted, the alternative is to throw for any stepped building with a tall region.

**Still unsourced:** hip roofs (§10.5), monoslope above 30°, overhang and parapet on pitched roofs. **On file but not implemented:** Fig. 3.4.5a (multi-span gables), Fig. 3.4.2a/b (saw-tooth), Fig. 3.4.3 (arched).

**Also in this change:** the "zbCAD /" home link and warm palette that had been patched by hand into the deployed bundle (zbCAD commit `b01dba3`) are now in `App.tsx` and `theme.css`, so `scripts/deploy.sh` no longer removes them. The disclaimer names FM 1-28 as the source of the figures instead of ASCE 7-22.
