# Task 6-b — Frontend favorites quick-transfer (UrPay)

Scope: edit `src/components/urpay/transfer-view.tsx` ONLY (+ worklog append). Backend `/api/favorites` + `urpay.ts` methods + dict `transfer.fav*` keys were already complete (see cron-round-6 in worklog.md).

## What was built
1. **Favorites quick-pick** (inside transfer form card, above search field)
   - `favs: FavoriteItem[] | null` loaded via `loadFavs` useCallback (`urpay.favorites(token)`, silent catch → `[]`); re-runs on `[loadFavs, reqSignal]` and after add/remove.
   - Renders only when `favs.length > 0`: header (gold Star + `t("transfer.favTitle")` + `t("transfer.favHint")`), horizontal `overflow-x-auto scrollbar-slim` chip row.
   - Chip: UserAvatar(32) + truncated name + `•••• last4` (`num`, `dir="ltr"`), rounded-2xl, `border-border/70 bg-secondary/60`, hover `border-gold/50 bg-gold/[.06]`; selected chip (matches receiver card) → `border-gold/60 bg-gold/10` + tiny corner star badge + `aria-pressed`.
   - Remove ✕ at chip corner: `opacity-0 group-hover:opacity-100 focus:opacity-100`, destructive hover tints. `removeFav(f.user_id)` → `favoriteRemove` → toast `favRemoveToastTitle` → reload (silent catch).
   - `pickFavorite(f)`: sets receiver from FavoriteItem, clears query/results/cardInput, focuses amount input via `amountRef`.
2. **Star toggle on receiver row**
   - Star Button (sm/ghost/rounded-xl) before "تغيير": filled `fill-gold-deep text-gold-deep` if in favs (click → remove), else outline (click → `favoriteAdd(receiver.card_number)` → toast `favAddedToastTitle` / error → `favFailToastTitle` destructive). Label `t("transfer.favAddBtn")` with `hidden sm:inline`. Tiny gold badge on the avatar when favorited.
3. **i18n / design**: all strings from existing `transfer.fav*` keys (no dict edits); gold-only accents, logical props (ps/pe/start/end) for RTL+LTR, dark-mode tint patterns, no blue/indigo.

## Class corrections vs spec sketch (intentional)
- ✕ button: `hidden group-hover:flex ... flex` conflict → always `flex` + opacity transition (keeps focus-visibility working).
- `pt-1.5` on chip scroll container so the -6px ✕ offset isn't clipped by `overflow-x-auto`.
- Added `favHint` to header (key existed for this feature).

## Verification
- `bunx eslint src/components/urpay/transfer-view.tsx` → **exit 0**
- `bunx tsc --noEmit | grep transfer-view` → **empty** (0 errors in src/; only pre-existing examples/ + skills/ errors)
- dev.log: recompiled ✓, no errors. No build / no browser test (parent does E2E).
- Files touched: `src/components/urpay/transfer-view.tsx`, `worklog.md` (append only), this record.

Status: **COMPLETE** — ready for parent E2E QA.
