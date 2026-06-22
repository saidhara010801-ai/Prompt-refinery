# Clarift Rebrand Verification

## Updated surfaces

- Root metadata, browser title, SEO title, Open Graph title, Twitter title, and web manifest.
- App header, dashboard masthead, authentication screen, Stripe product label, and OpenRouter app title.
- Theme-aware wordmark and icon assets for light and dark modes.
- Favicon and manifest icon references.
- Tailwind font families and light/dark design tokens.
- README, product blueprint, backend description, Firestore rules comment, and production-readiness overview.

## Intentional legacy identifiers

The repository URL, checkout test fixture domains, temporary-file prefix, internal component names, and source folder names retain `prompt-refinery` for compatibility. They are not customer-facing product copy.

## Missing production assets

- Licensed Quilon Regular webfont files (`.woff2` preferred). Until supplied, branded live text falls back to Inter; the supplied outlined wordmark remains exact.
- A dedicated 1200 x 630 Clarift Open Graph/social preview image.
- Dedicated Apple touch icons in PNG format.
- Dedicated raster PWA icons in 192 x 192 and 512 x 512 sizes, including a maskable variant.

## Manual checklist

- Confirm the Clarift dark wordmark appears on light backgrounds.
- Confirm the Clarift light wordmark appears on dark backgrounds.
- Toggle light, dark, and system themes on desktop and mobile widths.
- Verify the browser title and favicon read as Clarift.
- Verify sign-in and sign-up show the Clarift wordmark without layout shifts.
- Verify the dashboard masthead, header controls, tabs, cards, and form contrast.
- Verify checkout health metadata labels the product as Clarift Pro.
- Inspect generated metadata and `/manifest.webmanifest` in a production build.
- Confirm no customer-facing Prompt Refinery copy remains.
- Repeat billing, auth, entitlement, provider, project, and security regression tests unchanged.
