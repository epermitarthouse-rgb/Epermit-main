---
name: PermitPilot
colors:
  surface: '#fff8f5'
  surface-dim: '#e8d7cc'
  surface-bright: '#fff8f5'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#fff1e9'
  surface-container: '#fcebe0'
  surface-container-high: '#f6e5da'
  surface-container-highest: '#f1dfd5'
  on-surface: '#221a13'
  on-surface-variant: '#554337'
  inverse-surface: '#382e27'
  inverse-on-surface: '#ffede3'
  outline: '#887365'
  outline-variant: '#dbc2b1'
  surface-tint: '#914c00'
  primary: '#914c00'
  on-primary: '#ffffff'
  primary-container: '#e8882f'
  on-primary-container: '#572b00'
  inverse-primary: '#ffb77e'
  secondary: '#535f73'
  on-secondary: '#ffffff'
  secondary-container: '#d6e3fb'
  on-secondary-container: '#596579'
  tertiary: '#2f6388'
  on-tertiary: '#ffffff'
  tertiary-container: '#74a5cd'
  on-tertiary-container: '#003a59'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdcc3'
  primary-fixed-dim: '#ffb77e'
  on-primary-fixed: '#2f1500'
  on-primary-fixed-variant: '#6e3900'
  secondary-fixed: '#d6e3fb'
  secondary-fixed-dim: '#bac7de'
  on-secondary-fixed: '#0f1c2d'
  on-secondary-fixed-variant: '#3b475a'
  tertiary-fixed: '#cbe6ff'
  tertiary-fixed-dim: '#9bccf6'
  on-tertiary-fixed: '#001e30'
  on-tertiary-fixed-variant: '#0e4b6e'
  background: '#fff8f5'
  on-background: '#221a13'
  surface-variant: '#f1dfd5'
  background-alt: '#F5F8FB'
  status-success: '#137333'
  status-warning: '#B06000'
  status-error: '#C5221F'
  surface-border: '#E2E8F0'
  text-muted: '#64748B'
typography:
  display-lg:
    fontFamily: Cormorant Garamond
    fontSize: 48px
    fontWeight: '600'
    lineHeight: '1.1'
  h1:
    fontFamily: Inter Tight
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.01em
  h2:
    fontFamily: Inter Tight
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  h3:
    fontFamily: Inter Tight
    fontSize: 20px
    fontWeight: '600'
    lineHeight: '1.4'
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  label-caps:
    fontFamily: Inter Tight
    fontSize: 12px
    fontWeight: '700'
    lineHeight: '1.0'
    letterSpacing: 0.05em
  data-mono:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1.4'
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
  xxl: 64px
  gutter: 24px
  margin: 32px
---

## Brand & Style
PermitPilot embodies a **Corporate Modern** aesthetic tailored for high-stakes government and utility coordination. The brand personality is authoritative yet technologically advanced, blending the reliability of civil engineering with the precision of AI-driven intelligence.

The visual style utilizes a "Hybrid Professional" approach:
- **Foundational Reliability:** Deep navy tones and structured grids provide a sense of security and institutional trust.
- **AI Intelligence:** Vibrant orange accents and specialized "Agent" statuses introduce a layer of modern, proactive technology.
- **Clarity & Air:** A light, airy canvas with generous whitespace ensures that complex data-heavy workflows remain legible and low-stress.
- **Precision:** Monospaced data points and high-contrast labels emphasize accuracy in technical documentation.

## Colors
The palette is rooted in a high-contrast relationship between deep maritime blues and a vibrant "Construction Orange."

