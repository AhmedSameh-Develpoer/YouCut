# YouCut

Windows desktop editor built with Electron, React, TypeScript and Zustand. Arabic/English UI with selectable light and dark themes.

The current editor supports local video playback and seeking, clip start/end controls, a live 9:16 crop preview, optional manual Face Cam composition, audio mute, and real MP4 export up to 1080 × 1920. Face Cam lets the user draw and resize a source region, then place it at the top, bottom, or a custom location; its settings are saved with the project and applied to both single and batch exports. Export asks for the destination, reports progress, supports cancellation, and avoids overwriting existing files. Multiple visual-scene suggestions can be selected and exported sequentially to one folder, with per-clip status and retry. Clips are limited to five minutes.

Projects can be created as `.youcut` JSON files. Recent projects are listed by last opened/worked time and retain a cached entry if their project file becomes unavailable. Use **Open project** to locate and re-register a `.youcut` file; the app checks its stable project ID before relinking a moved entry. Each project gets a stable-ID `.youcut-data` folder with `downloads` and `cache` directories. If its source video moves, opening the project prompts the user to select it again, then validates its readability and saved clip duration. Editor settings autosave after five seconds. Backups keep the latest two healthy project JSON snapshots in the configurable `Documents/YouCut Backups` location by default. Newer valid recovery data is offered for explicit restoration; the app never chooses it silently. Project categories can be changed in the editor. The light/dark theme preference and last export folder are remembered locally.

YouTube/provider downloads, automatic face/object tracking and manual keyframes, multi-track editing, and semantic highlight detection are not implemented yet. Face Cam is a static manual crop/overlay, not a face detector or tracker. Local scene analysis detects visual scene changes and proposes short windows only; it does not detect laughter, action, speech meaning, or semantic highlights. A local activity log records project and media-operation lifecycle events and can be exported on request. Playback uses a local streaming protocol. If Electron cannot decode a source, FFmpeg can prepare a temporary H.264/AAC preview with progress and cancellation. Export always reads the original source. Preview copies are limited to 720p/30 FPS, reused within the session, and removed on normal app exit. Corrupt, encrypted, and unsupported FFmpeg inputs can still fail.

## Run

Install Node.js dependencies with npm install, then run npm run dev.

FFmpeg is required for preview conversion and export; it is not bundled with the installer. The app detects a Gyan FFmpeg WinGet installation, common install folders and PATH, and accepts FFMPEG_PATH pointing to ffmpeg.exe. If ffprobe.exe is missing next to FFmpeg, the app falls back to FFmpeg's input metadata for duration and frame rate.

## Validate and package

Run `npm run build` for TypeScript validation and production bundles. `npm run package:win:portable` creates a self-contained Electron runtime folder in `dist/YouCut-<version>-portable/`; run `YouCut.exe` from that folder and keep its contents together. `npm run package:win` creates the traditional NSIS installer when the Windows packaging tools are available in the Electron Builder cache. The portable review build is unsigned, does not install shortcuts, and does not include FFmpeg.

Video source files and generated export samples are excluded from Git. See PROJECT_REFERENCE.md for the agreed scope and current implementation limits.
