# M13 Champion Identity & Ability UI

**Date:** 2026-08-13  
**Branch:** `milestone-13-champion-identity-ability-ui` (from `master` @ `d361b24`, M12-v2 merged)  
**Status:** M13_COMPLETE

---

## Executive summary

M13 adds champion passive + Q/W/E/R to the existing `/champions/:championKey` splash hero using static Data Dragon data. Identity still comes from `champion.json`. Abilities overlay from `championFull.json` into the existing `ChampionStaticData.passive` / `spells` JSON columns. The public API exposes a sanitized `ChampionAbilitySummary[]` on champion detail only. The frontend ability row sits above existing analytics; desktop uses hover preview + click pin; mobile uses tap + an anchored card. No new migrations, no live Riot calls, no matchup/build/AI/crawler work.

Closeout review (code-reviewer) found no Critical issues and no scope leak. Important interaction/a11y gaps were fixed before commit: pinned abilities ignore neighbor hover; the detail card is a disclosure region rather than an unmanaged dialog; unit tests cover hover, pin survival, outside click, Close, and coarse-pointer.

---

## Static-data architecture

```
champion.json        → identity roster (name, title, tags, images, base stats)
championFull.json    → best-effort overlay of passive + spells
existing JSON cols   → trimmed persistable snapshot (no tooltip)
read-time extract    → ChampionAbilitySummary[] + Data Dragon icon URLs
```

- **No new DB columns or Prisma migration.** `passive Json` and `spells Json` already existed; pre-M13 sync stored empty `{}` / `[]`.
- Overlay is inside `syncChampionStatic` after identity mapping. A `championFull.json` 404/timeout is logged (`Champion ability overlay skipped`) and identity sync continues.
- Ability order is deterministic: `PASSIVE` first, then Data Dragon `spells[0..3]` as Q/W/E/R.
- Champion-detail **read path** maps stored JSON through `extractChampionAbilities`. It does not call Riot and does not fetch Data Dragon per request. Icon URLs are built from the stored `dataDragonVersion`.
- Directory `listChampions` does not select ability blobs.

Rejected: Redis/live CDN on page load, per-champion Data Dragon files at request time, new columns.

---

## Ability contract

Shared Zod on `ChampionDetail` only (not directory `ChampionSummary`):

```ts
ChampionAbilitySlot = 'PASSIVE' | 'Q' | 'W' | 'E' | 'R'

ChampionAbilitySummary = {
  slot
  name            // fallback "Passive" / "Q" / … if missing
  description     // normalized plain text; may be ""
  iconUrl         // absolute Data Dragon URL or null
  cooldown?       // cooldownBurn when present
  cost?           // costBurn when present
  range?          // rangeBurn when present
}
```

- Empty stored blobs → `abilities` omitted (UI hides the row). Backward compatible: existing clients ignore the optional field.
- Partial data still emits five slots with fallback names / null icons.
- No `tooltip`, no raw HTML, no `{{ e1 }}` substitution, no PUUID / `rawPayload` / internal static IDs.

`normalizeAbilityDescription`: `<br>` → newline, strip tags, decode common entities, drop `{{ … }}` without inventing numbers, collapse whitespace. Vue renders with text interpolation (`{{ }}`), not `v-html`.

---

## Backend/shared changes

- `packages/shared/src/champion-abilities.ts` — snapshot, sanitize, extract
- Sync fetch: `fetchChampionFullFile` (`championFull.json`)
- Sync mapper: `overlayChampionAbilitySnapshots`; snapshots omit `tooltip`
- Sync core: overlay wrapped in try/catch so identity still upserts
- `DataDragonChampionService.buildPassiveIconUrl` / `buildSpellIconUrl`
- `ChampionStaticRepository.findByChampionKey` selects `passive` / `spells`
- `mapChampionDetail` attaches `abilities` when extract returns a non-empty array
- Seed: Ahri gets a real-ish snapshot; other seed champs keep empty blobs

No MatchupAggregate writer, collector, scheduler, or Riot match/league changes.

---

## Frontend integration

Existing `ChampionDetailHero.vue` (not renamed). New:

| File | Role |
| --- | --- |
| `ChampionAbilityBar.vue` | P/Q/W/E/R toolbar, open/pin/close |
| `ChampionAbilityButton.vue` | Icon + slot label + accessible name |
| `ChampionAbilityPopover.vue` | Name, description, cooldown/cost/range |

Hierarchy:

1. Splash (overflow clipped on the splash layer only so the card can paint)
2. Portrait + name + title + tags
3. Ability row
4. Existing Context filters
5. Existing Primary stats / Performance / Position breakdown

No Overview / Builds / Matchups tab system was added (it did not exist on master).

---

## Desktop interaction

- Hover (`hover: hover` + `pointer: fine`) opens a temporary detail card when **nothing is pinned**
- Click pins; cursor can move into the card (160ms close delay on unpinned hover-out)
- Clicking another ability switches and keeps the pin
- Hovering a neighbor **does not** unpin
- Clicking the pinned ability again, outside pointer-down, Close, or Escape closes
- No popover library

---

## Mobile interaction

- Hover is ignored on coarse/touch pointers
- Tap opens the same anchored card **below** the ability row
- Tap another ability switches detail
- Outside tap / Close / Escape closes
- Card is `max-w-xl` and stays in document flow (~390px)

