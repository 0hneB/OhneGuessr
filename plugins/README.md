# Additional plugins

This directory is the published catalog for optional renderer plugins. Released
OhneGuessr clients download `registry.json`, each plugin's `manifest.json`, and
its compiled `index.js` directly from this GitHub path, so the directory layout
is a compatibility boundary.

Edit `*/src/index.ts` and `*/manifest.json`, then run:

```sh
npm --prefix plugins run build
```

The build updates the committed `index.js` files and checksum-bearing
`registry.json`. Built-in game modes and map integrations live separately in
`internal/plugins/`.
