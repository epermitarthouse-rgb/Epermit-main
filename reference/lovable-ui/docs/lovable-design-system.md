# Design System Snapshot

Source of truth: `src/index.css` (semantic HSL tokens + component utilities), `tailwind.config.ts` (Tailwind extensions), and Fontsource imports in `src/main.tsx`.

## 1. Themes

Two themes coexist; **dark is canonical** (per project memory). Selected via `.dark` class from `useTheme`. Defaults to dark.

### Dark (canonical Obsidian)
| Token | HSL |
| --- | --- |
| `--background` | `215 35% 8%` |
| `--foreground` | `36 25% 92%` |
| `--surface` | `215 32% 11%` |
| `--surface-muted` | `215 28% 14%` |
| `--card` / `--popover` | `215 32% 11%` |
| `--primary` | `32 92% 58%` (gold) |
| `--primary-foreground` | `215 45% 6%` |
| `--secondary` | `215 28% 14%` |
| `--muted` | `215 26% 16%` |
| `--muted-foreground` | `220 12% 66%` |
| `--accent` | `178 62% 48%` (teal) |
| `--destructive` | `4 78% 62%` |
| `--success` | `158 56% 50%` |
| `--warning` | `38 92% 60%` |
| `--border` / `--input` | `215 22% 22%` |
| `--ring` | `32 92% 58%` |
| `--sidebar-background` | `215 38% 6%` |
| `--pilot-cyan` | `196 80% 58%` |
| `--pilot-teal` | `178 62% 48%` |
| `--pilot-amber` | `38 92% 60%` |
| `--pilot-rose` | `4 78% 62%` |
| `--pilot-line` | `215 22% 22%` |
| `--brand-orange` | `32 92% 58%` |
| `--brand-orange-deep` | `28 88% 50%` |
| `--brand-blue` | `196 80% 58%` |
| `--deep-navy` | `215 45% 6%` |

### Light (Intelligence Editorial, secondary)
| Token | HSL |
| --- | --- |
| `--background` | `36 33% 96%` (warm cream) |
| `--foreground` | `215 35% 14%` |
| `--card` / `--surface` | `0 0% 100%` |
| `--primary` | `18 82% 52%` (terracotta) |
| `--accent` | `178 58% 32%` |
| `--border` | `32 18% 84%` |
| `--sidebar-background` | `34 30% 94%` |
| `--brand-orange` | `18 82% 52%` |

Radius scale: `--radius = 0.5rem`, `sm = calc(r-8px)`, `md = calc(r-4px)`, `lg = r`, `xl = calc(r+4px)`.

## 2. Typography

Loaded via `@fontsource` in `src/main.tsx`:

- Display: **Cormorant Garamond** 600 → `font-display`.
- Tight/UI: **Inter Tight** 500/600/700 → `font-tight`.
- Body: **Inter** 400/500/600 → `font-body` (default).
- Data/mono: **JetBrains Mono** 500 → `font-data` / `font-mono`.

Observed hierarchy:

| Role | Class | Example |
| --- | --- | --- |
| Page H1 (editorial) | `font-tight text-3xl md:text-4xl font-black tracking-tight` | `PageHeader` |
| Editorial display | `font-display text-3xl / 4xl font-semibold` | `MetricCard`, `CommandCenter` KPIs |
| Panel title (H2) | `font-tight text-xl font-bold` | `Panel` |
| Card title (H3) | `font-tight text-lg font-bold` | `CommandCenter` card |
| Body | `text-sm` / `text-base leading-6` | `PageHeader` body |
| Kicker / eyebrow | `.pilot-kicker` = `font-data text-xs uppercase tracking-wider text-muted-foreground` | everywhere |
| Metric value | `font-data text-3xl font-semibold` | `StatCard` |
| Micro caps | `text-[10px] / text-[11px] uppercase tracking-wider` | `StatusPill`, `ServicePill` |

## 3. Spacing & layout

- Container: Tailwind `container` centered, padding `2rem`, max `1400px` at `2xl`.
- Main content padding: `px-4 py-5 md:px-6 lg:px-8`.
- Sidebar width: shadcn default from `ui/sidebar.tsx` (`collapsible="icon"` collapses to icon rail).
- Header height: `h-16` sticky, `border-b`, `bg-background/90 backdrop-blur-xl`.
- Common grid gap: `gap-4` / `gap-5` / `gap-6`.
- Card padding: `p-5` (`pilot-card`, `Panel`, `StatCard`, `MetricCard`).
- Section spacing: `mb-6` between `PageHeader` and content; page-level `space-y-6`.

