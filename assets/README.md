# App artwork

- `source/background.svg` + `source/foreground.svg`: editable icon layers (the paw stays inside the adaptive-icon safe zone).
- `icon-only.png`, `icon-foreground.png`, `icon-background.png`, `splash.png`: 1024px / 2732px renders used to generate the Android launcher icons and splash screens.

After changing these PNGs, run `npm run icons` to regenerate everything under `android/app/src/main/res/`.

Google Play store graphics (512px icon, 1024x500 feature graphic, screenshots) are in `../store-listing/`.
