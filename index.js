//#region ST imports

import {
  eventSource,
  event_types,
  saveSettingsDebounced,
} from "../../../../script.js";
import { extension_settings } from "../../../extensions.js";

//#endregion ST imports

//#region Local imports

import { ExColor } from "./ExColor.js";
import { CharacterType, STCharacter } from "./STCharacter.js";
import { getSmartAvatarColor } from "./color-utils.js";
import {
  createColorSourceDropdown,
  createColorTextPickerCombo,
  createCheckboxWithLabel,
} from "./element-creators.js";
import { initializeSettings } from "./settings-utils.js";
import {
  expEventSource,
  exp_event_type,
  getAllPersonas,
  getCharacterBeingEdited,
  getCurrentCharacter,
  getCurrentGroupCharacters,
  getCurrentPersona,
  getMessageAuthor,
  isInAnyChat,
  isInCharacterChat,
  isInGroupChat,
} from "./st-utils.js";
import { setInputColorPickerComboValue } from "./utils.js";

//#endregion Local imports

const DEFAULT_STATIC_DIALOGUE_COLOR_HEX = "#e18a24";
/** @type {[number, number, number]} */
const DEFAULT_STATIC_DIALOGUE_COLOR_RGB = [225, 138, 36];

/**
 * @typedef {ValueOf<typeof ColorizeSourceType>} ColorizeSourceType
 * @readonly
 */
export const ColorizeSourceType = {
  AVATAR_SMART: "avatar_smart",
  CHAR_COLOR_OVERRIDE: "char_color_override",
  STATIC_COLOR: "static_color",
  DISABLED: "disabled",
};

/**
 * @typedef {defaultExtSettings} SDCSettings
 */
const defaultCharColorSettings = {
  colorizeSource: ColorizeSourceType.AVATAR_SMART,
  staticColor: DEFAULT_STATIC_DIALOGUE_COLOR_HEX,
  colorOverrides: {},
  colorNameText: false,
  boostVibrancy: false,
};
const defaultExtSettings = {
  charColorSettings: defaultCharColorSettings,
  personaColorSettings: defaultCharColorSettings,
};

const extName = "SillyTavern-Smart-Dialogue-Colorizer";
const extFolderPath = `scripts/extensions/third-party/${extName}`;
const extSettings = initializeSettings(extName, defaultExtSettings);

function debounce(fn, delay = 100) {
  /** @type {number?} */
  let timeoutId = null;
  return function debounced(...args) {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }

    timeoutId = window.setTimeout(() => {
      fn.apply(this, args);
    }, delay);
  };
}

/** @type {HTMLStyleElement} */
let charactersStyleSheet;
/** @type {HTMLStyleElement} */
let personasStyleSheet;

/**
 * @param {STCharacter} stChar
 */
async function getCharStyleString(stChar) {
  let styleHtml = "";
  const dialogueColor = await getCharacterDialogueColor(stChar);
  const colorSettings = getSettingsForChar(stChar);

  if (dialogueColor) {
    styleHtml += `
            .mes[sdc-author_uid="${stChar.uid}"] {
                --character-color: #${dialogueColor.toHex()};
            }
        `;

    // Apply color to character name if enabled
    if (colorSettings.colorNameText) {
      styleHtml += `
            .mes[sdc-author_uid="${stChar.uid}"] .name_text {
                color: var(--character-color);
            }
        `;
    }
  }

  return styleHtml;
}

/**
 *
 * @param {STCharacter[]=} characterList
 */
async function updateCharactersStyleSheet(characterList) {
  if (!characterList) {
    if (!isInAnyChat()) {
      return;
    }
    if (isInGroupChat()) {
      characterList = getCurrentGroupCharacters();
    } else if (isInCharacterChat()) {
      characterList = [getCurrentCharacter()];
    }
  }

  const stylesHtml = await Promise.all(
    characterList.map(async (char) => await getCharStyleString(char))
  );
  charactersStyleSheet.innerHTML = stylesHtml.join("");
}

// Handled differently from the chars style sheet so we don't have to do any dirty/complex tricks when a chat has messages
// from a persona the user isn't currently using (otherwise the message color would revert to the default).
/**
 *
 * @param {STCharacter[]=} personaList
 */
async function updatePersonasStyleSheet(personaList) {
  personaList ??= getAllPersonas();

  const stylesHtml = await Promise.all(
    personaList.map(async (persona) => await getCharStyleString(persona))
  );
  personasStyleSheet.innerHTML = stylesHtml.join("");
}

/**
 *
 * @param {STCharacter | CharacterType} charType
 */
