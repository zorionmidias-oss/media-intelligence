# CSS Architecture — Apple Mach Tahoe Redesign

**Date:** 2026-08-29  
**Design Language:** Apple Mach Tahoe  
**Status:** ✅ Complete & Integrated

## Overview

The Media Intelligence dashboard has been completely redesigned using Apple's Mach Tahoe design language. This document describes the CSS architecture, organization, and how to maintain/extend the system.

---

## File Organization

```
public/css/
├── index.css                    (main import cascade)
├── _reset.css                   (normalize, global resets)
├── _variables.css               (theme variables: light/dark)
├── _typography.css              (font scales, hierarchy)
├── _animations.css              (keyframes, transitions)
├── layouts/
│   ├── grid.css                 (grid system, flex utilities, spacing)
│   ├── responsive.css           (breakpoints: 640/768/1024px)
│   └── accessibility.css        (focus, contrast, a11y helpers)
├── components/                  (18 component files)
│   ├── button.css               (primary, secondary, ghost, sizes)
│   ├── input.css                (inputs, textarea, select, form-group)
│   ├── card.css                 (cards, KPI variant, glassmorphic)
│   ├── badge.css                (badges, semantic variants)
│   ├── table.css                (table styling, hover states)
│   ├── modal.css                (modals, overlays, animations)
│   ├── sidebar.css              (sidebar, collapse state)
│   ├── topbar.css               (topbar, glassmorphism)
│   ├── tooltip.css              (tooltips, arrows)
│   ├── dropdown.css             (dropdowns, menu states)
│   ├── checkbox.css             (checkboxes, radios)
│   ├── toggle.css               (toggle switches)
│   ├── chart.css                (chart containers, legends)
│   ├── alert.css                (alerts, toasts, semantic colors)
│   ├── breadcrumb.css           (breadcrumbs, responsive)
│   ├── pagination.css           (pagination, tabs)
│   ├── progress.css             (progress bars)
│   ├── skeleton.css             (skeleton loaders, shimmer)
│   ├── status.css               (status indicators, badges)
│   └── helpers.css              (empty states, timelines)
├── utilities.css                (utility helpers)
└── (future: components dir will grow)

public/js/
├── theme.js                     (ThemeManager: light/dark mode)
└── components/
    ├── sidebar.js               (sidebar interactions)
    ├── modal.js                 (modal open/close/escape)
    └── dropdown.js              (dropdown toggle/click-outside)
```

---

## How to Use

### 1. Link in HTML

In the `<head>` of your HTML file, add:

```html
<link rel="stylesheet" href="/css/index.css">
<meta name="theme-color" content="#FFFFFF">
```

Add before `</body>`:

```html
<script src="/js/theme.js"></script>
<script src="/js/components/sidebar.js"></script>
<script src="/js/components/modal.js"></script>
<script src="/js/components/dropdown.js"></script>
```

### 2. Modifying CSS

- **Edit component directly:** All component files are independent (e.g., `components/button.css`)
- **Add new variables:** Update `_variables.css` for light/dark mode
- **No build step required:** Pure CSS, works immediately in the browser
- **Minify for production:** Run `cssnano` or similar before deploying

### 3. Adding New Components

1. Create `public/css/components/[component-name].css`
2. Import in `public/css/index.css`:
   ```css
   @import 'components/[component-name].css';
   ```
3. Use CSS variables for colors/spacing (not hardcoded values)
4. Ensure accessibility (focus states, contrast, semantic HTML)
5. Test light + dark modes

---

## Theme Variables

All colors, spacing, and easing are defined as CSS variables in `_variables.css`:

### Light Mode (Default)
```css
--bg: #FFFFFF
--bg-secondary: #F5F5F7
--fg: #000000
--accent: #0A84FF
--success: #34C759
--warning: #FF9500
--danger: #FF3B30
```

### Dark Mode
Automatically activated via:
- `[data-theme="dark"]` attribute (manual toggle)
- `@media (prefers-color-scheme: dark)` (system preference)

Dark mode adjusts:
- Backgrounds: darker/OLED-safe
- Text: inverted contrast
- Shadows: stronger opacity
- Semantic colors: warmer/safer for dark backgrounds

