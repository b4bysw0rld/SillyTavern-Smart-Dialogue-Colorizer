//#region ST imports

import { eventSource, event_types, saveSettingsDebounced } from "../../../../script.js";
import { extension_settings } from "../../../extensions.js";

//#endregion ST imports

//#region Local imports

import { ExColor } from "./ExColor.js";
import { CharacterType, STCharacter } from "./STCharacter.js";
import { getSmartAvatarColor } from "./color-utils.js";
import { createColorSourceDropdown, createColorTextPickerCombo, createSliderWithLabel, createCheckboxWithLabel } from "./element-creators.js";
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
    colorItalicText: false,
    italicGreyMix: 70,
    saturationAdjustment: 0,
    lightnessAdjustment: 0,
};
const defaultExtSettings = {
    charColorSettings: defaultCharColorSettings,
    personaColorSettings: defaultCharColorSettings,
};

const extName = "SillyTavern-Smart-Dialogue-Colorizer";
const extFolderPath = `scripts/extensions/third-party/${extName}`;
const extSettings = initializeSettings(extName, defaultExtSettings);

/** @type {HTMLElement?} */
let popoutElement = null;
let popoutVisible = false;

/**
 * Creates a visible stub in Extensions panel with button to open pop-out
 */
function createExtensionStub(container) {
    if (!container) return;
    if (document.getElementById('sdc-extension-stub')) return;

    const stub = document.createElement('div');
    stub.id = 'sdc-extension-stub';
    stub.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Smart Dialogue Colorizer</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div style="padding: 10px;">
                    <button id="sdc-open-popout-btn" class="menu_button" style="width: 100%;">
                        <i class="fa-solid fa-palette"></i>
                        <span style="margin-left: 8px;">Open Settings in Pop-out</span>
                    </button>
                    <div style="margin-top: 10px; font-size: 0.9em; opacity: 0.7; text-align: center;">
                        Click to open the settings panel, or use the Extensions menu.
                    </div>
                </div>
            </div>
        </div>
    `;
    container.appendChild(stub);

    // Wire up button
    const openBtn = stub.querySelector('#sdc-open-popout-btn');
    if (openBtn) {
        openBtn.addEventListener('click', toggleSettingsPopout);
    }
}

/**
 * Creates hidden drawer in Extensions panel (Moonlit Echoes pattern)
 */
function createHiddenSettingsDrawer(container, settingsHtml) {
    if (!container) return;
    if (document.getElementById('sdc-settings-drawer')) return;

    const drawer = document.createElement('div');
    drawer.id = 'sdc-settings-drawer';
    drawer.className = 'inline-drawer';
    drawer.style.display = 'none'; // Always hidden

    drawer.innerHTML = `<div class="inline-drawer-content open">${settingsHtml}</div>`;
    container.appendChild(drawer);
}

/**
 * Opens popout by moving drawer content into floating window
 */
function openSettingsPopout() {
    if (popoutVisible) return;

    const drawer = document.getElementById('sdc-settings-drawer');
    if (!drawer) return;

    const drawerContent = drawer.querySelector('.inline-drawer-content');
    if (!drawerContent) return;

    // Create popout
    popoutElement = document.createElement('div');
    popoutElement.id = 'sdc_popout';
    popoutElement.className = 'draggable';
    popoutElement.style.display = 'none';
    popoutElement.innerHTML = `
        <div class="panelControlBar flex-container">
            <div class="fa-solid fa-palette" style="margin-right: 10px;"></div>
            <div class="title">Smart Dialogue Colorizer</div>
            <div class="flex1"></div>
            <div class="fa-solid fa-circle-xmark hoverglow dragClose"></div>
        </div>
        <div id="sdc_popout_content"></div>
    `;

    // Append to movingDivs
    const movingDivs = document.getElementById('movingDivs');
    if (movingDivs) {
        movingDivs.appendChild(popoutElement);
    } else {
        document.body.appendChild(popoutElement);
    }

    // Move content
    const contentContainer = popoutElement.querySelector('#sdc_popout_content');
    drawerContent.style.display = '';
    contentContainer.appendChild(drawerContent);

    // Close handler
    popoutElement.querySelector('.dragClose').addEventListener('click', closeSettingsPopout);

    $(popoutElement).fadeIn(250);
    popoutVisible = true;

    $(document).on('keydown.sdc_popout', (event) => {
        if (event.key === 'Escape') closeSettingsPopout();
    });
}

/**
 * Closes popout and returns content to drawer
 */
function closeSettingsPopout() {
    if (!popoutVisible || !popoutElement) return;

    const drawerContent = popoutElement.querySelector('.inline-drawer-content');
    const drawer = document.getElementById('sdc-settings-drawer');

    $(popoutElement).fadeOut(250, () => {
        if (drawerContent && drawer) {
            drawer.appendChild(drawerContent);
        }
        if (popoutElement) popoutElement.remove();
        popoutElement = null;
    });

    popoutVisible = false;
    $(document).off('keydown.sdc_popout');
}

/**
 * Toggle popout open/closed
 */
function toggleSettingsPopout() {
    if (popoutVisible) {
        closeSettingsPopout();
    } else {
        openSettingsPopout();
    }
}

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

        // Apply color to italic text (markdown asterisks) if enabled
        if (colorSettings.colorItalicText) {
            const charColorPercent = 100 - (colorSettings.italicGreyMix || 70);
            const greyPercent = colorSettings.italicGreyMix || 70;
            styleHtml += `
            .mes[sdc-author_uid="${stChar.uid}"] .mes_text em:not(font em) {
                color: color-mix(in srgb, var(--character-color) ${charColorPercent}%, grey ${greyPercent}%) !important;
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
 * Improves color contrast for better readability on dark backgrounds.
 * Ensures adequate saturation and luminance while preserving hue.
 * Applies global saturation adjustment.
 * 
 * NOTE: Brightness slider has been removed; the brightAdjust parameter is kept
 * for backward compatibility but is ignored.
 * 
 * @param {import("./ExColor.js").ColorArray} rgb 
 * @param {number} satAdjust - Saturation adjustment (0 to 10)
 * @param {number} brightAdjust - (unused) Brightness adjustment (0 to 10)
 * @returns {import("./ExColor.js").ColorArray}
 */
function makeBetterContrast(rgb, satAdjust = 0, brightAdjust = 0) {
    const [h, s, l, a] = ExColor.rgb2hsl(rgb);

    let nHue = h;
    let nSat = s;
    let nLum = l;

    // Ensure minimum saturation for vibrancy
    if (nSat < 0.4) {
        nSat = Math.min(nSat + 0.3, 0.8);
    }

    // Ensure luminance is in readable range (not too dark, not too bright)
    if (nLum < 0.5) {
        nLum = 0.65; // Brighten dark colors
    } else if (nLum < 0.7) {
        nLum = 0.7; // Slight boost for mid-range
    } else if (nLum > 0.85) {
        nLum = 0.8; // Tone down very bright colors
    }

    // Apply saturation adjustment (0-10 scale)
    // Saturation: increase only (clamped 0-1), multiplied by 4 for stronger effect (0-40% range)
    nSat = Math.max(0, Math.min(1, nSat + ((satAdjust * 4) / 100)));

    // Convert back to RGB with saturation & contrast adjustments
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
    const prefix = `${stChar.uid}_`;
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
            // Create cache key that includes adjustment values
            const cacheKey = `${stChar.uid}_${colorSettings.saturationAdjustment}_${colorSettings.lightnessAdjustment}`;
            
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
                        colorSettings.saturationAdjustment || 0,
                        colorSettings.lightnessAdjustment || 0
                      )
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
    
    // Color source dropdown
    const charColorSourceDropdown = createColorSourceDropdown("sdc-char_colorize_source", (changedEvent) => {
        const value = $(changedEvent.target).prop("value");
        extSettings.charColorSettings.colorizeSource = value;
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

    // Color italic text checkbox
    const charColorItalicCheckbox = createCheckboxWithLabel(
        "sdc-char_color_italic",
           "Color italic text",
        "When enabled, italic text (e.g. markdown *asterisks*) will be colored with a mix of character color and grey.",
        extSettings.charColorSettings.colorItalicText || false,
        (checked) => {
            extSettings.charColorSettings.colorItalicText = checked;
            // Show/hide the grey mix slider based on checkbox state
            charItalicGreySlider.style.display = checked ? 'block' : 'none';
            onCharacterSettingsUpdated();
        }
    );
    charDialogueSettings.children[2].insertAdjacentElement("afterend", charColorItalicCheckbox);

    // Italic grey mix slider (nested under checkbox)
    const charItalicGreySlider = createSliderWithLabel(
        "sdc-char_italic_grey_mix",
        "Italic Grey Mix %",
        "Percentage of grey in italic text color mix. Higher = more grey, less character color. Range: 0-100",
        0, 100, 5,
        extSettings.charColorSettings.italicGreyMix || 70,
        (value) => {
            extSettings.charColorSettings.italicGreyMix = value;
            onCharacterSettingsUpdated();
        }
    );
    charItalicGreySlider.style.marginLeft = "24px"; // Indent to show it's related to checkbox
    charItalicGreySlider.style.display = (extSettings.charColorSettings.colorItalicText || false) ? 'block' : 'none';
    charDialogueSettings.children[2].insertAdjacentElement("afterend", charItalicGreySlider);

    // Adjustment sliders
    const charAdjustmentsGroup = charDialogueSettings.querySelector(".dc-adjustments-group");

    const charSaturationSlider = createSliderWithLabel(
        "sdc-char_saturation_adjustment",
        "Saturation Boost",
        "Increase color vibrancy. Range: 0-10",
        0, 10, 1,
        extSettings.charColorSettings.saturationAdjustment || 0,
        (value) => {
            extSettings.charColorSettings.saturationAdjustment = value;
            clearCacheForCharType(CharacterType.CHARACTER); // Clear only character cache
            onCharacterSettingsUpdated();
        }
    );
    charAdjustmentsGroup.appendChild(charSaturationSlider);

    // Initialize values
    $(charColorSourceDropdown.querySelector('select'))
        .prop("value", extSettings.charColorSettings.colorizeSource)
        .trigger('change');
    $(charStaticColorPickerCombo.querySelector('input[type="text"]'))
        .prop("value", extSettings.charColorSettings.staticColor)
        .trigger('focusout');

    // ===== PERSONA SETTINGS =====
    const personaDialogueSettings = elemExtensionSettings.querySelector("#sdc-persona_dialogue_settings");
    
    // Color source dropdown
    const personaColorSourceDropdown = createColorSourceDropdown("sdc-persona_colorize_source", (changedEvent) => {
        const value = $(changedEvent.target).prop("value");
        extSettings.personaColorSettings.colorizeSource = value;
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

    // Color italic text checkbox
    const personaColorItalicCheckbox = createCheckboxWithLabel(
        "sdc-persona_color_italic",
        "Color italic text",
        "When enabled, italic text (e.g. markdown *asterisks*) will be colored with a mix of persona color and grey.",
        extSettings.personaColorSettings.colorItalicText || false,
        (checked) => {
            extSettings.personaColorSettings.colorItalicText = checked;
            // Show/hide the grey mix slider based on checkbox state
            personaItalicGreySlider.style.display = checked ? 'block' : 'none';
            onPersonaSettingsUpdated();
        }
    );
    personaDialogueSettings.children[2].insertAdjacentElement("afterend", personaColorItalicCheckbox);

    // Italic grey mix slider (nested under checkbox)
    const personaItalicGreySlider = createSliderWithLabel(
        "sdc-persona_italic_grey_mix",
        "Italic Grey Mix %",
        "Percentage of grey in italic text color mix. Higher = more grey, less persona color. Range: 0-100",
        0, 100, 5,
        extSettings.personaColorSettings.italicGreyMix || 70,
        (value) => {
            extSettings.personaColorSettings.italicGreyMix = value;
            onPersonaSettingsUpdated();
        }
    );
    personaItalicGreySlider.style.marginLeft = "24px"; // Indent to show it's related to checkbox
    personaItalicGreySlider.style.display = (extSettings.personaColorSettings.colorItalicText || false) ? 'block' : 'none';
    personaDialogueSettings.children[2].insertAdjacentElement("afterend", personaItalicGreySlider);

    // Adjustment sliders
    const personaAdjustmentsGroup = personaDialogueSettings.querySelector(".dc-adjustments-group");

    const personaSaturationSlider = createSliderWithLabel(
        "sdc-persona_saturation_adjustment",
        "Saturation Boost",
        "Increase color vibrancy. Range: 0-10",
        0, 10, 1,
        extSettings.personaColorSettings.saturationAdjustment || 0,
        (value) => {
            extSettings.personaColorSettings.saturationAdjustment = value;
            clearCacheForCharType(CharacterType.PERSONA); // Clear only persona cache
            onPersonaSettingsUpdated();
        }
    );
    personaAdjustmentsGroup.appendChild(personaSaturationSlider);

    // Initialize values
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
 * that opens the Extensions panel and scrolls to the extension's settings.
 */
function addExtensionMenuButton() {
    const $extensionsMenu = $('#extensionsMenu');
    if (!$extensionsMenu.length) {
        return;
    }

    if ($extensionsMenu.find('#sdc-extensions-menu-button').length) {
        return;
    }

    const $button = $(`
        <div id="sdc-extensions-menu-button" class="list-group-item flex-container flexGap5 interactable" title="Open Smart Dialogue Colorizer Settings" tabindex="0">
            <i class="fa-solid fa-palette"></i>
            <span>Smart Dialogue Colorizer</span>
        </div>
    `);

    $button.appendTo($extensionsMenu);

    $button.on('click', () => {
        toggleSettingsPopout();
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
    
    // Create visible stub in Extensions panel with button to open pop-out
    createExtensionStub(elemStExtensionSettings2);
    
    // Create hidden drawer for actual settings (Moonlit Echoes pattern)
    createHiddenSettingsDrawer(elemStExtensionSettings2, settingsHtml);

    initializeStyleSheets();
    initializeSettingsUI();
    initializeCharSpecificUI();

    const extensionsButton = document.getElementById("extensionsButton");
    if (extensionsButton) {
        extensionsButton.addEventListener("click", () => {
            setTimeout(() => addExtensionMenuButton(), 0);
        });
    }

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
})

//#endregion Initialization
