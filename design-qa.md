# RepoLight logo QA — 2026-10-22

Scope: apply the approved chip-panel logo and glowing amber light to the shared Brand component and browser icons. Existing page layouts and editable wordmark/tagline remain the product UI; the reference is a logo presentation, not a replacement login layout.

Source visual truth: `/Users/stew/.codex/generated_images/01a15c49-e31b-7060-8c2b-a7d1bc347706/exec-d981d93e-acd8-4c7a-951b-ecebd2748787.png`.
Asset isolated with Image Gen from that reference, then resized without changing artwork: `public/repolight-mark.png` (512×512), `public/repolight-icon-16.png`, `public/repolight-icon-32.png`, `public/repolight-apple-icon.png` (180×180).

Implementation captures: `output/playwright/repolight-chip-login.png` (394×604 mobile viewport) and `output/playwright/repolight-chip-reports.png` (1280×720 desktop viewport), captured in the in-app browser. Screenshot pixel dimensions equal CSS viewport dimensions. Report headers render the logo at 36×36 CSS pixels. The subsequent sign-in refinement uses 36×36 CSS pixels without distortion, with its tagline on a separate row beneath the logo/title.

Combined comparison evidence: `output/playwright/repolight-chip-comparison.png`. Top left is the approved icon crop normalized to 240×240; top right is the installed asset normalized to 240×240. Bottom left is the browser-rendered login brand region at its original density; bottom right contains actual 16px/32px favicon assets. This focused comparison makes the chip layout, light, shine, halo, and small-size readability inspectable together. Full-view captures establish the unchanged surrounding form/header layout.

Findings: no actionable P0/P1/P2 differences. The isolated asset preserves the chosen sparse orthogonal chip-panel geometry, centered light, warm gradient, upper-left highlight and diffuse halo. Minor regenerated color/line variation is acceptable at the intended 36px size.

Required fidelity surfaces:
- Typography: existing shared RepoLight wordmark and small tagline remain readable and correctly aligned; no text was baked into the icon.
- Spacing/layout: existing 36px mark, spacing, and responsive headers preserved. Mobile login has no horizontal overflow (394px viewport/content); desktop reports header remains balanced.
- Colors/tokens: dark teal tile, muted teal lines, amber center and pale highlight match the selected direction.
- Asset quality: real generated raster artwork is used; rounded corners have transparency, no page background/wordmark crop, and no stretching. Browser icons are downsampled from the same artwork. The earlier SVG is removed.
- Copy: RepoLight and “Code revealed.” unchanged.

Checks: typecheck, lint and git diff --check passed. Browser confirmed loaded logo and PNG icon metadata at 16×16, 32×32 and 180×180; reports console errors empty. Login and report form fields/actions remain present. No auth submission or repository collection was needed for this asset-only change; database-backed auth was not tested. Full unit suite/build not repeated for the localized asset/metadata update.

Comparison history: initial asset comparison passed; no P0/P1/P2 remediation iterations required.

final result: passed

Sign-in refinement: `output/playwright/repolight-larger-signin.png` visually verified at a 395px viewport. Logo now measures 36×36; tagline begins below the logo and title and aligns to the icon’s left edge. Viewport/content widths both 395px, logo loaded, accessible RepoLight heading and form labels preserved. Typecheck/lint/diff check passed.

Latest refinement: tagline shortened to “Code revealed.” and sign-in logo restored to 36px, keeping the tagline beneath the logo/title row.

Centered sign-in refinement: `output/playwright/repolight-centered-brand.png` inspected at 1280×720. Logo/title group and tagline centers align at x640, matching the form center. Tagline is “Code revealed.” at 14px/500 weight, beneath the group. No horizontal overflow. Typecheck/lint/diff check passed.
