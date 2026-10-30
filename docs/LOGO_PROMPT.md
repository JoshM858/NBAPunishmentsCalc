# Logo prompt for the home-screen icon

Paste this into ChatGPT (image generation):

> Design a square app icon for a fantasy basketball app called "NBA Punishments". Flat vector style, bold and simple, readable at 60 pixels. A dark charcoal background (#101216) with one big electric-yellow (#E8F02A) basketball viewed straight on, drawn with thick dark seam lines. Give the ball a small mischievous touch that hints at a punishment, such as a tiny cracked line, a sweat drop, or a bold exclamation mark, without any extra clutter. No text, no letters, no gradients, no shadows, no thin lines, no border or rounded corners (the phone rounds the corners itself). Centre the artwork with about 15% empty margin on every side so nothing is cut off. Square 1024 x 1024 PNG.

Then make the three icon files and replace the ones in `public/icons/`:

- `icon-512.png` (512 x 512), `icon-192.png` (192 x 192) and `apple-touch-icon.png` (180 x 180): the image, resized.
- `maskable-512.png` (512 x 512): the same image with extra background colour around it so the ball sits inside the middle 60% (Android crops this one into a circle or squircle).

`icon.svg` is only the placeholder source and is not used by the phone. After replacing the PNGs run `npm run build:dashboard` if you use the pasted Cloudflare file. On a phone, remove the old home-screen icon and add it again to pick up the new one.