function getSettingsForChar(charType) {
  if (charType instanceof STCharacter) {
    charType = charType.type;
  }

  switch (charType) {
    case CharacterType.CHARACTER:
      return extSettings.charColorSettings;
    case CharacterType.PERSONA:
      return extSettings.personaColorSettings;
    default:
      console.warn(
        `Character type '${charType}' has no settings key, using defaults.`
      );
      return structuredClone(defaultCharColorSettings);
  }
}

/**
 * Determines if the current application theme is light or dark.
 * Checks the computed background color of the body.
 * @returns {boolean} True if light theme, false if dark theme.
 */
function isLightTheme() {
  const rgb = window
    .getComputedStyle(document.body)
    .backgroundColor.match(/\d+/g);
  if (!rgb) return false; // Default to dark if can't determine

  // Calculate relative luminance
  const luminance =
    (0.299 * parseInt(rgb[0]) +
      0.587 * parseInt(rgb[1]) +
      0.114 * parseInt(rgb[2])) /
    255;
  return luminance > 0.5;
}

/**
 * Improves color contrast for better readability on dark or light backgrounds.
 * Ensures adequate saturation and luminance while preserving hue.
 * Optionally boosts vibrancy.
 *
 * @param {import("./ExColor.js").ColorArray} rgb
 * @param {boolean} boostVibrancy - Whether to apply 20% saturation boost
 * @param {boolean} isLight - Whether the current theme is light
 * @returns {import("./ExColor.js").ColorArray}
 */
function makeBetterContrast(rgb, boostVibrancy = false, isLight = false) {
  const [h, s, l, a] = ExColor.rgb2hsl(rgb);

  let nHue = h;
  let nSat = s;
  let nLum = l;

  // Ensure minimum saturation for vibrancy
  if (nSat < 0.4) {
    nSat = Math.min(nSat + 0.3, 0.8);
  }

  if (isLight) {
    // Light Theme Logic: Darken colors that are too bright
    if (nLum > 0.6) {
      nLum = 0.45; // Darken bright colors
    } else if (nLum > 0.4) {
      nLum = 0.4; // Slight darken for mid-range
    }
    // Ensure it's not TOO dark though, or it looks like black text
    if (nLum < 0.2) {
      nLum = 0.25;
    }
  } else {
    // Dark Theme Logic (Default)
    // Ensure luminance is in readable range (not too dark, not too bright)
    if (nLum < 0.5) {
      nLum = 0.65; // Brighten dark colors
    } else if (nLum < 0.7) {
      nLum = 0.7; // Slight boost for mid-range
    } else if (nLum > 0.85) {
      nLum = 0.8; // Tone down very bright colors
    }
  }

  // Apply optional vibrancy boost (35% saturation increase)
  if (boostVibrancy) {
    nSat = Math.max(0, Math.min(1, nSat + 0.35));
  }

  return ExColor.hsl2rgb([nHue, nSat, nLum, a]);
}

const MAX_CACHE_SIZE = 100; // Prevent memory issues with many characters
let avatarColorCache = {};
let cacheInsertionOrder = []; // Track insertion order for LRU eviction

/**
 * Removes the specified cache entry and keeps insertion tracking in sync.
 * @param {string} cacheKey
 */
function removeCacheEntry(cacheKey) {
  delete avatarColorCache[cacheKey];
  const index = cacheInsertionOrder.indexOf(cacheKey);
  if (index > -1) {
    cacheInsertionOrder.splice(index, 1);
  }
}

/**
 * Enforces the maximum cache size by removing oldest entries
 */
function enforceCacheLimit() {
  if (Object.keys(avatarColorCache).length > MAX_CACHE_SIZE) {
    // Remove oldest 20% of entries to avoid frequent cleanup
    const entriesToRemove = Math.floor(MAX_CACHE_SIZE * 0.2);
    for (
      let i = 0;
      i < entriesToRemove && cacheInsertionOrder.length > 0;
      i++
    ) {
      const oldestKey = cacheInsertionOrder.shift();
      delete avatarColorCache[oldestKey];
    }
  }
}

/**
 * Adds an entry to the cache with size enforcement
 * @param {string} key
 * @param {ExColor} value
 */
function addToCache(key, value) {
  avatarColorCache[key] = value;
  cacheInsertionOrder.push(key);
  enforceCacheLimit();
}

/**
 * Clears the cache for a specific character type only
 * @param {CharacterType} charType
 */
function clearCacheForCharType(charType) {
  const prefix = `${charType}|`;
  Object.keys(avatarColorCache).forEach((key) => {
    if (key.startsWith(prefix)) {
      removeCacheEntry(key);
    }
  });
}

/**
 * Clears cached colors for a specific character (all adjustment variants).
 * @param {STCharacter} stChar
 */
function clearCacheForCharacter(stChar) {
  const prefix = `${stChar.type}|${stChar.uid}|`;
  Object.keys(avatarColorCache).forEach((key) => {
    if (key.startsWith(prefix)) {
      removeCacheEntry(key);
    }
  });
}

