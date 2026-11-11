# Booking.com hotel recipe — contributor notes (issue #40)

## What the recipe delivers

Two built-in recipes (split per the one-concern-per-recipe guideline), matching
`www.booking.com`/`booking.com` on `/hotel/**`:

- **`booking-hotel-noise`** — forces a Playwright render (the raw HTTP response
  is an AWS WAF challenge shell, no content ever reaches the extractor without
  a browser), waits for `#hp_facilities_box`, then strips page chrome in
  `preprocess`: header/footer shells, searchbox, gallery, breadcrumbs,
  Genius/promo/reward banners, wishlist and share widgets, review-avatar flag
  images, payment-card placeholder gifs, the survey widget, and the Q&A
  ("Travellers are asking") skeleton. Finally it unwraps the
  `data-capla-component-boundary` / `.page-section` wrappers.
- **`booking-hotel-frontmatter`** — maps the page's `Hotel` JSON-LD node into
  frontmatter: `description`, `address` (full street address, geocodable),
  `rating` / `rating_best` / `review_count`, and `price_range` (present in the
  JSON-LD schema but observed as `null` → usually omitted).

Verified against `https://www.booking.com/hotel/de/adlon-kempinski-berlin.en-gb.html`:
the body contains the hotel description, the "most popular facilities" list,
the room-type table, restaurants, house rules and fine print. With
`checkin`/`checkout` (+`group_adults`) query params in the URL, the room table
includes live prices per room type (verified: €-amounts per room, breakfast
pricing). Ten pre-selected listings can thus be compared by fetching ten URLs
with the same date params — which is the use case in #40.

## Deliberately excluded, and why

- **Guest FAQ ("Travellers are asking")** — the answers lazy-load on scroll;
  the rendered DOM only ever contains an empty skeleton ("Still looking?").
  A recipe cannot scroll or click, so the block is removed rather than shipped
  as noise. Solving this would need renderer support (scroll-to-bottom /
  click-to-expand), not a recipe.
- **Full facilities list by category** (Bathroom, Wellness, …) — same story:
  only the "most popular" subset is present in the extractable DOM; the full
  grouped list did not survive extraction reliably. The popular subset covers
  the pool/WiFi/parking/gym signals the issue asks for.
- **Individual review texts** — review cards load lazily/paginated; only
  headline scores are stable. `rating`/`review_count` in the frontmatter cover
  the comparison use case. "Reviews on demand" (per-request opt-in) is not
  expressible in the recipe schema anyway — recipes have no request-time
  parameters.
- **Structured amenity/price lists in frontmatter** — frontmatter field values
  must resolve to a single primitive (string/number/bool); lists of rooms or
  amenities are not representable. They stay in the Markdown body instead.

## Reliability note

Booking occasionally serves a near-empty shell even to the rendered pass
(observed once in ~6 runs: `quality: 0`, body = "Skip to main content", while
JSON-LD frontmatter still resolved). A `nocache=1` retry fixed it. Nothing a
recipe can do about that.

## Doc feedback (where the guide let me down)

1. **`select.remove` silently does nothing when Trafilatura wins.** The guide
   presents `select.remove` and `preprocess`/`remove-element` as equivalent in
   effect ("same effect", §7). Empirically my `select.remove` selectors had
   zero effect on this page: `cleanDom()` applies them to the linkedom
   `document` used by Readability, but the Trafilatura sidecar receives
   `cleanedHtml`, which is serialized *before* `cleanDom` runs
   (`lib/web.js` — serialize at ~l.369, `cleanDom` at l.393). On any page where
   the quality auto-pick selects Trafilatura, `select.remove` is invisible in
   the output. `preprocess` edits the HTML string itself and affects both
   branches. The guide should either warn loudly ("use `preprocess`
   `remove-element` if the site may extract via Trafilatura") or the pipeline
   should apply `removeSelectors` before serializing. I moved everything to
   `preprocess` for this reason.
2. **Execution order `preprocess` vs `select.remove` is unstated.** I had to
   read `lib/web.js` to learn that `preprocess` runs first — which matters when
   a `remove-element` targets a wrapper that a later `unwrap` would dissolve
   (my boundary-attribute selectors). One sentence in §4 or §7 would fix this.
3. Minor: §10's testing loop assumes the sidecars are reachable; a hint that
   `TRAFILATURA_URL`/`PLAYWRIGHT_URL` can point at locally-run sidecar
   containers (or that missing sidecars change which extractor wins, and thus
   what your recipe appears to do) would have saved one confused iteration.