## 4. Component utility classes (`index.css`)

| Class | Purpose |
| --- | --- |
| `.pilot-card` | Base panel card. |
| `.pilot-card-raised` | Emphasised panel used by `MetricCard`. |
| `.pilot-button-primary` | Primary orange/gold pill, uppercase Inter Tight bold. |
| `.pilot-button-ghost` | Outlined ghost button on raised surface. |
| `.pilot-input` | Bordered input with focus ring `ring-primary/20`. |
| `.pilot-kicker` | Mono uppercase eyebrow. |
| `.signal-grid` | Faint navy grid overlay `32px`. |
| `.grid-overlay` | Alt grid `28px` for marketing hero. |
| `.scanline` | Animated cyan scanline. |
| `.editorial-card` | Marketing `bg-surface` rounded-xl with soft shadow. |
| `.glass-nav` | Blurred translucent nav for marketing. |
| `.btn-primary` / `.btn-ghost-light` / `.btn-outline` | Marketing home CTA family. |
| `.status-chip` | Marketing chip variant. |
| `.section-eyebrow` / `.display-headline` | Marketing typography helpers. |

## 5. Feature primitives (`ProductPrimitives.tsx`)

- `PageHeader({eyebrow,title,body,action})` — flex row, kicker + H1 + body + action.
- `StatCard`, `MetricCard` — KPI tiles with icon chip in `bg-primary/10 text-primary`.
- `Panel({title,eyebrow,children,className})` — `.pilot-card p-5` with header.
- `StatusPill({tone: default|good|warn|bad|info})` — rounded-full mono uppercase pill; colored borders `/30` + fills `/10`.
- `ProgressLine({value})` — 2px pill on `bg-pilot-line/60` with `bg-primary` fill.
- `ProjectLink({to})` — primary text link with `ArrowUpRight`, hover to `pilot-cyan`.
- `ServicePill` — permit (primary) vs utility (teal).
- `AlertBanner({title,detail,tone})` — rounded-lg bordered banner in same 5 tones.

## 6. State styling

| State | Convention |
| --- | --- |
| Hover | `hover:border-primary hover:text-primary` on tiles; `hover:bg-brand-orange-deep` on primary buttons; `hover:-translate-y-0.5 hover:shadow-lg` on project cards. |
| Focus | `focus:border-primary focus:ring-2 focus:ring-primary/20` on `pilot-input`; shadcn default rings on `ui/*`. |
| Active / selected | `SidebarMenuButton isActive`; `ring-2 ring-primary/40` on active project cards. |
| Disabled | shadcn `disabled:` classes; Save button disabled at preset-notes overflow. |
| Loading | `UciLoading` skeleton; shadcn `Skeleton`. |
| Empty | `UciEmpty` icon + title + body. |
| Success | tone `good` = success/10 + success/30 border + success text. |
| Warning | tone `warn` = warning/10 + warning/30. |
| Error / destructive | tone `bad` = destructive/10 + destructive/30; `AccessDenied` uses destructive border. |
| Info | tone `info` = pilot-cyan/10 + pilot-cyan/30. |

## 7. Shared visuals

- Icon library: **lucide-react** (`^0.462.0`), sole icon set.
- Charts: shadcn `ui/chart.tsx` wrapping **recharts**.
- Signatures: `react-signature-canvas` on LOA.
- PDF: `jspdf` + `jspdf-autotable`.
- Toasts: shadcn `Toaster` + **Sonner** both mounted globally.
- Tables: shadcn `Table` on admin surfaces; native `<table>` on marketing/operations.
- Badges: shadcn `Badge` alongside `StatusPill` / `ServicePill`.

## 8. Tenant branding

`PermitPilotShell` reads `?tenant=mcd | default` (persisted to `localStorage[commun-et:tenant]`):

- `default`: primary-colored square mark "P", label "PermitPilot".
- `mcd`: yellow (`#FFC72C`) mark "M", label "PermitPilot · McDonald's East Coast".

Only the sidebar mark + breadcrumb text change; palette does not.