### Spacing Scale (8px base)
```css
--spacing-xs: 4px
--spacing-sm: 8px
--spacing-md: 12px
--spacing-lg: 16px
--spacing-xl: 20px
--spacing-2xl: 24px
--spacing-3xl: 32px
```

### Easing Functions
```css
--ease-out: cubic-bezier(0, 0, 0.2, 1)         /* default */
--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1)   /* smooth */
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1)  /* bounce */
```

---

## Responsive Breakpoints

| Breakpoint | Width | Use Case | Changes |
|-----------|-------|----------|---------|
| Mobile | < 640px | Phones | 1-col grid, sidebar hidden, 16px padding |
| Tablet | 640px - 1024px | Tablets | 2-col grid, sidebar collapsed (72px) |
| Desktop | 1024px - 1440px | Laptops | 3-4 col grid, sidebar expanded (260px) |
| Large | 1440px+ | 4K/Ultra-wide | 4+ col grid, max-width container |

Media queries in `layouts/responsive.css`:
```css
/* Tablet */
@media (max-width: 1024px) { ... }

/* Mobile */
@media (max-width: 768px) { ... }

/* Small */
@media (max-width: 640px) { ... }
```

---

## Glassmorphism & Effects

### Backdrop Blur
- **Light frosted (10px):** Cards, panels, dropdowns
- **Medium frosted (15px):** Topbar, modals
- **Heavy frosted (20px):** Modal overlay (limit to 1-2 per page for performance)

### Shadows (Minimalist Scale)
```css
--shadow-sm:  0 1px 2px rgba(0,0,0,0.05)
--shadow-md:  0 2px 4px rgba(0,0,0,0.05), 0 4px 12px rgba(0,0,0,0.08)
--shadow-lg:  0 4px 12px rgba(0,0,0,0.1), 0 16px 40px rgba(0,0,0,0.15)
```

Dark mode shadows are 2-3× stronger (higher opacity).

### Animations & Transitions
All transitions use CSS variables for consistency:
```css
transition: all 150ms var(--ease-out);  /* quick: button hover */
animation: slideUp 200ms var(--ease-out) both;  /* modal appear */
```

**Respects `prefers-reduced-motion`:**
```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## Components

### 18 Types Included

| Component | Purpose | Key Classes | States |
|-----------|---------|-------------|--------|
| Button | CTAs, actions | `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-sm`, `.btn-lg`, `.btn-icon` | hover, active, disabled |
| Input | Forms | `input`, `textarea`, `select`, `.form-group` | focus, error, disabled |
| Card | Containers | `.card`, `.card-kpi` | hover (lift), glassmorphic |
| Badge | Labels | `.badge`, `.badge-success/warning/danger/info` | semantic colors |
| Table | Data display | `table`, `thead`, `tbody` | hover rows, numeric alignment |
| Modal | Dialogs | `.modal`, `.modal-overlay`, `.modal-content` | open/closed, animations |
| Sidebar | Navigation | `.sidebar`, `.nav-btn`, `.nav-ind` | collapsed, active |
| Topbar | Header | `.topbar`, `.topbar-left/center/right` | glassmorphic, fixed |
| Tooltip | Hints | `.tooltip`, `.tooltip-text` | hover reveal, arrow |
| Dropdown | Menus | `[data-dropdown]`, `[data-dropdown-menu]` | open/closed, hover |
| Checkbox | Boolean input | `input[type="checkbox"]`, `.checkbox-label` | checked, focus, disabled |
| Toggle | Switch | `.toggle`, `.toggle-btn` | on/off, smooth slide |
| Chart | Data viz | `.chart-container`, `.chart-legend` | with tooltips |
| Alert | Notifications | `.alert`, `.toast`, semantic classes | success/warning/danger/info |
| Breadcrumb | Navigation path | `.breadcrumb`, `.breadcrumb-item` | responsive collapse |
| Pagination | Page nav | `.pagination`, `.pagination-item` | active, disabled |
| Progress | Loading | `.progress`, `.progress-fill` | semantic colors |
| Skeleton | Placeholder | `.skeleton`, `.skeleton-text/title/avatar` | shimmer animation |
| Status | Indicators | `.status-dot`, `.status-badge` | online/offline/busy/error |

---

## Accessibility

All components follow WCAG 2.1 Level AA:

### Color Contrast
- Text on background: 4.5:1 or higher
- UI components: 3:1 or higher
- Never rely on color alone (pair with icon/label)

### Focus Management
```css
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

