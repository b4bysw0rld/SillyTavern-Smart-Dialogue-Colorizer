//#region ST imports

import { eventSource, event_types, saveSettingsDebounced } from "../../../../script.js";
import { extension_settings } from "../../../extensions.js";

//#endregion ST imports

//#region Local imports

import { ExColor } from "./ExColor.js";
import { CharacterType, STCharacter } from "./STCharacter.js";
import { getSmartAvatarColor } from "./color-utils.js";
import { createColorSourceDropdown, createColorTextPickerCombo, createCheckboxWithLabel } from "./element-creators.js";
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
    isInGroupChat } from "./st-utils.js";
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
    DISABLED: "disabled"
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
            .mes[sdc-author_uid="${stChar.uid}"] .mes_text q {
                color: var(--character-color);
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
        }
        else if (isInCharacterChat()) {
            characterList = [getCurrentCharacter()];
        }
    }

    const stylesHtml = await Promise.all(characterList.map(async char => await getCharStyleString(char)));
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

    const stylesHtml = await Promise.all(personaList.map(async persona => await getCharStyleString(persona)));
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
            console.warn(`Character type '${charType}' has no settings key, using defaults.`);
            return structuredClone(defaultCharColorSettings);
    }
}

/**
 * Determines if the current application theme is light or dark.
 * Checks the computed background color of the body.
 * @returns {boolean} True if light theme, false if dark theme.
 */
