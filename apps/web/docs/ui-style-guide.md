# LauncherDesk E-Stamp UI style guide

Tokens live in `tailwind.config.js` and `src/index.css`. Components live in
`src/components/ui/`. Use them before writing new classes.

## Colour

| Token | Base | Use |
| --- | --- | --- |
| `brand` / `ultramarine` | #2B3FD9 (600) | Primary actions, links, focus ring, in-window status |
| `midnight` | #14193F (900) | Master admin shell, overlay scrim |
| `teal` | #0E9AA7 (500), deep #0C3C44 (900) | Assistant master admin shell, secondary data |
| `marigold` | #FFB020 (400) | Accent: active nav marker, awaiting balance update. Always dark ink text on it |
| `emerald` | #12A36B (500) | Issued, credited, active, success |
| `vermilion` | #E5484D (500) | Failed, danger, errors |
| `magenta` | #C13584 (500) | Vendor stage (staff screens only) |
| `violet` | #7C52F3 (500) | "Being prepared" only |
| `slate` | cool neutral | Text, borders, surfaces |
| `paper` | #F6F7FF | Page background |

Every ramp runs 50-900. Text pairs that pass WCAG AA: `*-700` on `*-50`/`*-100`,
white on `*-600` and darker, `slate-400` and darker on white or Paper.
Tailwind's default `red`, `green`, `amber`, `yellow`, `blue`, `sky`, `indigo`
and `gray` are aliased onto these ramps, so older classes follow the palette.
New code uses the token names.

Semantic aliases: `primary`, `success`, `danger`, `warning`, `info`, `vendor`.

### Role shell

`DashboardLayout` sets `data-role` on the shell; `src/index.css` maps it to
`--role-sidebar`:

| Role | Sidebar |
| --- | --- |
| SUPER_ADMIN, ADMIN, USER | deep ultramarine #1B2A9B |
| MASTER_ADMIN | midnight #14193F |
| ASSISTANT_MASTER_ADMIN | deep teal #0C3C44 |
| VENDOR | aubergine #3A1740 |

Active nav item: a lighter tint plus a 3px marigold left marker.

## Status

Use `StatusChip` (or the `StatusBadge` / `PaymentStatusBadge` /
`BalanceStatusBadge` wrappers) for every status. The mapping is in
`src/components/ui/status.js`.

| Meaning | Tone | Client label |
| --- | --- | --- |
| Inside the 20-minute window | blue | "14:32 left to edit" (live) |
| Any internal stage after the window | violet | Being prepared |
| Issued | emerald | Issued |
| Failed | vermilion | Failed |
| Cancelled | grey | Cancelled |
| Awaiting balance update | marigold | Awaiting balance update |
| Credited | emerald | Credited |
| Active / Inactive | emerald / grey | Active / Inactive |

Client roles (SUPER_ADMIN, ADMIN, USER) never see assistant or vendor stage
names. Staff and vendors see the enum value. Pass `remainingSeconds` (from
the server's `windowRemainingSeconds`) or `deadline` to get the countdown;
it ticks every second and stops at zero.

## Type

- Headings and large numbers: Bricolage Grotesque (`font-display`).
- UI text: Public Sans (`font-sans`, the default).
- Money: always `tabular-nums` (or `.money`), formatted with
  `formatCurrency` (en-IN, for example ₹1,25,000).
- Sentence case everywhere. No all-caps eyebrow labels.

## Shape and depth

| Element | Radius |
| --- | --- |
| Inputs, buttons | 10px (`rounded-lg`, `rounded-input`) |
| Cards | 14px (`rounded-xl`, `rounded-2xl`, `rounded-card`) |
| Dialogs | 20px (`rounded-dialog`) |
| Chips | full |

Cards are flat with a hairline border (`.card`). Shadows only on overlays
(`shadow-overlay`, `shadow-lg`, `shadow-xl`); `shadow-sm` and `shadow` are
intentionally empty. No gradients.

## Motif

One decorative motif: the perforated stamp edge (`StampCard`, `.perforated`).
Used on the balance card, the login brand panel and certificate cards only.

## Motion

Only in response to an action (drawer, dialog, button press). Everything
respects `prefers-reduced-motion`.

## Icons

lucide-react only, via the component or `Icon`. No emoji.

## Copy

Sentence case, verb-first buttons ("Add money", "Download certificate").
Errors say what happened and what to do. No "please", no "successfully", no
exclamation marks.

## Components

| Component | Notes |
| --- | --- |
| `Button` | `variant`: primary, secondary, ghost, danger, accent. `size`: sm, md, lg. `loading`, `icon`, `to`, `href` |
| `Card` | `title`, `subtitle`, `actions` |
| `StatTile` | `icon`, `value`, `label`, `tone`, optional `to` |
| `StatusChip` | `status`, `kind` (request, batch, payment, balance, account, vendor), `remainingSeconds`, `deadline` |
| `WindowCountdown` | `seconds` or `deadline`, `onExpire` |
| `Field`, `Input`, `Select`, `Textarea` | `Field` wires label, hint and error ids |
| `Table`, `Th`, `Td`, `Tr` | Scroll wrapper, sticky header, hover rows |
| `Modal`, `ConfirmDialog` | Focus trap, Escape, restores focus |
| `Tabs` | Arrow keys, Home, End |
| `Stepper` | `steps`, `current` |
| `Toast` | `tone`: success, error, info |
| `Skeleton`, `PageSkeleton` | Loading placeholders |
| `StampCard` | Perforated edge, `tone`: light or brand |
