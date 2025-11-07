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
    hueAdjustment: 0,
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
 * Improves color contrast for better readability on dark backgrounds.
 * Ensures adequate saturation and luminance while preserving hue.
 * Applies global color adjustments.
 * 
 * @param {import("./ExColor.js").ColorArray} rgb 
 * @param {number} hueAdjust - Hue adjustment in degrees (-180 to 180)
 * @param {number} satAdjust - Saturation adjustment percentage (-100 to 100)
 * @param {number} lumAdjust - Lightness adjustment percentage (-100 to 100)
 * @returns {import("./ExColor.js").ColorArray}
 */
function makeBetterContrast(rgb, hueAdjust = 0, satAdjust = 0, lumAdjust = 0) {
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

    // Apply global adjustments
    // Hue: shift on color wheel (wraps around 0-360)
    nHue = (nHue + hueAdjust + 360) % 360;
    
    // Saturation: adjust percentage (clamped 0-1)
    nSat = Math.max(0, Math.min(1, nSat + (satAdjust / 100)));
    
    // Lightness: adjust percentage (clamped 0-1)
    nLum = Math.max(0, Math.min(1, nLum + (lumAdjust / 100)));

    return ExColor.hsl2rgb([nHue, nSat, nLum, a]);
}

let avatarColorCache = {};
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
            const cacheKey = `${stChar.uid}_${colorSettings.hueAdjustment}_${colorSettings.saturationAdjustment}_${colorSettings.lightnessAdjustment}`;
            
            // Check cache first
            if (avatarColorCache[cacheKey]) {
                return avatarColorCache[cacheKey];
            }
            
            const avatar = stChar.getAvatarImageThumbnail();
            const colorRgb = await getSmartAvatarColor(avatar);
            const betterContrastRgb = colorRgb 
                ? makeBetterContrast(
                    colorRgb, 
                    colorSettings.hueAdjustment || 0,
                    colorSettings.saturationAdjustment || 0,
                    colorSettings.lightnessAdjustment || 0
                  )
                : DEFAULT_STATIC_DIALOGUE_COLOR_RGB;
            const exColor = ExColor.fromRgb(betterContrastRgb);
            
            // Cache the result
            avatarColorCache[cacheKey] = exColor;
            return exColor;
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

//#region Event Handlers

async function onCharacterSettingsUpdated() {
    await updateCharactersStyleSheet();
    saveSettingsDebounced();
}

async function onPersonaSettingsUpdated() {
    await updatePersonasStyleSheet();
    saveSettingsDebounced();
}

async function onAnySettingsUpdated() {
    await updateCharactersStyleSheet();
    await updatePersonasStyleSheet();
    saveSettingsDebounced();
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

    // Adjustment sliders
    const charAdjustmentsGroup = charDialogueSettings.querySelector(".dc-adjustments-group");
    
    const charHueSlider = createSliderWithLabel(
        "sdc-char_hue_adjustment",
        "Hue Adjustment",
        "Shift colors on the color wheel. Adjust hue by -30° to +30°.",
        -30, 30, 1,
        extSettings.charColorSettings.hueAdjustment || 0,
        (value) => {
            extSettings.charColorSettings.hueAdjustment = value;
            avatarColorCache = {}; // Clear cache when adjustments change
            onCharacterSettingsUpdated();
        }
    );
    charAdjustmentsGroup.appendChild(charHueSlider);

    const charSaturationSlider = createSliderWithLabel(
        "sdc-char_saturation_adjustment",
        "Saturation Adjustment",
        "Boost or reduce color vibrancy. Adjust saturation by -50% to +50%.",
        -50, 50, 1,
        extSettings.charColorSettings.saturationAdjustment || 0,
        (value) => {
            extSettings.charColorSettings.saturationAdjustment = value;
            avatarColorCache = {}; // Clear cache when adjustments change
            onCharacterSettingsUpdated();
        }
    );
    charAdjustmentsGroup.appendChild(charSaturationSlider);

    const charLightnessSlider = createSliderWithLabel(
        "sdc-char_lightness_adjustment",
        "Brightness Adjustment",
        "Make colors brighter or darker. Adjust brightness by -50% to +50%.",
        -50, 50, 1,
        extSettings.charColorSettings.lightnessAdjustment || 0,
        (value) => {
            extSettings.charColorSettings.lightnessAdjustment = value;
            avatarColorCache = {}; // Clear cache when adjustments change
            onCharacterSettingsUpdated();
        }
    );
    charAdjustmentsGroup.appendChild(charLightnessSlider);

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

    // Adjustment sliders
    const personaAdjustmentsGroup = personaDialogueSettings.querySelector(".dc-adjustments-group");
    
    const personaHueSlider = createSliderWithLabel(
        "sdc-persona_hue_adjustment",
        "Hue Adjustment",
        "Shift colors on the color wheel. Adjust hue by -30° to +30°.",
        -30, 30, 1,
        extSettings.personaColorSettings.hueAdjustment || 0,
        (value) => {
            extSettings.personaColorSettings.hueAdjustment = value;
            avatarColorCache = {}; // Clear cache when adjustments change
            onPersonaSettingsUpdated();
        }
    );
    personaAdjustmentsGroup.appendChild(personaHueSlider);

    const personaSaturationSlider = createSliderWithLabel(
        "sdc-persona_saturation_adjustment",
        "Saturation Adjustment",
        "Boost or reduce color vibrancy. Adjust saturation by -50% to +50%.",
        -50, 50, 1,
        extSettings.personaColorSettings.saturationAdjustment || 0,
        (value) => {
            extSettings.personaColorSettings.saturationAdjustment = value;
            avatarColorCache = {}; // Clear cache when adjustments change
            onPersonaSettingsUpdated();
        }
    );
    personaAdjustmentsGroup.appendChild(personaSaturationSlider);

    const personaLightnessSlider = createSliderWithLabel(
        "sdc-persona_lightness_adjustment",
        "Brightness Adjustment",
        "Make colors brighter or darker. Adjust brightness by -50% to +50%.",
        -50, 50, 1,
        extSettings.personaColorSettings.lightnessAdjustment || 0,
        (value) => {
            extSettings.personaColorSettings.lightnessAdjustment = value;
            avatarColorCache = {}; // Clear cache when adjustments change
            onPersonaSettingsUpdated();
        }
    );
    personaAdjustmentsGroup.appendChild(personaLightnessSlider);

    // Initialize values
    $(personaColorSourceDropdown.querySelector('select'))
        .prop("value", extSettings.personaColorSettings.colorizeSource)
        .trigger('change');
    $(personaStaticColorPickerCombo.querySelector('input[type="text"]'))
        .prop("value", extSettings.personaColorSettings.staticColor)
        .trigger('focusout');
}

