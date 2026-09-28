# Grill Room video

A 36-second motion-graphics video of the Grill Room flow, made in HTML and GSAP and rendered with [HyperFrames](https://github.com/heygen-com/hyperframes). It is built from one source, `src/video.js` and `src/styles.css`, and has two cuts: `index.html` (1920×1080) and `cuts/vertical.html` (1080×1920). Rendering needs Node 22 or later and ffmpeg.

```bash
npm ci
npm run music                                           # regenerate music/bed.wav (100 BPM, -16 LUFS)
HYPERFRAMES_NO_TELEMETRY=1 npm run render:16x9          # out/grill-room-16x9.mp4
HYPERFRAMES_NO_TELEMETRY=1 npm run render:9x16          # out/grill-room-9x16.mp4
```

The root README's animated preview, `docs/media/intro.webp`, is made from the 16:9 cut: it is silent, loops, and runs at 960 px wide and 15 fps. This ffmpeg build has no WebP encoder, so ffmpeg writes a GIF and `gif2webp` converts it, the same route `just demo` uses for `demo.webp`. Run from `video/`:

```bash
ffmpeg -y -i out/grill-room-16x9.mp4 -an -vf "fps=15,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" /tmp/intro.gif
gif2webp -quiet -lossy -q 85 -m 6 -mixed /tmp/intro.gif -o ../docs/media/intro.webp
```

The scene cuts are set in `CUT` in `src/video.js`, on the music's 0.6-second beat. If you change them, change `music/make-music.mjs` to match.