/**
 * Gets the dialogue color for a character using smart color extraction.
 *
 * @param {STCharacter} stChar
 * @returns {Promise<ExColor?>}
 */
async function getCharacterDialogueColor(stChar) {
  const colorSettings = getSettingsForChar(stChar);
  const colorizeSource = Object.keys(colorSettings.colorOverrides).includes(
    stChar.avatarName
  )
    ? ColorizeSourceType.CHAR_COLOR_OVERRIDE
    : colorSettings.colorizeSource;

  switch (colorizeSource) {
    case ColorizeSourceType.AVATAR_SMART: {
      const isLight = isLightTheme();
      // Create cache key that includes character type, vibrancy boost setting, and theme
      const cacheKey = `${stChar.type}|${stChar.uid}|${
        colorSettings.boostVibrancy ? "boosted" : "normal"
      }|${isLight ? "light" : "dark"}`;

      // Check cache first
      if (avatarColorCache[cacheKey]) {
        return avatarColorCache[cacheKey];
      }

      try {
        const avatar = stChar.getAvatarImageThumbnail();
        const colorRgb = await getSmartAvatarColor(avatar);
        const betterContrastRgb = colorRgb
          ? makeBetterContrast(
              colorRgb,
              colorSettings.boostVibrancy || false,
              isLight
            )
          : DEFAULT_STATIC_DIALOGUE_COLOR_RGB;
        const exColor = ExColor.fromRgb(betterContrastRgb);

        // Cache the result with size enforcement
        addToCache(cacheKey, exColor);
        return exColor;
      } catch (error) {
        console.warn(
          `[SDC] Failed to extract color from avatar for ${stChar.uid}:`,
          error
        );
        // Return default color on error
        const exColor = ExColor.fromRgb(DEFAULT_STATIC_DIALOGUE_COLOR_RGB);
        addToCache(cacheKey, exColor); // Cache the fallback too
        return exColor;
      }
    }
    case ColorizeSourceType.STATIC_COLOR: {
      return ExColor.fromHex(colorSettings.staticColor);
    }
    case ColorizeSourceType.CHAR_COLOR_OVERRIDE: {
      const overrideColor = colorSettings.colorOverrides[stChar.avatarName];
      return overrideColor ? ExColor.fromHex(overrideColor) : null;
    }
    case ColorizeSourceType.DISABLED:
    default:
      return null;
  }
}

/**
 *
 * @param {string} textboxValue
 * @param {any} defaultValue
 * @returns {string | null}
 */
function getTextValidHexOrDefault(textboxValue, defaultValue) {
  const trimmed = textboxValue.trim();
  if (!ExColor.isValidHexString(trimmed)) return defaultValue;

  return ExColor.getHexWithHash(trimmed);
}

/**
 * Adds author UID attribute to a message element.
 *
 * @param {HTMLElement} message
 */
function addAuthorUidClassToMessage(message) {
  const authorChatUidAttr = "sdc-author_uid";
  if (message.hasAttribute(authorChatUidAttr)) {
    console.debug(
      `[SDC] Message already has '${authorChatUidAttr}' attribute, skipping.`
    );
    return;
  }

  const messageAuthorChar = getMessageAuthor(message);
  if (!messageAuthorChar) {
    console.error(
      "[SDC] Couldn't get message author character to add attribute."
    );
    return;
  }

  message.setAttribute(authorChatUidAttr, messageAuthorChar.uid);
}

function addAuthorUidToExistingMessages() {
  const chatElem = document.getElementById("chat");
  if (!chatElem) {
    return;
  }

  chatElem.querySelectorAll(":scope > .mes").forEach((message) => {
    addAuthorUidClassToMessage(message);
  });
}

//#region Event Handlers

const scheduleCharacterSettingsRefresh = debounce(async () => {
  await updateCharactersStyleSheet();
  saveSettingsDebounced();
}, 120);

const schedulePersonaSettingsRefresh = debounce(async () => {
  await updatePersonasStyleSheet();
  saveSettingsDebounced();
}, 120);

const scheduleAllSettingsRefresh = debounce(async () => {
  await updateCharactersStyleSheet();
  await updatePersonasStyleSheet();
  saveSettingsDebounced();
}, 120);

function onCharacterSettingsUpdated() {
  scheduleCharacterSettingsRefresh();
}

function onPersonaSettingsUpdated() {
  schedulePersonaSettingsRefresh();
}

function onAnySettingsUpdated() {
  scheduleAllSettingsRefresh();
}

/**
 *
 * @param {STCharacter} char
 */
