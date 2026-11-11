# PoolGuard — Design Style and UI Specification

Version 1.0 · 29 October 2026

## 1. Design direction

Build PoolGuard as a calm, precise, premium software product: light surfaces, generous whitespace, confident typography, compact controls and realistic product demonstrations.

Reference: [SpaceFS](https://spacefs.com/), reviewed on 29 October 2026. Its public page places product demonstrations and familiar file/application interfaces alongside concise benefit-led sections. Borrow the product-first presentation principle. This document proposes an original PoolGuard visual system; the colors, fonts, spacing and dimensions below are **chosen design tokens, not measured SpaceFS values**. Browser-rendered visual fidelity to the reference has not been verified.

**This specification replaces the earlier dark navy / lime / teal visual direction in the PoolGuard build prompt. Default to a light interface.** Keep all existing financial, security and implementation requirements.

The desired feeling: an orderly workspace where people can understand and control agent spending at a glance.

Use three visual priorities:

1. The task and its available budget.
2. What the agents are doing.
3. Evidence of what was authorized, paid and delivered.

Do not make every section equally loud. Each page needs one primary action and one clear visual anchor.

## 2. Non-negotiable principles

- Use warm-white page backgrounds, white workspace surfaces and near-black text.
- Use a neutral dark primary button. Reserve color for meaningful state.
- Prefer spacing and typography to boxes inside boxes.
- Show actual interface elements: task rows, budget accounting, agent activity and receipts.
- Use original PoolGuard branding, copy and illustrations; do not reuse SpaceFS logos, assets or screenshots.
- A marketing illustration may use clearly labeled sample data. A running task screen must reflect real application state.
- Keep the default experience quiet: no glowing cards, neon gradients, floating particles or animated blockchain backgrounds.
- Technical detail should be available when requested, without overwhelming the main workflow.
- Use plain language. For example, “Payment pending” is more useful than “Asynchronous settlement dispatch initialized.”

## 3. Brand

**Name:** PoolGuard

**Tagline:** One task budget. Multiple agents.

**Supporting line:** Give agents room to work, with spending limits enforced on NEAR.

Use a simple original outline mark: two offset rounded brackets enclosing a small square. Draw it in SVG with the same stroke weight as the interface icons. It should communicate a bounded workspace rather than a coin or police badge.

Wordmark: medium-weight sans serif, near-black, normal case. Keep 8–10px between mark and wordmark. At small sizes use the mark alone with an accessible label.

Never display fabricated security certifications, adoption numbers, investors, partners or testimonials.

## 4. Color tokens

| Token | Value | Purpose |
|---|---|---|
| `background` | `#F8F8F6` | Main application and landing canvas |
| `surface` | `#FFFFFF` | Workspace panels, menus and dialogs |
| `surface-muted` | `#F1F1EE` | Sidebar, subtle section backgrounds |
| `surface-hover` | `#F5F5F2` | Hovered rows and secondary controls |
| `surface-selected` | `#EAEAE5` | Selected navigation and rows |
| `foreground` | `#20211F` | Headings, primary content |
| `foreground-secondary` | `#565952` | Body copy and explanations |
| `foreground-muted` | `#6C7067` | Metadata; verify contrast at final size |
| `border` | `#E3E4DE` | Decorative separators and panel edges |
| `border-strong` | `#858A7F` | Input boundaries needing clear identification |
| `primary` | `#242721` | Primary buttons |
| `primary-hover` | `#393E34` | Primary hover |
| `primary-foreground` | `#FFFFFF` | Primary-button text |
| `accent` | `#4D6042` | Small brand accents and the "available" budget color |
| `action` | `#C2410C` | Things the user can act on: primary CTAs, links, selected states, current step |
| `action-hover` | `#9A3412` | Action hover and pressed |
| `action-foreground` | `#FFFFFF` | Text on action fills (5.18:1) |
| `action-soft` | `#FFF1E8` | Tint behind selected nav items, presets and current steps |
| `action-bright` | `#E8590C` | Large decorative graphics only (3.37:1, never text) |
| `action-ring` | `rgb(194 65 12 / 22%)` | Focus halo around inputs |
| `focus` | `#C2410C` | Visible focus rings |
| `success` | `#25603E` | Successful or delivered states |
| `success-background` | `#ECF5EE` | Success badges |
| `warning` | `#805514` | Pending, reserved or attention states |
| `warning-background` | `#FBF3E4` | Warning badges |
| `danger` | `#A33535` | Denied, failed and destructive states |
| `danger-background` | `#FAEEEE` | Failure badges |
| `info` | `#3C5E87` | Informational or running states |
| `info-background` | `#EEF3F9` | Informational badges |

Aim for approximately 85% neutral surfaces, 10% dark text/controls and 5% functional accent color. This is a composition guide, not a rendering requirement.

### Orange: action, not decoration

Orange means "you can act on this": the main call to action on a page, links, the
active navigation item, focus rings, the wizard's current step, switches, selected
presets and selected filters. Use it at most once as a filled button per view.

- **Action button (orange):** the one primary next step of a page, such as "Open
  PoolGuard", "Continue", "Review and fund task", "Run task" or "Use sandbox session".
- **Primary button (neutral dark):** important but not the page's main next step, and
  confirmations inside dialogs.
- **Never** use orange for state. Green is success/paid, amber (`warning`) is
  reserved/attention, red is denied/error. Orange sits nearer red than amber in hue
  and is always paired with an actionable affordance, so the two never read as the
  same signal.

Contrast (WCAG AA, checked): white on `#C2410C` 5.18:1; `#C2410C` on `#F8F8F6`
4.87:1; on `#FFF1E8` 4.69:1. `#E8590C` fails for text (3.58:1 with white), so it
is reserved for large non-text graphics.

Do not use opacity to make essential labels unreadable. Verify WCAG AA contrast: 4.5:1 for normal text, 3:1 for large text and essential non-text controls. Decorative borders can remain subtle; meaningful control boundaries must remain distinguishable.

## 5. Typography

Use **Inter Variable** for interface and marketing copy, with system sans-serif fallback. Self-host when practical. Use **IBM Plex Mono** or system monospace for hashes and code. Never block rendering on font downloads.

```css
--font-sans: "Inter", ui-sans-serif, system-ui, -apple-system,
  BlinkMacSystemFont, "Segoe UI", sans-serif;
--font-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, monospace;
```

| Role | Desktop | Mobile | Weight / line height |
|---|---|---|---|
| Landing hero | 64–76px | 38–44px | 500–550 / 1.06 |
| Landing section heading | 40–48px | 28–32px | 500 / 1.15 |
| App page heading | 28–32px | 24–28px | 550–600 / 1.2 |
| Panel heading | 16–18px | 16–18px | 550–600 / 1.35 |
| Body | 15–16px | 15–16px | 400 / 1.55 |
| Table text | 14px | 14px | 400–500 / 1.45 |
| Metadata | 12–13px | 12–13px | 400–500 / 1.45 |
| Budget value | 30–36px | 26–30px | 500 / 1.15 |

Use slightly tightened tracking on large headings, approximately -0.035em. Body tracking stays normal. Use tabular numerals for financial values, counters and timestamps. Do not turn all navigation or labels into uppercase text.

Keep marketing paragraphs to approximately 45–65 characters per line. Give the main hero headline no more than three lines on small phones.

## 6. Spacing, edges and depth

Spacing scale in pixels: `4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 112`.

- Main app content padding: 40px desktop, 24px tablet, 16px mobile.
- Panel padding: 24px desktop, 16–20px mobile.
- Landing sections: 96–112px vertical desktop, 56–72px mobile.
- Related labels and values: 6–8px apart.
- Related fields: 20–24px apart.
- Separate conceptual sections by at least 32px.

Radius:

- Inputs and buttons: 8px.
- Small badges: 6px.
- Workspace panels: 12px.
- Large landing demo window: 16px.
- Dialogs: 14px.
- Pills only for small network indicators or rounded filters, not every control.

Shadows:

```css
--shadow-panel: 0 1px 2px rgb(24 28 20 / 3%);
--shadow-popover: 0 8px 28px rgb(24 28 20 / 9%);
--shadow-demo: 0 18px 56px rgb(24 28 20 / 8%);
```

Use a border plus a quiet shadow for large demonstration windows. Ordinary rows and sections need no shadow. Avoid thick outlines and stacked floating panels.

## 7. Application shell

At widths of 1024px and above:

- Sidebar: 224px, pale neutral background, 1px right divider.
- Top bar: 64px, white or canvas-colored, subtle bottom divider.
- Main content: fluid, maximum approximately 1280px for overview pages.
- Task detail may use the remaining available width up to approximately 1440px.
- The sidebar is navigation, not a second dashboard.

Sidebar contents:

1. PoolGuard mark and wordmark.
2. Workspace/account selector if implemented.
3. Overview.
4. Tasks.
5. Agents.
6. Activity.
7. Separator.
8. Demo lab.
9. Documentation link.
10. Network and account controls near the bottom.

Only show navigation items with actual destinations. Avoid placeholder billing, analytics or enterprise pages.

Selected navigation: neutral tinted rectangle, dark text, medium weight; optional small dark leading indicator. No brightly colored full-width selection strip.

Top bar: breadcrumb on the left; testnet indicator and account control on the right. Place the page's primary action in its content header, not duplicated in three locations.

## 8. Landing page

Build a compact landing page that explains the product through the product itself.

### Navigation

Logo left; How it works, Protection, Developers and Docs as supported links; “Open app” as the orange action button. Use a centered content container around 1160px wide.

### Hero

Small eyebrow: “Agent spending, under control”

Headline:

> One task budget.
> Multiple agents.

Supporting copy:

> Let agents buy the tools they need, with shared limits, approved providers, and a clear record of every payment.

Actions: “Open PoolGuard” and “Watch the demo”. The second button must open a working demo or recording. Do not render a dead control.

Beside it: an interactive, clearly labelled “Illustrative” shared pool. Visitors click an agent to make it buy; the first purchase reserves and is paid once, the second is denied. It plays itself while idle and stops as soon as the visitor interacts. Below the actions, three chips name the protection layers (NEAR AI and OutLayer marked “optional”).

### Scroll story

On large screens one section pins while scroll progress drives three chapters (one purchase’s lifecycle, the shared-budget race, lost-response recovery). On small screens and with reduced motion the chapters stack statically at their final state.

### Three layers of protection

An animated flow from Agent → NEAR AI Cloud → OutLayer → PoolGuard contract → Provider. Visitors switch between an allowed purchase and a prompt-injected one that the contract stops. Each layer states what PoolGuard actually verifies, whether it is optional, and links to its official docs.

### Three benefits

Use three aligned, unboxed columns separated through whitespace:

- “A shared limit” — parallel agents reserve from one pool.
- “Clear authority” — approved providers and bounded purchases.
- “Recoverable payments” — retain the same operation after a timeout.

### Product walkthrough

Two alternating text/product sections:

1. Set the task and its boundaries.
2. Follow every purchase from request to result.

Show a policy form and an operation timeline, not abstract floating icons.

### Developer section

Use a restrained code panel with a short, real SDK example once the SDK exists. The sample must use actual exported APIs and string amounts. Until then, label any conceptual sample as pseudocode.

### Closing action and footer

“Give your agents a budget you can trust.”

Use modest supporting copy explaining that this is a testnet prototype with contract-enforced limits. Avoid “fully secure”, “unhackable” or “guaranteed safe”.

Footer: documentation, repository if public, and network/experimental status. Do not invent pricing or customer logos.

## 9. Overview page

Header: “Overview”; one short explanatory line; “Create task” button right.

Below the header, use one **shared financial summary strip** with available, reserved and spent amounts. Divide the strip subtly; avoid three unrelated oversized metric cards. If totals combine tasks, explain which tasks are included and use one token/network only.

Next: “Active tasks” with a compact table:

| Task | Agents | Available | Reserved | Status | Updated |
|---|---|---|---|---|---|

Rows have 56–64px height, subtle dividers, no zebra stripes by default. Show recent activity below or in a narrower adjacent panel on wide screens.

Empty state: small original icon, “Create your first shared budget”, one useful sentence and “Create task”. No fake metrics or sample tasks mixed with actual state.

## 10. Task detail — primary product screen

This screen is the main demo and deserves the strongest design attention.

### Header

Breadcrumb → task name → small state badge. Underneath show a one-line task objective and creation metadata. Put Run task/Pause in the primary action area, depending on current state.

### Budget panel

Use a wide white panel with:

- Available amount as the largest value.
- Funded total and spent/reserved figures as supporting data.
- Horizontal accounting bar with separate labeled segments.
- Policy link and task expiry.
- Visible “testNEAR · no monetary value” label.

Provide text labels and accessible descriptions so bar color is not the only encoding. Show withdrawals separately when needed; do not make the bar misrepresent the contract's conservation accounting. Storage/operational funds are separate from task spending funds.

Display exact amounts in details/copy controls. Never round a nonzero remaining balance to a misleading zero. Do not show a dollar conversion for test tokens.

### Work area

At 1200px and above, use a main column and a 320–360px activity rail.

Main column:

1. Two agent cards side by side.
2. Purchases table.
3. Result section once available.

Activity rail: ordered event timeline with status icons, concise action text, amount where relevant and timestamp. Expand individual events for technical evidence.

Agent card: 16px icon in a subtle neutral tile, name, current action, step count and concise progress. Examples: “Reading supplier document”, “Waiting for payment confirmation”, “Budget request denied”. Do not use decorative avatars or pretend to expose hidden chain-of-thought. Display actions and decisions, not private model reasoning.

Purchases table: service, agent, amount, payment status, delivery status and time. Clicking a row opens the operation detail drawer. Payment and delivery remain separate columns.

Result section: useful structured comparison, source labels, download if implemented, and a clear statement if some agents could not finish. Do not overwrite partial results with a generic success state.

## 11. Create-task form

Use a focused page with an approximately 760px form column. A secondary summary column may appear on wide screens. On mobile place the summary beneath the fields.

Group fields:

1. Task: name, objective, document inputs.
2. Budget: amount, per-purchase limit, expiry.
3. Access: approved providers and registered agents.
4. Review: exact token/network, task funding and separate setup/storage cost.

Use clear field labels above controls, helpful descriptions below and inline errors. No placeholder-only labeling. Avoid a complex multi-step wizard unless actual user testing warrants it.

Funding button: “Review and fund task”. Before wallet handoff display the action, network and amount. After handoff keep an explicit pending state and recovery path. A closed wallet dialog is not automatically proof the chain action failed.

## 12. Operation drawer

Desktop: 480–560px right drawer. Mobile: full-height page or full-screen sheet. Keep close and back controls accessible.

Top: service name, amount, payment badge and separate delivery badge.

Then show a vertical sequence:

1. Requested.
2. Authorized/reserved.
3. Payment submitted.
4. Payment settled or failed.
5. Result delivered or unresolved.

Use neutral uncompleted nodes, active pending node and labeled outcomes. A rejected request ends with its actual denial; do not render future steps as completed.

Technical details in a disclosure: operation ID, request hash, agent identity, provider account, policy version, transaction hash, receipt references, recovery attempts. Provide copy controls and verified network-specific explorer links. Never fabricate a transaction URL.

Uncertain state example:

> Payment outcome is still being checked.
> PoolGuard will look up the original operation before attempting another action.

Offer “Check status”, not “Pay again”. Disable conflicting actions while recovery is in progress.

## 13. Components

### Buttons

- Action: orange fill (`action`), white text, soft orange shadow. One per view, for the main next step.
- Primary: dark neutral fill, white text, 40px desktop / 44px mobile height.
- Secondary: white or transparent surface, clear border, dark text.
- Ghost: text plus optional small icon; hover surface only.
- Destructive: red treatment only for meaningful destructive action.
- Icon-only: accessible name, tooltip where helpful, minimum 44px touch target.
- Loading: preserve width and label context; disable duplicate submission.

Avoid oversized pill buttons inside dense workspaces.

### Inputs

Height 42–44px, white surface, 8px radius, clearly identifiable boundary. Focus ring: 2px dark sage with 2px offset. Error: danger border plus inline text. Disabled fields remain legible and explain why when necessary.

### Status badges

Small icon + text, 12–13px, subtle tinted background. Suggested labels:

| State | Label | Treatment |
|---|---|---|
| Ready | Ready | Neutral |
| Running | Running | Blue |
| Reservation held | Reserved | Amber |
| Transfer dispatched | Payment pending | Amber |
| Transfer confirmed | Paid | Green |
| Policy rejected | Denied | Red |
| Transfer failed | Payment failed | Red |
| Result returned | Delivered | Green |
| Outcome unknown | Checking status | Amber |
| Stopped by owner | Paused | Neutral |

Use exact state mappings from the implementation. Never collapse “Paid” and “Delivered” into one success badge.

### Menus and dialogs

White surface, fine border, 12–14px radius, restrained shadow. Destructive actions at the bottom. Trap focus in modal dialogs, support Escape, restore focus on dismissal and avoid nested dialogs.

### Toasts

Use for transient confirmations such as “Operation ID copied”. Financial outcomes must also persist in the page timeline. An auto-disappearing toast cannot be the only record of a failed payment.

### Loading and errors

Use layout-preserving skeletons. Do not repeatedly flash the whole screen when one value updates. Show readable retryable errors; never replace an RPC failure with a zero balance. Preserve last-known values with a “Last checked…” label when appropriate.

## 14. Responsive rules

| Width | Layout |
|---|---|
| 360–639px | Single column, 16px gutters, sidebar becomes accessible drawer |
| 640–1023px | Larger gutters; compact navigation; selective two-column forms/cards |
| 1024–1199px | Persistent sidebar; task activity below main work area |
| 1200px+ | Persistent sidebar; task main column with activity rail |

On mobile:

- Stack agent cards and budget values in a deliberate reading order.
- Replace the overview table with labeled task cards when columns no longer fit.
- Keep operation details complete through disclosure rather than hiding critical amounts/status.
- Hashes may wrap or truncate with full-value copy/accessibility text.
- Primary actions remain reachable, but fixed controls must not obscure content or the keyboard.
- Keep body text at least 14px and form controls readable without zoom.
- Marketing hero uses 38–44px headings and full-width or paired actions only when they fit.
- No horizontal page overflow at 360px.

## 15. Motion

Motion is centralized in `lib/motion.ts` (durations, easing, three spring presets) and uses Motion for React plus CSS for simple transitions. Feedback 100–200ms; reveals and layout 250–400ms. Animate `transform` and `opacity` only.

- App: press feedback on buttons, page transitions, gliding indicators, sliding wizard steps, morphing status badges, hold-to-confirm for irreversible actions.
- Landing only: cursor-aware tilt and spotlight (fine pointers only), magnetic main CTAs, scroll-linked pinned story, interactive illustrations.

Balances may roll between two confirmed values for under a second, always settle on the exact string and expose the exact value to assistive technology. Never animate toward a value that has not been confirmed, and never imply finality before confirmation.

Use a subtle progress indicator for running agents.

Honor `prefers-reduced-motion` and the in-app Settings → Motion preference (System / Reduced / Full): with motion reduced, everything renders in its final state and stays usable. Avoid heavy canvas/WebGL effects and continuous decorative animation; the app should run comfortably on an ordinary integrated-graphics laptop.

## 16. CSS foundation

Use these semantic tokens as the source of truth. Adapt Tailwind/shadcn configuration to the installed version; do not maintain contradictory hardcoded palettes.

```css
:root {
  color-scheme: light;
  --background: #f8f8f6;
  --surface: #ffffff;
  --surface-muted: #f1f1ee;
  --surface-hover: #f5f5f2;
  --surface-selected: #eaeae5;
  --foreground: #20211f;
  --foreground-secondary: #565952;
  --foreground-muted: #6c7067;
  --border: #e3e4de;
  --border-strong: #858a7f;
  --primary: #242721;
  --primary-hover: #393e34;
  --primary-foreground: #ffffff;
  --accent: #4d6042;
  --focus: #4d6042;
  --success: #25603e;
  --success-background: #ecf5ee;
  --warning: #805514;
  --warning-background: #fbf3e4;
  --danger: #a33535;
  --danger-background: #faeeee;
  --info: #3c5e87;
  --info-background: #eef3f9;
  --radius-control: 8px;
  --radius-panel: 12px;
  --radius-window: 16px;
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, monospace;
}

body {
  margin: 0;
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}

.financial-value {
  font-variant-numeric: tabular-nums;
}

.workspace-panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-panel);
  box-shadow: 0 1px 2px rgb(24 28 20 / 3%);
}

:where(button, a, input, select, textarea):focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    scroll-behavior: auto !important;
  }
}
```

## 17. Implementation instructions for the coding AI

1. Read the existing PoolGuard build requirements and this file together. This file controls appearance; contract requirements control financial behavior.
2. Inspect existing design tokens and components. Reuse and refine them rather than introducing a second component system.
3. Establish global colors, type, spacing and shell first.
4. Build the task-detail screen as the reference implementation, including pending, denied, paid and delivery-missing states.
5. Apply the same components to overview, create-task, operation detail and landing page.
6. Use original UI-built illustrations for any marketing preview. Use Lucide icons with consistent stroke and size.
7. Wire actual data, actions and state. Clearly label any preview data.
8. Check loading, wallet disconnect, empty data, RPC errors, long task names, small balances and very long identifiers.
9. Inspect rendered screenshots at 1440px, 1024px, 768px and 390px; also verify overflow at 360px. Fix visual defects after inspection.
10. Run keyboard, contrast and mobile interaction checks. Preserve backend and contract behavior while styling.

Do not stop after changing colors or writing a design plan. Implement the complete visual system in the existing application when instructed to build it.

## 18. Acceptance checklist

- [ ] Light neutral design replaces the earlier dark dashboard direction.
- [ ] The task budget is the strongest visual anchor.
- [ ] One clear primary action per screen.
- [ ] Typography, spacing and component radii are consistent.
- [ ] Color is reserved for meaning; most surfaces remain neutral.
- [ ] Product illustrations show PoolGuard concepts rather than generic blockchain art.
- [ ] Task amounts remain exact and testnet status is visible.
- [ ] Paid and delivered are visibly distinct.
- [ ] Pending/unknown is not rendered as failed or successful.
- [ ] Technical evidence is accessible without crowding the main view.
- [ ] Empty, error, loading, denied and partial-result states are designed.
- [ ] No dead controls or fabricated proof, metrics, logos or testimonials.
- [ ] Focus, contrast, touch targets and reduced motion are checked.
- [ ] No page overflow at 360px; mobile details remain usable.
- [ ] Final rendered pages have been visually inspected.

## Reference attribution

[SpaceFS public homepage](https://spacefs.com/) — reviewed 29 October 2026 for product-first content structure and familiar software-interface demonstrations. All PoolGuard design tokens, layouts and proposed copy in this file are an original interpretation, not a reproduction of SpaceFS source or a claim of exact visual matching.