---

## Accessibility

- Real `<button>` elements (Tab, Enter, Space)
- `role="toolbar"` + per-button `aria-label` (`Passive: Essence Theft`, `Q: Orb of Deception`, …)
- `aria-expanded` / `aria-controls` only on the open button
- Detail card is `role="region"` labelled by the ability heading (disclosure, not an unmanaged modal dialog)
- Tab does not auto-open five panels; Enter/Space pins via click
- Escape / Close restore focus to the ability button
- `:focus-visible` uses `--lh-accent`
- Ability information is not hover-only

---

## Error/fallback behavior

| Condition | Behavior |
| --- | --- |
| Empty `passive`/`spells` (pre-M13 READY patch, no re-sync) | `abilities` omitted; ability row hidden; identity + analytics still render |
| `championFull.json` fails during sync | Identity sync succeeds; abilities stay empty until a later successful overlay |
| Missing icon URL or image error | Slot-letter fallback square |
| Missing cooldown/cost/range | Metadata row omitted |
| Missing ability name | Slot fallback (`Passive` / `Q` / …) |
| Annie (and similar) with no snapshot | Page does not break |

---

## Test results

Fresh closeout run:

| Suite | Result |
| --- | --- |
| `@league-helper/shared` test | **216 passed** |
| `@league-helper/shared` typecheck / lint / build | clean |
| `@league-helper/api` unit | **451 passed** |
| `@league-helper/api` typecheck / lint / build | clean |
| `@league-helper/web` unit | **129 passed** (was 124; +5 ability interaction tests) |
| `@league-helper/web` typecheck / lint / build | clean |
| Champions API integration | **8 passed** (Ahri abilities + Annie empty → omitted) |
| Playwright `champions.e2e.ts` | **17 passed** (Ahri, Aatrox, Zed ability row; Annie missing abilities does not break identity/analytics) |

First Playwright attempt in this closeout failed with `ERR_CONNECTION_REFUSED` because `PLAYWRIGHT_SKIP_WEBSERVER=1` was set while Nuxt was down. Rerun with Playwright’s webServer: 17 passed.

---

## Visual validation

Local screenshots in `%TEMP%\m13-visual\` (**not committed**):

| Champion | Widths |
| --- | --- |
| Ahri | 1440 / 1024 / 390 |
| Aatrox | 1440 / 1024 / 390 |
| Aurelion Sol | 1440 / 1024 / 390 |

Observed:

- Ability row is in the splash hero, above Context / Primary stats / Position breakdown
- Ahri Q card: **Orb of Deception**, sanitized description, Cooldown `7`, Cost `55/65/75/85/95`, Range `970`; Close control visible; no tooltip clipping (card is in flow)
- 390px stacks the ability row and anchored detail without replacing analytics
- Contrast is readable on the existing splash gradient + dark glass card
- Existing collected-sample UI is intact (no matchup/build/AI sections)
- Some Data Dragon icons/portraits were still loading at capture time, so slot-letter fallbacks appeared. API URLs are valid CDN paths; this is graceful degradation, not a contract failure
- Long ability copy uses `whitespace-pre-line` in a `max-w-xl` card

No redesign was performed.

---

## Operability / static re-sync requirement

Abilities are populated only by static sync (Data Dragon CDN). **No Riot API key is required.**

Command (already documented in `README.md`):

```bash
pnpm champions:sync-static --dry-run
pnpm champions:sync-static
pnpm champions:sync-static --json
```

Existing READY patches that were synced before M13 keep empty `{}` / `[]` blobs until one re-sync. After deploy, operators should re-run `pnpm champions:sync-static` so the ability row appears. Local validation used Data Dragon **16.16.1**, 173 champions.

Do not add runtime Data Dragon/Riot fetching to skip re-sync.

---

## Known limitations

- Ability data appears only after a static-data **re-sync**
- `championFull.json` overlay is best-effort
- Data Dragon `tooltip` / `effect` / scaling arrays are not exposed; placeholders are stripped, not filled
- Cost/range/cooldown are `*Burn` display strings, not per-rank computed values
- No Overview / Builds & Runes / Matchups tab chrome
- Toolbar arrow-key roving tabindex was not added (Tab through five buttons is acceptable)
- Sync mapper still has unused throwing CDN URL helpers; read path uses `DataDragonChampionService` null-safe builders
- Sanitizer does not decode hex entities; Vue text interpolation still escapes leftover markup
- Production deploy is out of scope

---

## Scope exclusions

Verified against the M13 diff (no leak):

- MatchupAggregate writer / Strong Against / Weak Against UI
- Build analytics
- AI coaching
- Population acquisition / crawler / scheduler changes
- Production deployment
- Unrelated champion-page redesign
- Real `.env` files, Riot keys, DB credentials, screenshot artifacts

README gained one operator comment on the existing `champions:sync-static` block (re-sync after ability UI). No other unrelated tracked files.

---

## Completion decision

**M13_COMPLETE**

Gates:

- Scope clean
- Static-data path audited
- Contract backward compatible
- Interaction + a11y closeout fixes landed
- Visual review of existing local screenshots
- Tests / lint / typecheck / builds passed
- Env/secret safety passed
- Screenshots remain local-only
