# Cortext Playground Gallery

These files are the Cortext side of a `WordPress/blueprints` gallery PR.

## Prepare the gallery PR

1. Run `pnpm run build:zip` from the Cortext repo.
2. In a `WordPress/blueprints` fork, create `blueprints/cortext/`.
3. Copy `playground/gallery/blueprint.json` into that directory.
4. Copy `playground/gallery/screenshot.jpg` into that directory.
5. Copy `dist/cortext.zip` into that directory as `cortext.zip`.
6. Open the PR against `WordPress/blueprints`.

The gallery blueprint uses `"resource": "bundled"` and `./cortext.zip`, so the
gallery PR does not depend on GitHub release assets.