function onCharacterChanged(char) {
  const colorOverride = document.getElementById("sdc-char_color_override");
  if (!colorOverride) return;
  const newValue = extSettings.charColorSettings.colorOverrides[char.avatarName];
  // Prefer the custom override UI setter if present; fall back to legacy input combo behavior.
  const setter = /** @type {any} */ (colorOverride).__sdcSetColorOverrideValue;
  if (typeof setter === "function") {
    setter(newValue);
    return;
  }
  setInputColorPickerComboValue(colorOverride, newValue);
}

/**
 *
 * @param {STCharacter} persona
 */
function onPersonaChanged(persona) {
  console.debug("[SDC] onPersonaChanged called for:", persona.avatarName);
  const colorOverride = document.getElementById("sdc-persona_color_override");
  if (!colorOverride) {
    console.debug("[SDC] Persona override element not found");
    return;
  }
  const newValue =
    extSettings.personaColorSettings.colorOverrides[persona.avatarName];
  console.debug("[SDC] New value for persona:", newValue);
  // Prefer the custom override UI setter if present; fall back to legacy input combo behavior.
  const setter = /** @type {any} */ (colorOverride).__sdcSetColorOverrideValue;
  console.debug("[SDC] Setter type:", typeof setter);
  if (typeof setter === "function") {
    setter(newValue);
    return;
  }
  setInputColorPickerComboValue(colorOverride, newValue);
}

//#endregion Event Handlers

//#region Initialization

function initializeStyleSheets() {
  charactersStyleSheet = createAndAppendStyleSheet("sdc-chars_style_sheet");
  personasStyleSheet = createAndAppendStyleSheet("sdc-personas_style_sheet");

  function createAndAppendStyleSheet(id) {
    const styleSheet = document.createElement("style");
    styleSheet.id = id;
    return document.body.appendChild(styleSheet);
  }
}

