import { ColorizeSourceType } from "./index.js";
import { linkInputColorTextPicker } from "./utils.js";

/** @typedef {{value: any, text: string, description: string}} DropdownOptionObject */

/**
 * 
 * @param {string} templateId 
 * @param {boolean?} deep 
 * @returns {DocumentFragment}
 */
export function createTemplateClone(templateId, deep) {
    const tpl = /** @type {HTMLTemplateElement} */ (document.getElementById(templateId));
    return /** @type {DocumentFragment} */ (tpl.content.cloneNode(deep));
}

/**
 * @param {(textboxValue: string) => string?} textboxValueProcessor 
 * @param {(colorHex: string) => void} onColorChanged 
 * @returns 
 */
export function createColorTextPickerCombo(textboxValueProcessor, onColorChanged) {
    const textInput = document.createElement('input');
    textInput.className = "text_pole textarea_compact";
    textInput.type = "text";

    const pickerInput = document.createElement('input');
    pickerInput.className = "dc-color-picker";
    pickerInput.type = "color";

    const pickerWrapper = document.createElement('div');
    pickerWrapper.className = "dc-color-picker-wrapper";
    pickerWrapper.appendChild(pickerInput);

    const wrapper = document.createElement('div');
    wrapper.className = "dc-color-input-combo";
    wrapper.appendChild(pickerWrapper);
    wrapper.appendChild(textInput);

    linkInputColorTextPicker(pickerInput, textInput, textboxValueProcessor, onColorChanged);
    return wrapper;
}

/**
 * 
 * @param {string} id The ID to set on the created elements.
 * @param {DropdownOptionObject[]} optionObjects 
 * @param {string=} labelText The string for the label.
 * @param {string=} description The help text for the label and contents.
 * @param {((event: Event) => void)=} onChangedCallback The 'onchange' callback to add to the dropdown.
 * @returns {HTMLDivElement} The div containing the label and dropdown.
 */
export function createDropdownWithLabel(id, optionObjects, labelText, description, onChangedCallback) {
    const dropdownLabel = document.createElement('label');
    dropdownLabel.htmlFor = id;
    dropdownLabel.innerHTML = labelText;
    if (description) {
        dropdownLabel.title = description;
        dropdownLabel.innerHTML += `<span class="margin5 fa-solid fa-circle-info opacity50p"></span>`;
    }

    const dropdown = document.createElement('select');
    dropdown.id = id;
    dropdown.name = id;
    optionObjects.forEach((optionObj) => {
        const elemOption = document.createElement('option');
        elemOption.value = optionObj.value;
        elemOption.title = optionObj.description;
        elemOption.innerHTML = optionObj.text;
        dropdown.appendChild(elemOption);
    })

    if (onChangedCallback) {
        dropdown.addEventListener('change', onChangedCallback);
    }

    const wrapper = document.createElement('div');
    wrapper.appendChild(dropdownLabel);
    wrapper.appendChild(dropdown);
    return wrapper;
}

/**
 * 
 * @param {string} id The ID to set on the created elements.
 * @param {((event: Event) => void)=} onChangedCallback The 'onchange' callback to add to the dropdown.
 * @returns {HTMLDivElement} The div containing the label and dropdown.
 */
export function createColorSourceDropdown(id, onChangedCallback) {
    const options = [
        {
            value: ColorizeSourceType.AVATAR_SMART, 
            text: "Avatar Smart", 
            description: "Intelligently extracts the best color from the character's avatar with quality filtering and fallback options."
        },
        {
            value: ColorizeSourceType.STATIC_COLOR, 
            text: "Static Color", 
            description: "Use a specified static color for all characters."
        },
        {
            value: ColorizeSourceType.CHAR_COLOR_OVERRIDE, 
            text: "Per-Character Only", 
            description: "Use the default quote color except for characters with a specified override color."
        },
        {
            value: ColorizeSourceType.DISABLED, 
            text: "Disabled", 
            description: "Disable automatic dialogue coloring."
        },
    ];

    return createDropdownWithLabel(id, options, "Color Source", "The source to use for dialogue color.", onChangedCallback);
}

/**
 * Creates a slider input with label and value display.
 * 
 * @param {string} id - The ID for the slider input
 * @param {string} labelText - The label text
 * @param {string} description - Tooltip description
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @param {number} step - Step increment
 * @param {number} defaultValue - Default/initial value
 * @param {(value: number) => void} onChangeCallback - Callback when value changes
 * @returns {HTMLDivElement}
 */
export function createSliderWithLabel(id, labelText, description, min, max, step, defaultValue, onChangeCallback) {
    const label = document.createElement('label');
    label.htmlFor = id;
    label.innerHTML = labelText;
    if (description) {
        label.title = description;
        label.innerHTML += `<span class="margin5 fa-solid fa-circle-info opacity50p"></span>`;
    }

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = id;
    slider.name = id;
    slider.min = min.toString();
    slider.max = max.toString();
    slider.step = step.toString();
    slider.value = defaultValue.toString();
    slider.className = 'dc-slider';

    const valueDisplay = document.createElement('span');
    valueDisplay.className = 'dc-slider-value';
    valueDisplay.textContent = defaultValue.toString();

    const sliderContainer = document.createElement('div');
    sliderContainer.className = 'dc-slider-container';
    sliderContainer.appendChild(slider);
    sliderContainer.appendChild(valueDisplay);

    slider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        valueDisplay.textContent = value.toString();
        if (onChangeCallback) {
            onChangeCallback(value);
        }
    });

    const wrapper = document.createElement('div');
    wrapper.appendChild(label);
    wrapper.appendChild(sliderContainer);
    return wrapper;
}

/**
 * Creates a checkbox input with label.
 * 
 * @param {string} id - The ID for the checkbox input
 * @param {string} labelText - The label text
 * @param {string} description - Tooltip description
 * @param {boolean} defaultChecked - Default checked state
 * @param {(checked: boolean) => void} onChangeCallback - Callback when checked state changes
 * @returns {HTMLDivElement}
 */
export function createCheckboxWithLabel(id, labelText, description, defaultChecked, onChangeCallback) {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = id;
    checkbox.name = id;
    checkbox.checked = defaultChecked;

    const label = document.createElement('label');
    label.htmlFor = id;
    label.innerHTML = labelText;
    if (description) {
        label.title = description;
        label.innerHTML += `<span class="margin5 fa-solid fa-circle-info opacity50p"></span>`;
    }

    checkbox.addEventListener('change', (e) => {
        if (onChangeCallback) {
            onChangeCallback(e.target.checked);
        }
    });

    const wrapper = document.createElement('div');
    wrapper.className = 'dc-checkbox-container';
    wrapper.appendChild(checkbox);
    wrapper.appendChild(label);
    return wrapper;
}