- **Primary (#E8882F):** Used for primary actions, alerts, and active indicators. It symbolizes visibility and progress.
- **Secondary (#0E1B2C):** A deep navy reserved for navigation and high-level structure, providing a "Secure" frame for the application.
- **Tertiary (#1A5276):** A professional blue used for interactive links and secondary information.
- **Semantic Accents:** Statuses use a highly legible triad of Emerald (Success), Amber (Pending), and Crimson (Error/Conflict), paired with muted background tints to ensure accessibility without overwhelming the eye.
- **Neutral Canvas:** The background utilizes a very cool-toned grey-blue (#F5F8FB) to differentiate the page from white container surfaces.

## Typography
The typographic system uses a sophisticated three-family approach to distinguish between different information types:

1.  **Cormorant Garamond:** Reserved for the brand logo and massive "Display" metrics. Its classical serif nature adds a layer of prestige and institutional history.
2.  **Inter Tight / Inter:** The workhorse sans-serif. "Tight" is used for headings and high-impact labels to maintain a crisp, professional density. Standard "Inter" handles body text for maximum legibility.
3.  **JetBrains Mono:** Used exclusively for dates, coordinates, and technical metadata. This signals "raw data" to the user, distinguishing AI-extracted facts from human-readable narrative.

**Scaling:** For mobile, `h1` should scale to 24px and `display-lg` to 36px to prevent overflow.

## Layout & Spacing
The layout follows a **Fluid Grid** model with a sidebar-main content architecture.

- **Sidebar:** Fixed at 256px (64 units). It acts as the anchor for the system.
- **Main Canvas:** A fluid area using 32px (margin) horizontal padding and 24px (gutter) between cards.
- **Rhythm:** A strictly enforced 4px base unit. Component internal padding typically uses `md` (16px) or `lg` (24px).
- **Responsive Behavior:** 
    - **Desktop:** 12-column logic within containers.
    - **Tablet:** Sidebar collapses to an icon-only rail; cards stack to 2-columns.
    - **Mobile:** Sidebar becomes a hidden drawer; margins reduce to 16px; all metric cards stack vertically.

## Elevation & Depth
PermitPilot uses a **Tonal Layering** system complemented by **Soft Ambient Shadows**.

- **Level 0 (Background):** The cool-grey `#F5F8FB` surface.
- **Level 1 (Cards/Containers):** Pure white `#FFFFFF` surfaces with a very soft, diffused shadow (`0 4px 20px rgba(14, 27, 44, 0.02)`) and a 1px border in `#E2E8F0`.
- **Level 2 (Navigation/Headers):** Glassmorphic overlays. The Top Bar uses an 80% opacity white with a `blur-md` (back-drop blur) to maintain context while scrolling.
- **Level 3 (Popovers/Drawers):** Stronger shadows with a 10% opacity black tint to clearly separate them from the content plane.

## Shapes
The shape language is "Professional Soft." It avoids the playfulness of fully rounded pills while steering clear of the harshness of sharp corners.

- **Standard Containers:** `0.75rem` (12px) for dashboard cards to create a modern, friendly feel.
- **Buttons & Inputs:** `0.5rem` (8px) to maintain a more structured, tool-like appearance.
- **Status Badges:** Full `9999px` radius (pill-shaped) to distinguish them from interactive buttons.
- **Selection States:** `0.5rem` (8px) for hover states in the sidebar and table rows.

## Components
### Buttons
- **Primary:** Background `#E8882F`, white text. Features a subtle inner top-light shadow for a tactile feel.
- **Secondary/Ghost:** White background, 1px border `#E2E8F0`, primary-colored icons.

### Inputs
- **Search Bar:** Minimalist with a 1px border. Focus state moves from grey to primary orange with no outer glow, maintaining a clean look.

### Data Tables
- **Headers:** `label-caps` typography with a light grey `#F8FAFC` background.
- **Rows:** Subtle hover state using `#F8FAFC`. Border-bottom only on rows for a clean vertical rhythm.

### Status Chips
- High-saturation text on a 10-15% opacity background of the same hue. Font must be `label-caps` at 10px for high-density legibility.

### Cards
- Always use white backgrounds. Metrics cards include a decorative 5% opacity "corner-flare" in the primary/secondary color to add visual interest without distracting from the data.