function isLightTheme() {
    const rgb = window.getComputedStyle(document.body).backgroundColor.match(/\d+/g);
    if (!rgb) return false; // Default to dark if can't determine
    
    // Calculate relative luminance
    const luminance = (0.299 * parseInt(rgb[0]) + 0.587 * parseInt(rgb[1]) + 0.114 * parseInt(rgb[2])) / 255;
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

    // Apply optional vibrancy boost (20% saturation increase)
    if (boostVibrancy) {
        nSat = Math.max(0, Math.min(1, nSat + 0.20));
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
        for (let i = 0; i < entriesToRemove && cacheInsertionOrder.length > 0; i++) {
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
    Object.keys(avatarColorCache).forEach(key => {
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
    Object.keys(avatarColorCache).forEach(key => {
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
    const colorizeSource = Object.keys(colorSettings.colorOverrides).includes(stChar.avatarName)
        ? ColorizeSourceType.CHAR_COLOR_OVERRIDE
        : colorSettings.colorizeSource;

    switch (colorizeSource) {
        case ColorizeSourceType.AVATAR_SMART: {
            const isLight = isLightTheme();
            // Create cache key that includes character type, vibrancy boost setting, and theme
            const cacheKey = `${stChar.type}|${stChar.uid}|${colorSettings.boostVibrancy ? 'boosted' : 'normal'}|${isLight ? 'light' : 'dark'}`;
            
            // Check cache first
            if (avatarColorCache[cacheKey]) {
                return avatarColorCache[cacheKey];
            }
            
            try {
                const avatar = stChar.getAvatarImageThumbnail();
                const colorRgb = await getSmartAvatarColor(avatar);
                const betterContrastRgb = colorRgb 
                    ? makeBetterContrast(colorRgb, colorSettings.boostVibrancy || false, isLight)
                    : DEFAULT_STATIC_DIALOGUE_COLOR_RGB;
                const exColor = ExColor.fromRgb(betterContrastRgb);
                
                // Cache the result with size enforcement
                addToCache(cacheKey, exColor);
                return exColor;
            } catch (error) {
                console.warn(`[SDC] Failed to extract color from avatar for ${stChar.uid}:`, error);
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
    if (!ExColor.isValidHexString(trimmed))
        return defaultValue;

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
        console.debug(`[SDC] Message already has '${authorChatUidAttr}' attribute, skipping.`);
        return;
    }

    const messageAuthorChar = getMessageAuthor(message);
    if (!messageAuthorChar) {
        console.error("[SDC] Couldn't get message author character to add attribute.");
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
    setInputColorPickerComboValue(colorOverride, extSettings.charColorSettings.colorOverrides[char.avatarName]);
}

/**
 * 
 * @param {STCharacter} persona 
 */
function onPersonaChanged(persona) {
    const colorOverride = document.getElementById("sdc-persona_color_override");
    setInputColorPickerComboValue(colorOverride, extSettings.personaColorSettings.colorOverrides[persona.avatarName]);
}

//#endregion Event Handlers

//#region Initialization

function initializeStyleSheets() {
    charactersStyleSheet = createAndAppendStyleSheet("sdc-chars_style_sheet");
    personasStyleSheet = createAndAppendStyleSheet("sdc-personas_style_sheet");

    function createAndAppendStyleSheet(id) {
        const styleSheet = document.createElement('style');
        styleSheet.id = id;
        return document.body.appendChild(styleSheet);
    }
}

function initializeSettingsUI() {
    const elemExtensionSettings = document.getElementById("sdc-extension-settings");

    // ===== CHARACTER SETTINGS =====
    const charDialogueSettings = elemExtensionSettings.querySelector("#sdc-char_dialogue_settings");
    const charStaticColorRow = charDialogueSettings.children[1]; // The static color label/container
    
    // Color source dropdown
    const charColorSourceDropdown = createColorSourceDropdown("sdc-char_colorize_source", (changedEvent) => {
        const value = $(changedEvent.target).prop("value");
        extSettings.charColorSettings.colorizeSource = value;
        
        // Show/hide static color picker based on selection
        charStaticColorRow.style.display = value === ColorizeSourceType.STATIC_COLOR ? 'block' : 'none';
        
        onCharacterSettingsUpdated();
    });
    charDialogueSettings.children[0].insertAdjacentElement("afterend", charColorSourceDropdown);
    
    // Static color picker
    const charStaticColorPickerCombo = createColorTextPickerCombo(
        (textboxValue) => getTextValidHexOrDefault(textboxValue, null), 
        (colorValue) => {
            extSettings.charColorSettings.staticColor = colorValue;
            onCharacterSettingsUpdated();
        }
    );
    charDialogueSettings.children[2].insertAdjacentElement("beforeend", charStaticColorPickerCombo);

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
    charDialogueSettings.children[2].insertAdjacentElement("afterend", charColorNameCheckbox);

    // Vibrancy boost checkbox (insert after color name checkbox to maintain correct order)
    const charVibrancyCheckbox = createCheckboxWithLabel(
        "sdc-char_boost_vibrancy",
        "Boost color vibrancy",
        "Increases saturation by 20% for more colorful dialogue (Avatar Smart mode only).",
        extSettings.charColorSettings.boostVibrancy || false,
        (checked) => {
            extSettings.charColorSettings.boostVibrancy = checked;
            clearCacheForCharType(CharacterType.CHARACTER); // Clear character cache
            onCharacterSettingsUpdated();
        }
    );
    charColorNameCheckbox.insertAdjacentElement("afterend", charVibrancyCheckbox);

    // Initialize values and visibility
    charStaticColorRow.style.display = extSettings.charColorSettings.colorizeSource === ColorizeSourceType.STATIC_COLOR ? 'block' : 'none';
    $(charColorSourceDropdown.querySelector('select'))
        .prop("value", extSettings.charColorSettings.colorizeSource)
        .trigger('change');
    $(charStaticColorPickerCombo.querySelector('input[type="text"]'))
        .prop("value", extSettings.charColorSettings.staticColor)
        .trigger('focusout');

    // ===== PERSONA SETTINGS =====
    const personaDialogueSettings = elemExtensionSettings.querySelector("#sdc-persona_dialogue_settings");
    const personaStaticColorRow = personaDialogueSettings.children[1]; // The static color label/container
    
    // Color source dropdown
    const personaColorSourceDropdown = createColorSourceDropdown("sdc-persona_colorize_source", (changedEvent) => {
        const value = $(changedEvent.target).prop("value");
        extSettings.personaColorSettings.colorizeSource = value;
        
        // Show/hide static color picker based on selection
        personaStaticColorRow.style.display = value === ColorizeSourceType.STATIC_COLOR ? 'block' : 'none';
        
        onPersonaSettingsUpdated();
    });
    personaDialogueSettings.children[0].insertAdjacentElement("afterend", personaColorSourceDropdown);
    
    // Static color picker
    const personaStaticColorPickerCombo = createColorTextPickerCombo(
        (textboxValue) => getTextValidHexOrDefault(textboxValue, null), 
        (colorValue) => {
            extSettings.personaColorSettings.staticColor = colorValue;
            onPersonaSettingsUpdated();
        }
    );
    personaDialogueSettings.children[2].insertAdjacentElement("beforeend", personaStaticColorPickerCombo);

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
    personaDialogueSettings.children[2].insertAdjacentElement("afterend", personaColorNameCheckbox);

    // Vibrancy boost checkbox (insert after color name checkbox to maintain correct order)
    const personaVibrancyCheckbox = createCheckboxWithLabel(
        "sdc-persona_boost_vibrancy",
        "Boost color vibrancy",
        "Increases saturation by 20% for more colorful dialogue (Avatar Smart mode only).",
        extSettings.personaColorSettings.boostVibrancy || false,
        (checked) => {
            extSettings.personaColorSettings.boostVibrancy = checked;
            clearCacheForCharType(CharacterType.PERSONA); // Clear persona cache
            onPersonaSettingsUpdated();
        }
    );
    personaColorNameCheckbox.insertAdjacentElement("afterend", personaVibrancyCheckbox);

    // Initialize values and visibility
    personaStaticColorRow.style.display = extSettings.personaColorSettings.colorizeSource === ColorizeSourceType.STATIC_COLOR ? 'block' : 'none';
    $(personaColorSourceDropdown.querySelector('select'))
        .prop("value", extSettings.personaColorSettings.colorizeSource)
        .trigger('change');
    $(personaStaticColorPickerCombo.querySelector('input[type="text"]'))
        .prop("value", extSettings.personaColorSettings.staticColor)
        .trigger('focusout');
}

/**
 * Adds a button to the Extensions dropdown menu for Smart Dialogue Colorizer
 * This function creates a menu item in SillyTavern's Extensions dropdown
 * that scrolls to and opens the extension's settings panel.
 */
function addExtensionMenuButton() {
    // Select the Extensions dropdown menu
    const extensionsMenu = document.getElementById('extensionsMenu');
    if (!extensionsMenu) {
        console.warn('[SDC] Extensions menu not found');
        return;
    }

    // Check if button already exists to prevent duplicates
    if (document.getElementById('sdc-extensions-menu-button')) {
        return;
    }

    // Create button element with palette icon and extension name
    const button = document.createElement('div');
    button.id = 'sdc-extensions-menu-button';
    button.className = 'list-group-item flex-container flexGap5 interactable';
    button.title = 'Open Smart Dialogue Colorizer Settings';
    button.setAttribute('tabindex', '0');
    button.innerHTML = `
        <i class="fa-solid fa-palette"></i>
        <span>Dialogue Colorizer</span>
    `;

    // Append to extensions menu
    extensionsMenu.appendChild(button);

    // Set click handler to scroll to and open the settings
    button.addEventListener('click', () => {
        // Find the settings drawer
        const settingsDrawer = document.getElementById('sdc-extension-settings');
        if (!settingsDrawer) {
            console.warn('[SDC] Settings drawer not found');
            return;
        }

        // Scroll to the settings
        settingsDrawer.scrollIntoView({ behavior: 'smooth', block: 'start' });

        // Open the drawer if it's not already open
        const drawerToggle = settingsDrawer.querySelector('.inline-drawer-toggle');
        const drawerContent = settingsDrawer.querySelector('.inline-drawer-content');
        const drawerIcon = settingsDrawer.querySelector('.inline-drawer-icon');

        if (drawerToggle && drawerContent && !drawerContent.classList.contains('open')) {
            drawerToggle.classList.add('open');
            drawerContent.classList.add('open');
            if (drawerIcon) {
                drawerIcon.classList.remove('down');
                drawerIcon.classList.add('up');
            }
        }

        // Brief highlight effect to draw attention
        settingsDrawer.style.transition = 'background-color 0.3s ease';
        const originalBg = settingsDrawer.style.backgroundColor;
        settingsDrawer.style.backgroundColor = 'rgba(var(--SmartThemeBodyColor), 0.3)';
        setTimeout(() => {
            settingsDrawer.style.backgroundColor = originalBg;
        }, 600);
    });
}

function initializeCharSpecificUI() {
    // Character
    const elemCharColorOverride = createColorOverrideElem("sdc-char_color_override", getCharacterBeingEdited);

    const elemCharCardForm = document.getElementById("form_create");
    const elemAvatarNameBlock = elemCharCardForm.querySelector("div#avatar-and-name-block");
    elemAvatarNameBlock.insertAdjacentElement("afterend", elemCharColorOverride);

    // Persona
    const elemPersonaColorOverride = createColorOverrideElem("sdc-persona_color_override", getCurrentPersona);

    const elemPersonaDescription = document.getElementById("persona_description");
    const elemDescParent = elemPersonaDescription.parentElement;
    elemDescParent.insertAdjacentElement("afterbegin", elemPersonaColorOverride);

    /**
     * 
     * @param {string} id 
     * @param {() => STCharacter} stCharGetter
     */
    function createColorOverrideElem(id, stCharGetter) {
        // Create container that matches ST's form structure
        const wrapper = document.createElement('div');
        wrapper.id = id;
        wrapper.className = "sdc-color-override-container";

        // Add subtle separator at top
        const separator = document.createElement('div');
        separator.className = "sdc-separator";
        
        // Create label row with icon and preview
        const labelRow = document.createElement('div');
        labelRow.className = "sdc-label-row";
        
        const label = document.createElement('label');
        label.htmlFor = `${id}-input`;
        label.className = "sdc-override-label";
        label.innerHTML = `
            <span style="font-weight: 500;">Dialogue Color Override</span>
            <i class="fa-solid fa-circle-info margin5 opacity50p" 
               title="Set a custom color for this character's dialogue. Leave empty to use global settings."></i>
        `;
        
        // Add a preview swatch that shows current color
        const previewSwatch = document.createElement('div');
        previewSwatch.className = "sdc-color-preview";
        previewSwatch.title = "Current dialogue color preview";
        
        labelRow.appendChild(label);
        labelRow.appendChild(previewSwatch);
        
        // Create input row with better layout
        const inputRow = document.createElement('div');
        inputRow.className = "sdc-input-row";
        
        const inputColorPickerCombo = createColorTextPickerCombo(
            (textboxValue) => getTextValidHexOrDefault(textboxValue, ""), 
            (colorValue) => {
                // Update preview swatch
                if (colorValue && colorValue.length > 0) {
                    previewSwatch.style.backgroundColor = colorValue;
                    previewSwatch.style.borderColor = colorValue;
                    clearBtn.style.display = "flex";
                } else {
                    previewSwatch.style.backgroundColor = "transparent";
                    previewSwatch.style.borderColor = "var(--SmartThemeBorderColor, #666)";
                    clearBtn.style.display = "none";
                }
                
                const stChar = stCharGetter();
                const colorSettings = getSettingsForChar(stChar);
                if (colorValue.length > 0)
                    colorSettings.colorOverrides[stChar.avatarName] = colorValue;
                else
                    delete colorSettings.colorOverrides[stChar.avatarName];

                // Clear cache when override changes to ensure fresh colors
                clearCacheForCharacter(stChar);

                if (stChar.type === CharacterType.PERSONA) {
                    onPersonaSettingsUpdated();
                } else {
                    onCharacterSettingsUpdated();
                }
            }
        );
        
        inputColorPickerCombo.id = `${id}-input`;
        
        // Add clear button with icon
        const clearBtn = document.createElement('button');
        clearBtn.type = "button";
        clearBtn.className = "menu_button menu_button_icon sdc-clear-btn";
        clearBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        clearBtn.title = "Clear color override and use auto-detection";
        clearBtn.style.display = "none"; // Hidden by default
        clearBtn.onclick = () => {
            const textInput = inputColorPickerCombo.querySelector('input[type="text"]');
            const colorInput = inputColorPickerCombo.querySelector('input[type="color"]');
            textInput.value = "";
            colorInput.value = "#000000";
            textInput.dispatchEvent(new Event('focusout', { bubbles: true }));
        };
        
        inputRow.appendChild(inputColorPickerCombo);
        inputRow.appendChild(clearBtn);
        
        wrapper.appendChild(separator);
        wrapper.appendChild(labelRow);
        wrapper.appendChild(inputRow);
        
        // Initialize preview with current value if exists
        setTimeout(() => {
            const stChar = stCharGetter();
            const colorSettings = getSettingsForChar(stChar);
            const currentColor = colorSettings.colorOverrides[stChar.avatarName];
            if (currentColor) {
                previewSwatch.style.backgroundColor = currentColor;
                previewSwatch.style.borderColor = currentColor;
                clearBtn.style.display = "flex";
            }
        }, 100);
        
        return wrapper;
    }
}

jQuery(async ($) => {
    const settingsHtml = await $.get(`${extFolderPath}/dialogue-colorizer.html`);

    const elemStExtensionSettings2 = document.getElementById("extensions_settings2");
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

    // Watch for theme changes to update colors automatically
    const themeObserver = new MutationObserver(debounce(() => {
        // When body class or style changes, it might be a theme change
        // We trigger a refresh of the stylesheets which will re-evaluate isLightTheme()
        updateCharactersStyleSheet();
        updatePersonasStyleSheet();
    }, 500));
    
    themeObserver.observe(document.body, { 
        attributes: true, 
        attributeFilter: ['class', 'style'] 
    });
})

//#endregion Initialization