function initializeCharSpecificUI() {
    // Character
    const elemCharColorOverride = createColorOverrideElem("sdc-char_color_override", getCharacterBeingEdited);

    const elemCharCardForm = document.getElementById("form_create");
    const elemAvatarNameBlock = elemCharCardForm.querySelector("div#avatar-and-name-block");
    elemAvatarNameBlock.insertAdjacentElement("afterend", elemCharColorOverride);

    // Persona
    const elemPersonaColorOverride = createColorOverrideElem("sdc-persona_color_override", getCurrentPersona);
    elemPersonaColorOverride.removeChild(elemPersonaColorOverride.querySelector("hr.sysHR")); // eh

    const elemPersonaDescription = document.getElementById("persona_description");
    const elemDescParent = elemPersonaDescription.parentElement;
    elemDescParent.insertAdjacentElement("afterbegin", elemPersonaColorOverride);

    /**
     * 
     * @param {string} id 
     * @param {() => STCharacter} stCharGetter
     */
    function createColorOverrideElem(id, stCharGetter) {
        const label = document.createElement('label');
        label.htmlFor = id;
        label.title = "The color to use for this character's dialogue (quoted text). Overrides the global setting.";
        label.innerHTML = `Dialogue Color<span class="margin5 fa-solid fa-circle-info opacity50p"></span>`;

        const hr = document.createElement('hr');
        hr.className = "sysHR";

        const inputColorPickerCombo = createColorTextPickerCombo(
            (textboxValue) => getTextValidHexOrDefault(textboxValue, ""), 
            (colorValue) => {
                const stChar = stCharGetter();
                const colorSettings = getSettingsForChar(stChar);
                if (colorValue.length > 0)
                    colorSettings.colorOverrides[stChar.avatarName] = colorValue;
                else
                    delete colorSettings.colorOverrides[stChar.avatarName];

                if (stChar.type === CharacterType.PERSONA) {
                    onPersonaSettingsUpdated();
                }
                else {
                    onCharacterSettingsUpdated();
                }
            }
        );

        const wrapper = document.createElement('div');
        wrapper.id = id;
        wrapper.className = "dc-flex-container";
        wrapper.appendChild(hr);
        wrapper.appendChild(label);
        wrapper.appendChild(inputColorPickerCombo);

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

    eventSource.on(event_types.CHAT_CHANGED, () => updateCharactersStyleSheet());
    expEventSource.on(exp_event_type.MESSAGE_ADDED, addAuthorUidClassToMessage);

    expEventSource.on(exp_event_type.CHAR_CARD_CHANGED, onCharacterChanged);
    expEventSource.on(exp_event_type.PERSONA_CHANGED, onPersonaChanged);
    
    eventSource.once(event_types.APP_READY, () => {
        onPersonaChanged(getCurrentPersona()); // Initialize color inputs with starting values.
        updatePersonasStyleSheet();
    });
})

//#endregion Initialization
