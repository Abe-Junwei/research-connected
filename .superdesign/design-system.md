# Research Connected theme-adaptive cartographic design system

Research Connected is a focused Obsidian research tool for exploring one seed paper. The main pane is an investigation workspace; the note embed is a compact reading-context widget. They must feel like one product, with the embed using the same visual grammar at a smaller scale.

## Direction

Use a modern literature atlas: Cosmograph-inspired workspace geometry with the fine annotations, restrained title plaques and orderly legends of historical nautical/celestial charts. Keep it a working Obsidian research tool. Colors ALWAYS inherit the host theme. No fixed parchment, gold, navy or dark-only identity. No marketing hero, old-paper textures, decorative compass, fictional bearings, fake geography or background particles.

## Required consistency

- Same font stack, colors, radii, borders, button states and tab vocabulary in pane and embed.
- Same visual hierarchy: primary action uses the host accent; secondary buttons use host surfaces; selected controls use accent hairlines or a soft tint.
- Compact header, 54px persistent icon rail, 290-350px collapsible left filter/legend panel, dominant graph, optional 320px right evidence sidebar. Keep right-panel actions reachable when closed.
- Same panel anatomy: title, short help line, semantic legend, working relationship toggles, then secondary controls. No unsupported filter builder.
- The temporal workspace opens with a full-width bottom year histogram/scrubber, matching the reference composition. Each bar counts current sampled papers; the control is an inclusive cutoff year, not an arbitrary time-range brush. Switching back to planar or radial layout hides it.
- Keep the pane's seed input/search controls and the embed's reload action as surface-specific content, but place them in equivalent header height and spacing.
- Keep graph canvas visually dominant. Controls should be compact and never compete with nodes.

## Tokens

- `--rc-surface: var(--background-primary)`
- `--rc-canvas: var(--background-secondary)`
- `--rc-ink: var(--text-normal)`
- `--rc-muted: var(--text-muted)`
- `--rc-quiet: var(--text-faint)`
- `--rc-border: var(--background-modifier-border)`
- `--rc-accent: var(--interactive-accent)`
- `--rc-accent-soft`: host accent at 12% opacity
- `--rc-radius-sm: 6px`
- `--rc-radius-md: 10px`
- `--rc-space: 8px`
- Typeface: host interface font; system fallback `Segoe UI`, `PingFang SC`, `Noto Sans SC`, sans-serif. No new font download or decorative script. Main UI 12-14px; readable map annotations 11-12px.
- Light preview host values: primary `#ffffff`, secondary `#f5f5f5`, normal `#303238`, muted `#666a73`, faint `#8b9099`, border `#dedfe3`, accent `#7856c8`.
- Dark preview host values: primary `#282b31`, secondary `#22252b`, normal `#e4e5e8`, muted `#a9adb7`, faint `#858b96`, border `#3d424b`, accent `#a994e8`.
- Preview-only theme controls simulate Obsidian host token changes; they are not new product settings. All HTML and graph colors reference semantic variables so the preview themes can be replaced by any host theme.
- Data palette: retain existing semantic groups: community hues, year ramp violet `#5a66cc` → teal `#35b098` → ochre `#cca43f`; direct/co-citation/coupling must match the legend. Adapt readability without changing meaning. The atlas treatment must not recolor every node gold.
- Thin 1px panel dividers; low-opacity graph edges; double seed ring using host accent. Restrained local node halo. No global bloom, heavy shadows or gradients on panels.
- Dark canvas uses a procedural near-black star field, never a static photograph: distribute enough visible points across the whole graph canvas for them to read immediately, with varied small sizes, muted blue-gray color, and independent slow twinkle phases. Keep background stars fixed in the viewport and separate from the graph transform. Literature nodes remain visibly brighter and larger, with crisp cores and one soft glow; preserve clearly readable relationship lines above the background. Do not add decorative node rings. Provide a pause/resume control for the star animation, honor `prefers-reduced-motion`, and hide both the star field and its motion control on light surfaces; the light canvas remains neutral.
- Cartographic detail: modest project title plaque, crisp legend swatches, small caption rules and actual year tick marks. No compass north, distance scale, invented coastlines or atlas ornaments masquerading as data.
- Required/selected/hovered node labels win priority and have a host-surface backing. Preserve arrowheads and evidence semantics. Prefer title/author/year over poetic navigation jargon.
- Reduced-motion state is static. Do not animate particles or automatically rotate/pan the graph.

## Implementation target

Prefer the existing CSS token layer in `styles.css` and shared classes over duplicated `.cpo-root`/`.cpo-embed` rules. The pane and embed share one frame: icon nav, filter panel, graph, year band, evidence. Canvas colors are read on theme or size changes and cached for drawing. Saved views keep their panel booleans; a narrow window does not overwrite them.

Use ONLY the fonts, colors, spacing, and component styles defined here. Do not introduce any fonts, colors, or visual styles not in the design system.
