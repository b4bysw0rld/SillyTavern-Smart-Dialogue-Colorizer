# Smart Dialogue Colorizer

An improved SillyTavern extension that automatically colors dialogue quotes based on character avatars with intelligent color extraction and quality filtering.

## ✨ Features

### Smart Color Extraction
- **Intelligent Fallback System**: Automatically tries multiple color extraction methods in order:
  - Vibrant colors (for colorful, eye-catching avatars)
  - Dark/Light Vibrant variants
  - Muted colors (for subtle avatars)
  - Average palette color (as final fallback)
- **Quality Filtering**: Automatically rejects colors that are too dark, too light, or too desaturated
- **Enhanced Contrast**: Optimizes colors for readability on dark backgrounds

### Customization Options
- **Character Colors**: Separate settings for characters and user personas
- **Color Sources**:
  - Avatar Smart (recommended) - Intelligent extraction with fallbacks
  - Static Color - Use the same color for all
  - Per-Character Override - Set custom colors for specific characters
  - Disabled - Turn off auto-coloring
- **Per-Character Overrides**: Set specific colors for individual characters in their character editor
- **Global Color Adjustments**: Fine-tune all avatar-extracted colors with:
  - Hue adjustment (-30° to +30°) - Shift colors on the color wheel
  - Saturation adjustment (-50% to +50%) - Boost or reduce vibrancy
  - Brightness adjustment (-50% to +50%) - Make colors brighter or darker
- **Character Name Coloring**: Optionally apply colors to character names in addition to dialogue quotes

### CSS Variable Support
Assigns character colors to a CSS variable `--character-color` scoped to message elements for use in custom CSS:

```css
/* Example: Color avatar borders */
div.mes .mesAvatarWrapper .avatar {
    outline: 1px solid var(--character-color);
    box-shadow: 0px 0px 2px 1px rgb(from var(--character-color) r g b / 80%);
}

/* Example: Color message metadata */
div.mes .mesIDDisplay:not(:empty) {
    outline: 1px solid var(--character-color);
    background-color: rgba(20, 20, 20, 0.7);
}
```

## 📦 Installation

1. Open SillyTavern
2. Go to **Extensions** → **Install Extension**
3. Enter this repository's URL
4. Click **Save**

Alternatively, manually place the extension folder in:
```
SillyTavern/public/scripts/extensions/third-party/Smart-Dialogue-Colorizer/
```

## 🎨 Usage

1. Open **Extensions** panel in SillyTavern
2. Find **Smart Dialogue Colorizer** settings
3. Configure:
   - **Character Dialogue Settings**: How character quotes are colored
   - **Persona Dialogue Settings**: How your persona's quotes are colored
4. Set per-character overrides in the Character Editor (optional)

## 🔧 Configuration

### Color Source Options

- **Avatar Smart** (Default): Uses intelligent color extraction with quality filtering
- **Static Color**: Specify a single color to use for all characters
- **Per-Character Only**: Only uses colors set per-character, uses default for others
- **Disabled**: Turn off automatic coloring

### Per-Character Colors

In the Character Editor or Persona settings, you'll find a "Dialogue Color" field where you can set custom colors for specific characters, overriding the global settings.

## 🆚 Improvements Over Original

- More reliable color extraction that works with a wider variety of avatars
- Smart fallback system prevents failures when vibrant colors aren't available
- Better contrast algorithm ensures readability
- Quality filtering removes poor color choices
- Simplified UI focused on quoted text (no chat bubble complexity)
- Cleaner codebase with better performance

## 📝 License

MIT License - see [LICENSE](./LICENSE)