function initializeSettingsUI() {
  const elemExtensionSettings = document.getElementById(
    "sdc-extension-settings"
  );

  // ===== CHARACTER SETTINGS =====
  const charDialogueSettings = elemExtensionSettings.querySelector(
    "#sdc-char_dialogue_settings"
  );
  const charStaticColorRow = charDialogueSettings.children[1]; // The static color label/container

  // Color source dropdown
  const charColorSourceDropdown = createColorSourceDropdown(
    "sdc-char_colorize_source",
    (changedEvent) => {
      const value = $(changedEvent.target).prop("value");
      extSettings.charColorSettings.colorizeSource = value;

      // Show/hide static color picker based on selection
      charStaticColorRow.style.display =
        value === ColorizeSourceType.STATIC_COLOR ? "block" : "none";

      onCharacterSettingsUpdated();
    }
  );
  charDialogueSettings.children[0].insertAdjacentElement(
    "afterend",
    charColorSourceDropdown
  );

  // Static color picker
  const charStaticColorPickerCombo = createColorTextPickerCombo(
    (textboxValue) => getTextValidHexOrDefault(textboxValue, null),
    (colorValue) => {
      extSettings.charColorSettings.staticColor = colorValue;
      onCharacterSettingsUpdated();
    }
  );
  charDialogueSettings.children[2].insertAdjacentElement(
    "beforeend",
    charStaticColorPickerCombo
  );

  // Color name text checkbox
  const charColorNameCheckbox = createCheckboxWithLabel(
    "sdc-char_color_name",
    "Apply color to character names",
    "When enabled, character names will be colored in addition to dialogue quotes.",
    extSettings.charColorSettings.colorNameText || false,
    (checked) => {
      extSettings.charColorSettings.colorNameText = checked;
      onCharacterSettingsUpdated();
    }
  );
  charDialogueSettings.children[2].insertAdjacentElement(
    "afterend",
    charColorNameCheckbox
  );

  // Vibrancy boost checkbox (insert after color name checkbox to maintain correct order)
  const charVibrancyCheckbox = createCheckboxWithLabel(
    "sdc-char_boost_vibrancy",
    "Boost color vibrancy",
    "Increases saturation by 35% for more colorful dialogue (Avatar Smart mode only).",
    extSettings.charColorSettings.boostVibrancy || false,
    (checked) => {
      extSettings.charColorSettings.boostVibrancy = checked;
      clearCacheForCharType(CharacterType.CHARACTER); // Clear character cache
      onCharacterSettingsUpdated();
    }
  );
  charColorNameCheckbox.insertAdjacentElement("afterend", charVibrancyCheckbox);

  // Initialize values and visibility
  charStaticColorRow.style.display =
    extSettings.charColorSettings.colorizeSource ===
    ColorizeSourceType.STATIC_COLOR
      ? "block"
      : "none";
  $(charColorSourceDropdown.querySelector("select"))
    .prop("value", extSettings.charColorSettings.colorizeSource)
    .trigger("change");
  $(charStaticColorPickerCombo.querySelector('input[type="text"]'))
    .prop("value", extSettings.charColorSettings.staticColor)
    .trigger("focusout");

  // ===== PERSONA SETTINGS =====
  const personaDialogueSettings = elemExtensionSettings.querySelector(
    "#sdc-persona_dialogue_settings"
  );
  const personaStaticColorRow = personaDialogueSettings.children[1]; // The static color label/container

  // Color source dropdown
  const personaColorSourceDropdown = createColorSourceDropdown(
    "sdc-persona_colorize_source",
    (changedEvent) => {
      const value = $(changedEvent.target).prop("value");
      extSettings.personaColorSettings.colorizeSource = value;

      // Show/hide static color picker based on selection
      personaStaticColorRow.style.display =
        value === ColorizeSourceType.STATIC_COLOR ? "block" : "none";

      onPersonaSettingsUpdated();
    }
  );
  personaDialogueSettings.children[0].insertAdjacentElement(
    "afterend",
    personaColorSourceDropdown
  );

  // Static color picker
  const personaStaticColorPickerCombo = createColorTextPickerCombo(
    (textboxValue) => getTextValidHexOrDefault(textboxValue, null),
    (colorValue) => {
      extSettings.personaColorSettings.staticColor = colorValue;
      onPersonaSettingsUpdated();
    }
  );
  personaDialogueSettings.children[2].insertAdjacentElement(
    "beforeend",
    personaStaticColorPickerCombo
  );

  // Color name text checkbox
  const personaColorNameCheckbox = createCheckboxWithLabel(
    "sdc-persona_color_name",
    "Apply color to persona names",
    "When enabled, persona names will be colored in addition to dialogue quotes.",
    extSettings.personaColorSettings.colorNameText || false,
    (checked) => {
      extSettings.personaColorSettings.colorNameText = checked;
      onPersonaSettingsUpdated();
    }
  );
  personaDialogueSettings.children[2].insertAdjacentElement(
    "afterend",
    personaColorNameCheckbox
  );

  // Vibrancy boost checkbox (insert after color name checkbox to maintain correct order)
  const personaVibrancyCheckbox = createCheckboxWithLabel(
    "sdc-persona_boost_vibrancy",
    "Boost color vibrancy",
    "Increases saturation by 35% for more colorful dialogue (Avatar Smart mode only).",
    extSettings.personaColorSettings.boostVibrancy || false,
    (checked) => {
      extSettings.personaColorSettings.boostVibrancy = checked;
      clearCacheForCharType(CharacterType.PERSONA); // Clear persona cache
      onPersonaSettingsUpdated();
    }
  );
  personaColorNameCheckbox.insertAdjacentElement(
    "afterend",
    personaVibrancyCheckbox
  );

  // Initialize values and visibility
  personaStaticColorRow.style.display =
    extSettings.personaColorSettings.colorizeSource ===
    ColorizeSourceType.STATIC_COLOR
      ? "block"
      : "none";
  $(personaColorSourceDropdown.querySelector("select"))
    .prop("value", extSettings.personaColorSettings.colorizeSource)
    .trigger("change");
  $(personaStaticColorPickerCombo.querySelector('input[type="text"]'))
    .prop("value", extSettings.personaColorSettings.staticColor)
    .trigger("focusout");
}

/**
 * Adds a button to the Extensions dropdown menu for Smart Dialogue Colorizer
 * This function creates a menu item in SillyTavern's Extensions dropdown
 * that scrolls to and opens the extension's settings panel.
 */
function addExtensionMenuButton() {
  // Select the Extensions dropdown menu
  const extensionsMenu = document.getElementById("extensionsMenu");
  if (!extensionsMenu) {
    console.warn("[SDC] Extensions menu not found");
    return;
  }

  // Check if button already exists to prevent duplicates
  if (document.getElementById("sdc-extensions-menu-button")) {
    return;
  }

  // Create button element with palette icon and extension name
  const button = document.createElement("div");
  button.id = "sdc-extensions-menu-button";
  button.className = "list-group-item flex-container flexGap5 interactable";
  button.title = "Open Smart Dialogue Colorizer Settings";
  button.setAttribute("tabindex", "0");
  button.innerHTML = `
        <i class="fa-solid fa-palette"></i>
        <span>Dialogue Colorizer</span>
    `;

  // Append to extensions menu
  extensionsMenu.appendChild(button);

  // Set click handler to scroll to and open the settings
  button.addEventListener("click", () => {
    // Find the settings drawer
    const settingsDrawer = document.getElementById("sdc-extension-settings");
    if (!settingsDrawer) {
      console.warn("[SDC] Settings drawer not found");
      return;
    }

    // Scroll to the settings
    settingsDrawer.scrollIntoView({ behavior: "smooth", block: "start" });

    // Open the drawer if it's not already open
    const drawerToggle = settingsDrawer.querySelector(".inline-drawer-toggle");
    const drawerContent = settingsDrawer.querySelector(
      ".inline-drawer-content"
    );
    const drawerIcon = settingsDrawer.querySelector(".inline-drawer-icon");

    if (
      drawerToggle &&
      drawerContent &&
      !drawerContent.classList.contains("open")
    ) {
      drawerToggle.classList.add("open");
      drawerContent.classList.add("open");
      if (drawerIcon) {
        drawerIcon.classList.remove("down");
        drawerIcon.classList.add("up");
      }
    }

    // Brief highlight effect to draw attention
    settingsDrawer.style.transition = "background-color 0.3s ease";
    const originalBg = settingsDrawer.style.backgroundColor;
    settingsDrawer.style.backgroundColor =
      "rgba(var(--SmartThemeBodyColor), 0.3)";
    setTimeout(() => {
      settingsDrawer.style.backgroundColor = originalBg;
    }, 600);
  });
}

