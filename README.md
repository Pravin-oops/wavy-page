# Glyphtide

A full-screen field of controller face-button symbols (△ ○ ✕ □) arranged as a slowly rotating planet, with drifting clouds of symbols around it. Clicking sends waves through the field, and each symbol flashes its own colour on a wave crest: green triangles, red circles, blue crosses and pink squares.

It's plain HTML, CSS and JavaScript with no build step and no dependencies. The Geist fonts for the interface load from Google Fonts, and the page falls back to system fonts when you're offline. The symbols are drawn as shapes, so they don't depend on any font.

## Run it on localhost

Double-click `serve.cmd`, or run:

```bash
powershell -ExecutionPolicy Bypass -File serve.ps1
```

It serves this folder at http://localhost:5173/ and opens your browser. Use `-Port 8080` to change the port or `-NoBrowser` to skip opening the browser, and press Ctrl+C to stop it.

Any other static server works as well, for example `npx serve .` if you have Node, or VS Code's Live Server extension.

## Controls

| Input | Effect |
|---|---|
| Click / tap | Sends a wave from that point |
| Drag | Leaves a trail of smaller, shorter-lived waves |
| Mouse hover | Magnifies the symbols under the cursor |
| Space | Sends a big pulse from the planet's centre |
| Type a word + Enter | Writes the word into the field in coloured symbols. It holds for a few seconds, then dissolves |
| Slate / Ember / Moss | Switches the colour palette (remembered per browser) |

The page slows the planet down and turns off the ambient motion when the system's "reduce motion" setting is on.

## High refresh rate displays (120 Hz and up)

A 120 Hz display gives each frame 8.3 ms, and 144 Hz gives it 6.9 ms. The page is built to fit well inside that:

- **One draw call per frame.** The symbols are drawn with WebGL2 instancing: each visible cell is one instance that reads from a small symbol texture. Brightness and colour are computed on the GPU, so they change smoothly instead of in steps, and moving symbols are placed at sub-pixel positions.
- **Little work per frame.** The planet's lighting and longitude are worked out once per resize, since spinning it only shifts the texture sideways. The drifting clouds are refreshed a band of rows at a time. Each wave only touches the cells its ring covers, and uses lookup tables instead of `Math.exp`, `sin` and `cos`.
- **Time-based motion.** Waves, rotation, shimmer, cloud drift and the cursor lens are all measured in seconds rather than frames. The page moves at the same speed on 60, 120 and 144 Hz screens, just more smoothly on the faster ones.

The readout in the top right shows the grid size, the number of live waves, the frame rate and **ms**: how long the script takes per frame. In testing this was 0.2 ms at rest and about 1.5 ms with several waves and a word on screen. If fps reads below your display's refresh rate while ms stays low, the browser is limiting the frame rate, not the page. Hover the readout to see which renderer is in use.

If WebGL2 isn't available, the page falls back to a 2D canvas renderer. It looks the same but costs about 12 ms per frame, so expect around 60 fps. Add `#canvas2d` to the URL to try it.

## Files

- `index.html`: the page and HUD markup
- `styles.css`: the HUD styles and colour tokens
- `main.js`: the field simulation, the WebGL2 renderer and the 2D canvas fallback
- `serve.ps1` / `serve.cmd`: the local server

## Tuning

The constants at the top of `main.js` control the motion:

- `SPEED`: how fast a wave front travels, in px/s
- `K`: the wavelength (`TAU / 64` gives 64px between crests)
- `DISP`: how far crests push the symbols
- `DECAY` / `TRAIL_DECAY`: how long click waves and drag-trail waves last
- `STAMP_HOLD`: how long a written word stays lit
- `SHIMMER_RATE`: the fraction of symbols that swap each second
- `SYMBOL_COLORS`: the crest colours for the triangle, circle, cross and square