### Touch Targets
All interactive elements: minimum 44px × 44px

### Semantic HTML
- Use `<button>` for actions, `<a>` for navigation
- Include `aria-label` on icon-only buttons
- Use `aria-disabled`, `aria-invalid` on form states

### Keyboard Navigation
- Tab through all interactive elements
- Escape closes modals and dropdowns
- Enter activates buttons and links
- Arrow keys in menus (optional, JS required)

---

## Performance

### Targets
- ✅ Blur elements: max 3-4 per page (GPU cost)
- ✅ Transitions: 100-300ms (responsive feel)
- ✅ CSS minified in production (no bloat)
- ✅ GPU acceleration on hover/transform (smooth 60fps)
- ✅ Respects prefers-reduced-motion (accessible)
- ✅ No layout shifts during theme switch (300ms fade)

### Optimization Tips
- Use `will-change: filter` on blur containers sparingly
- Prefer `transform` over `left/top` (GPU accelerated)
- Batch animations (don't animate every property)
- Minify CSS before production deploy
- Lazy-load fonts if needed (system stack is fast)

---

## Browser Support

| Browser | Version | Blur Support | Status |
|---------|---------|--------------|--------|
| Chrome | 90+ | ✅ Full | Fully supported |
| Safari | 15+ | ✅ Full | Fully supported |
| Firefox | 88+ | ✅ Full | Fully supported |
| Edge | 90+ | ✅ Full | Fully supported |
| IE 11 | — | ❌ No | Not supported (use fallback) |

### Fallback for `backdrop-filter`
Browsers without support (old Safari, IE) degrade to solid `rgba()` colors — still readable, just no blur effect.

---

## Maintenance

### When to Update

1. **Color scheme change:** Edit `_variables.css` (impacts entire site)
2. **Typography update:** Update `_typography.css` (h1-h3, body scales)
3. **Add component:** Create new file in `components/`, import in `index.css`
4. **Fix spacing:** Use `--spacing-*` variables (not magic numbers)
5. **Adjust animations:** Edit durations in `_animations.css`

### Testing Checklist

- [ ] Light mode renders correctly
- [ ] Dark mode renders correctly (toggle via theme.js)
- [ ] Responsive at 375px (mobile), 768px (tablet), 1024px+ (desktop)
- [ ] Focus outlines visible on keyboard nav
- [ ] Contrast ratios pass WCAG AA (Lighthouse)
- [ ] Animations smooth at 60fps
- [ ] Blur effect visible (test in Chrome/Safari)
- [ ] Touch targets >= 44px × 44px

### Common Tasks

**Add a new color:**
```css
/* _variables.css */
:root {
  --brand-purple: #8B5CF6;
}

[data-theme="dark"] {
  --brand-purple: #A78BFA;
}
```

**Adjust button padding:**
```css
/* components/button.css */
button {
  padding: 12px 18px;  /* was 10px 16px */
}
```

**Create a new responsive breakpoint:**
```css
/* layouts/responsive.css */
@media (max-width: 1600px) {
  .grid-cols-4 { grid-template-columns: repeat(3, 1fr); }
}
```

---

## Design Philosophy

This redesign follows **Apple's Mach Tahoe** principles:

1. **Minimalism:** No unnecessary decoration; every element serves a purpose
2. **Clarity:** Strong typographic hierarchy; clear primary/secondary actions
3. **Whitespace:** Generous breathing room between elements (8px base grid)
4. **Glass:** Subtle backdrop blur on floating elements (modals, dropdowns)
5. **Motion:** Purposeful animations (feedback, not distraction)
6. **Light & Dark:** First-class support for both modes; equal quality
7. **Accessibility:** WCAG AA contrast, focus management, semantic HTML

---

## References

- **Design Spec:** `docs/superpowers/specs/2026-08-29-mach-tahoe-redesign.md`
- **Implementation Plan:** `docs/superpowers/plans/2026-08-29-mach-tahoe-implementation.md`
- **Color Tokens:** `public/css/_variables.css` (source of truth)
- **Apple Design Language:** https://developer.apple.com/design/ (inspiration)

---

**CSS Architecture v1.0** — Mach Tahoe Redesign Complete
