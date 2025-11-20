# SillyTavern Smart Dialogue Colorizer - AI Instructions

## Project Overview
This is a **SillyTavern Extension** that dynamically colors dialogue quotes in chat messages based on character avatars. It runs within the SillyTavern browser environment, interacting directly with the DOM and SillyTavern's global state.

## Architecture & Core Concepts

### 1. Extension Structure
- **Entry Point:** `index.js` is the main controller. It initializes the extension, registers event listeners, and manages the settings UI.
- **Domain Model:** `STCharacter.js` provides a unified `STCharacter` class to handle Characters, Personas, and System entities abstractly. Always use this wrapper when dealing with avatar paths or UIDs.
- **Color Logic:** `color-utils.js` handles smart color extraction (via Vibrant.js), while `ExColor.js` provides color manipulation utilities.
- **Settings:** Managed via `settings-utils.js`, wrapping SillyTavern's `extension_settings` global.

### 2. Data Flow & Rendering
1. **Events:** The extension listens to SillyTavern events (`CHAT_CHANGED`, `MESSAGE_ADDED`, `CHAR_CARD_CHANGED`) via `eventSource` and `expEventSource`.
2. **Attribute Injection:** New messages receive a custom attribute `sdc-author_uid` (e.g., `character|CharName`) via `addAuthorUidClassToMessage`.
3. **Style Injection:** Instead of inline styles, the extension dynamically updates two `<style>` elements (`sdc-chars_style_sheet` and `sdc-personas_style_sheet`).
4. **CSS Variables:** Colors are applied as CSS variables (`--character-color`) scoped to the specific `sdc-author_uid`, allowing efficient updates.

### 3. Key Integration Points
- **SillyTavern Globals:** The extension relies on relative imports to access SillyTavern core modules:
  - `../../../../script.js`: Core events (`eventSource`) and utilities.
  - `../../../extensions.js`: Extension context (`getContext`) and settings.
  - `../../../power-user.js`: Persona management (`power_user`).
- **jQuery:** The project uses jQuery (`$`) extensively for DOM manipulation and UI construction, consistent with SillyTavern's codebase.

## Developer Workflows & Patterns

### DOM Manipulation
- **Message Targeting:** Do not modify `.mes` classes directly if possible. Use the `sdc-author_uid` attribute for targeting specific character messages.
- **Settings UI:** UI components are created in `element-creators.js` and injected into `#extensions_settings2`. Use `jQuery` for event binding.

### Color Handling
- **Extraction:** Use `getSmartAvatarColor` for extraction.
- **Contrast:** Always pass extracted colors through `makeBetterContrast(rgb)` to ensure readability against dark backgrounds.
- **Caching:** `avatarColorCache` in `index.js` prevents expensive re-extraction. Clear specific cache entries when settings change.

### Common Tasks
- **Adding a Setting:**
  1. Add default value to `defaultExtSettings` in `index.js`.
  2. Create UI element in `initializeSettingsUI`.
  3. Update `getCharacterDialogueColor` to respect the new setting.
  4. Trigger `saveSettingsDebounced()`.

- **Handling New Events:**
  - Use `eventSource.on(event_types.EVENT_NAME, ...)` for core ST events.
  - Use `expEventSource` for extension-specific abstractions defined in `st-utils.js`.

## Critical Files
- `index.js`: Main logic, event wiring, and caching.
- `STCharacter.js`: Essential abstraction for character/persona identity.
- `st-utils.js`: Utilities for querying SillyTavern's state (e.g., `getCurrentCharacter`, `isInGroupChat`).
