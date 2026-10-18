# YouCut

YouCut is a Windows desktop app for turning long videos into short vertical clips. The current build is an early application shell: it opens a local video and lets the user choose an export path. Video preview, trimming, processing, project persistence, and the actual export engine are still under development.

## Run locally

```powershell
npm install
npm run dev
```

## Check and package

```powershell
npm run typecheck
npm run build
npm run package:win
```

The Windows installer is written to `dist/`. The renderer runs with Electron context isolation, sandboxing, and a small typed preload API; filesystem dialogs stay in the main process.