function initializeCharSpecificUI() {
  /**
   * Preset colors for quick selection (readable on both light/dark themes)
   */
  const PRESET_COLORS = [
    { hex: "#E74C3C", name: "Coral Red" },
    { hex: "#E67E22", name: "Orange" },
    { hex: "#F1C40F", name: "Gold" },
    { hex: "#27AE60", name: "Green" },
    { hex: "#3498DB", name: "Blue" },
    { hex: "#9B59B6", name: "Purple" },
  ];

  /**
   *
   * @param {string} id
   * @param {() => STCharacter} stCharGetter
   */
  function createColorOverrideElem(id, stCharGetter) {
    // Create container
    const wrapper = document.createElement("div");
    wrapper.id = id;
    wrapper.className = "sdc-color-override-container";

    // Add subtle separator at top
    const separator = document.createElement("div");
    separator.className = "sdc-separator";

    // Create label row
    const labelRow = document.createElement("div");
    labelRow.className = "sdc-label-row";

    const label = document.createElement("label");
    label.className = "sdc-override-label";
    label.innerHTML = `
            <span>Dialogue Color</span>
            <i class="fa-solid fa-circle-info margin5 opacity50p" 
               title="Pick a preset color or enter a custom hex. Click reset to use auto-detection."></i>
        `;
    labelRow.appendChild(label);

    // Create the inline control row
    const controlRow = document.createElement("div");
    controlRow.className = "sdc-inline-color-row";

    // Preset swatches container
    const presetsContainer = document.createElement("div");
    presetsContainer.className = "sdc-preset-swatches";

    /** @type {HTMLButtonElement[]} */
    const swatchButtons = [];

    // Track current selection state
    let currentColor = "";

    /**
     * Updates the visual selection state of all swatches
     * @param {string} selectedColor
     */
    function updateSwatchSelection(selectedColor) {
      currentColor = selectedColor;
      swatchButtons.forEach((btn) => {
        const isSelected =
          btn.dataset.color.toUpperCase() === selectedColor.toUpperCase();
        btn.classList.toggle("selected", isSelected);
      });
      // Update custom input selection state
      const isCustom =
        selectedColor &&
        !PRESET_COLORS.some(
          (p) => p.hex.toUpperCase() === selectedColor.toUpperCase()
        );
      customInputWrapper.classList.toggle("selected", isCustom);
      // Show/hide reset button
      resetBtn.style.display = selectedColor ? "flex" : "none";
    }

    /**
     * Applies a color override
     * @param {string} colorValue
     */
    function applyColorOverride(colorValue) {
      const stChar = stCharGetter();
      const colorSettings = getSettingsForChar(stChar);

      if (colorValue && colorValue.length > 0) {
        colorSettings.colorOverrides[stChar.avatarName] = colorValue;
      } else {
        delete colorSettings.colorOverrides[stChar.avatarName];
      }

      // Clear cache when override changes
      clearCacheForCharacter(stChar);

      if (stChar.type === CharacterType.PERSONA) {
        onPersonaSettingsUpdated();
      } else {
        onCharacterSettingsUpdated();
      }

      setUIOverrideValue(colorValue);
    }

    /**
     * Updates ONLY the UI state (swatch selection, custom highlight, reset visibility, inputs).
     * Does not update settings.
     *
     * @param {string?} colorValue
     */
    function setUIOverrideValue(colorValue) {
      console.debug("[SDC] setUIOverrideValue called with:", colorValue);
      const value = colorValue ?? "";
      updateSwatchSelection(value);

      // Update custom input to show the color
      if (value) {
        textInput.value = value;
        colorInput.value = value;
      } else {
        textInput.value = "";
        colorInput.value = "#808080";
      }
    }

    // Create preset swatch buttons
    PRESET_COLORS.forEach((preset) => {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "sdc-preset-swatch";
      swatch.dataset.color = preset.hex;
      swatch.style.backgroundColor = preset.hex;
      swatch.title = preset.name;
      swatch.onclick = () => applyColorOverride(preset.hex);
      swatchButtons.push(swatch);
      presetsContainer.appendChild(swatch);
    });

    // Divider between presets and custom
    const divider = document.createElement("div");
    divider.className = "sdc-color-divider";

    // Custom color input wrapper
    const customInputWrapper = document.createElement("div");
    customInputWrapper.className = "sdc-custom-color-wrapper";

    // Hex text input
    const textInput = document.createElement("input");
    textInput.type = "text";
    textInput.className = "text_pole sdc-hex-input";
    textInput.placeholder = "#RRGGBB";
    textInput.maxLength = 7;

    // Color picker
    const colorPickerWrapper = document.createElement("div");
    colorPickerWrapper.className =
      "dc-color-picker-wrapper sdc-custom-picker-wrapper";

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.className = "dc-color-picker";
    colorInput.value = "#808080";

    colorPickerWrapper.appendChild(colorInput);

    // Wire up custom input events
    textInput.addEventListener("focusout", () => {
      const validated = getTextValidHexOrDefault(textInput.value, "");
      if (validated) {
        applyColorOverride(validated);
      } else if (textInput.value === "") {
        // Allow clearing via empty input
        applyColorOverride("");
      }
    });

    textInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        textInput.blur();
      }
    });

    colorInput.addEventListener("input", () => {
      textInput.value = colorInput.value;
    });

    colorInput.addEventListener("change", () => {
      applyColorOverride(colorInput.value);
    });

    customInputWrapper.appendChild(textInput);
    customInputWrapper.appendChild(colorPickerWrapper);

    // Reset button
    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "menu_button menu_button_icon sdc-reset-btn";
    resetBtn.innerHTML = '<i class="fa-solid fa-rotate-left"></i>';
    resetBtn.title = "Reset to auto-detect from avatar";
    resetBtn.style.display = "none";
    resetBtn.onclick = () => applyColorOverride("");

    // Assemble the control row
    controlRow.appendChild(presetsContainer);
    controlRow.appendChild(divider);
    controlRow.appendChild(customInputWrapper);
    controlRow.appendChild(resetBtn);

    // Assemble wrapper
    wrapper.appendChild(separator);
    wrapper.appendChild(labelRow);
    wrapper.appendChild(controlRow);

    // Expose a setter so the persona/character change handlers can refresh UI state
    // when the selected persona/character changes.
    /** @type {any} */ (wrapper).__sdcSetColorOverrideValue = setUIOverrideValue;

    // Initialize with current value
    setTimeout(() => {
      const stChar = stCharGetter();
      const colorSettings = getSettingsForChar(stChar);
      const savedColor = colorSettings.colorOverrides[stChar.avatarName] || "";
      setUIOverrideValue(savedColor);
    }, 100);

    return wrapper;
  }

  /**
   * Attempts to insert the character override UI into the character editor.
   * This UI target isn't always present (e.g. if user hasn't opened the editor yet).
   * @returns {boolean} true if inserted or already present
   */
  function tryInsertCharacterOverride() {
    if (document.getElementById("sdc-char_color_override")) return true;

    const elemCharCardForm = document.getElementById("form_create");
    if (!elemCharCardForm) return false;

    const elemAvatarNameBlock = elemCharCardForm.querySelector(
      "div#avatar-and-name-block"
    );
    if (!elemAvatarNameBlock) return false;

    const elemCharColorOverride = createColorOverrideElem(
      "sdc-char_color_override",
      getCharacterBeingEdited
    );
    elemAvatarNameBlock.insertAdjacentElement("afterend", elemCharColorOverride);
    return true;
  }

  /**
   * Finds a good anchor element to insert the persona override UI.
   * Tries known IDs first, then falls back to locating the "Current Persona" label.
   * @returns {{anchor: Element, position: InsertPosition}?}
   */
  function findPersonaOverrideAnchor() {
    const elemPersonaDescription = document.getElementById("persona_description");
    if (elemPersonaDescription?.parentElement) {
      return { anchor: elemPersonaDescription.parentElement, position: "afterbegin" };
    }

    // Fallback: find the label that contains "Current Persona" and insert before its row/container.
    const labels = Array.from(document.querySelectorAll("label"));
    const currentPersonaLabel = labels.find((l) =>
      (l.textContent ?? "").trim().toLowerCase().includes("current persona")
    );
    if (!currentPersonaLabel) return null;

    const row =
      currentPersonaLabel.closest("div") ?? currentPersonaLabel.parentElement;
    if (!row) return null;

    return { anchor: row, position: "beforebegin" };
  }

  /**
   * Attempts to insert the persona override UI into Persona Management settings.
   * This panel may be created lazily, so we retry when DOM changes.
   * @returns {boolean} true if inserted or already present
   */
  function tryInsertPersonaOverride() {
    if (document.getElementById("sdc-persona_color_override")) return true;

    const anchor = findPersonaOverrideAnchor();
    if (!anchor) return false;

    const elemPersonaColorOverride = createColorOverrideElem(
      "sdc-persona_color_override",
      getCurrentPersona
    );
    anchor.anchor.insertAdjacentElement(anchor.position, elemPersonaColorOverride);
    return true;
  }

  function tryInsertAll() {
    const charOk = tryInsertCharacterOverride();
    const personaOk = tryInsertPersonaOverride();
    return { charOk, personaOk };
  }

  // Initial attempt (might only succeed partially depending on which UI panels exist)
  tryInsertAll();

  // Watch for the Persona Management and/or Character Editor DOM being created.
  const injectionObserver = new MutationObserver(
    debounce(() => {
      const { charOk, personaOk } = tryInsertAll();
      if (charOk && personaOk) injectionObserver.disconnect();
    }, 200)
  );
  injectionObserver.observe(document.body, { childList: true, subtree: true });
}

jQuery(async ($) => {
  const settingsHtml = await $.get(`${extFolderPath}/dialogue-colorizer.html`);

  const elemStExtensionSettings2 = document.getElementById(
    "extensions_settings2"
  );
  $(elemStExtensionSettings2).append(settingsHtml);

  initializeStyleSheets();
  initializeSettingsUI();
  initializeCharSpecificUI();

  // Add extension menu button for quick access to settings
  addExtensionMenuButton();

  eventSource.on(event_types.CHAT_CHANGED, () => updateCharactersStyleSheet());
  expEventSource.on(exp_event_type.MESSAGE_ADDED, addAuthorUidClassToMessage);

  expEventSource.on(exp_event_type.CHAR_CARD_CHANGED, (char) => {
    onCharacterChanged(char);
    clearCacheForCharacter(char);
    updateCharactersStyleSheet();
  });
  expEventSource.on(exp_event_type.PERSONA_CHANGED, (persona) => {
    onPersonaChanged(persona);
    clearCacheForCharacter(persona);
    updatePersonasStyleSheet();
  });
  expEventSource.on(exp_event_type.PERSONA_ADDED, (persona) => {
    clearCacheForCharacter(persona);
    updatePersonasStyleSheet();
  });
  expEventSource.on(exp_event_type.PERSONA_REMOVED, (persona) => {
    clearCacheForCharacter(persona);
    updatePersonasStyleSheet();
  });

  eventSource.once(event_types.APP_READY, () => {
    onPersonaChanged(getCurrentPersona()); // Initialize color inputs with starting values.
    addAuthorUidToExistingMessages();
    updateCharactersStyleSheet();
    updatePersonasStyleSheet();
  });

  // Watch for persona changes in the Persona Management panel (#PersonaManagement)
  // The avatar containers get a "selected" class when clicked
  const personaManagementObserver = new MutationObserver(
    debounce(() => {
      const currentPersona = getCurrentPersona();
      console.debug("[SDC] PersonaManagement observer triggered, current persona:", currentPersona.avatarName);
      onPersonaChanged(currentPersona);
    }, 100)
  );

  // Try to observe immediately, and also set up a watcher in case the panel is created later
  function tryObservePersonaManagement() {
    const personaManagement = document.getElementById("PersonaManagement");
    if (personaManagement) {
      personaManagementObserver.observe(personaManagement, {
        subtree: true,
        attributes: true,
        attributeFilter: ["class"],
      });
      console.debug("[SDC] Now observing #PersonaManagement for persona changes");
      return true;
    }
    return false;
  }

  if (!tryObservePersonaManagement()) {
    // Panel doesn't exist yet, watch for it to be created
    const panelWatcher = new MutationObserver(() => {
      if (tryObservePersonaManagement()) {
        panelWatcher.disconnect();
      }
    });
    panelWatcher.observe(document.body, { childList: true, subtree: true });
  }

  // Watch for theme changes to update colors automatically
  let lastThemeIsLight = isLightTheme();
  const themeObserver = new MutationObserver(
    debounce(() => {
      // Check if the theme actually changed to avoid unnecessary updates
      const currentThemeIsLight = isLightTheme();
      if (currentThemeIsLight !== lastThemeIsLight) {
        lastThemeIsLight = currentThemeIsLight;
        updateCharactersStyleSheet();
        updatePersonasStyleSheet();
      }
    }, 500)
  );

  themeObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ["class", "style"],
  });
});

//#endregion Initialization
