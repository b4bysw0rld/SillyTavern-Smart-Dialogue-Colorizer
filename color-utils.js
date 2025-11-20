import "./Vibrant.min.js";
import "./color-thief.umd.js"; // Color Thief fallback for missing swatches
import { waitForImage } from "./utils.js";

/** @type {VibrantConstructor} */
export const Vibrant = window["Vibrant"];
const ColorThief = window["ColorThief"];
const swatchCache = new Map();
const pendingSwatches = new Map();

/**
 * RGB to HSL conversion for color classification.
 * @param {number} r - Red (0-255)
 * @param {number} g - Green (0-255)
 * @param {number} b - Blue (0-255)
 * @returns {{h: number, s: number, l: number}} HSL values (h: 0-360, s: 0-100, l: 0-100)
 */
function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
        h = s = 0; // achromatic
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
            case g: h = ((b - r) / d + 2) / 6; break;
            case b: h = ((r - g) / d + 4) / 6; break;
        }
    }

    return { h: h * 360, s: s * 100, l: l * 100 };
}

/**
 * Classifies a color based on Vibrant.js criteria.
 * @param {number} r - Red (0-255)
 * @param {number} g - Green (0-255)
 * @param {number} b - Blue (0-255)
 * @returns {string} Classification like "Vibrant", "DarkMuted", etc.
 */
function classifyColor(r, g, b) {
    const hsl = rgbToHsl(r, g, b);
    const saturation = hsl.s;
    const lightness = hsl.l;

    const isVibrant = saturation > 40;
    const vibrancyType = isVibrant ? 'Vibrant' : 'Muted';

    let lightnessType = '';
    if (lightness < 40) {
        lightnessType = 'Dark';
    } else if (lightness > 60) {
        lightnessType = 'Light';
    }

    return lightnessType ? `${lightnessType}${vibrancyType}` : vibrancyType;
}

/**
 * Takes a loaded image and downscales it onto a canvas for fast color analysis.
 * @param {HTMLImageElement} image The fully loaded source image.
 * @param {number} maxDimension The maximum width or height of the scaled-down canvas.
 * @returns {HTMLCanvasElement} A canvas element containing the downscaled image.
 */
function createDownscaledCanvas(image, maxDimension = 1024) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    let width = image.width;
    let height = image.height;

    // Calculate the new dimensions to maintain aspect ratio
    if (width > height) {
        if (width > maxDimension) {
            height *= maxDimension / width;
            width = maxDimension;
        }
    } else {
        if (height > maxDimension) {
            width *= maxDimension / height;
            height = maxDimension;
        }
    }
    
    // Round the dimensions to the nearest whole number
    canvas.width = Math.round(width);
    canvas.height = Math.round(height);

    // Draw the image onto the canvas, which performs the resizing
    ctx.drawImage(image, 0, 0, width, height);

    // Patch for ColorThief compatibility:
    // ColorThief expects 'naturalWidth' and 'naturalHeight' properties which exist on Images but not Canvases.
    // We add them manually so ColorThief can process this downscaled canvas without error.
    // @ts-ignore
    canvas.naturalWidth = canvas.width;
    // @ts-ignore
    canvas.naturalHeight = canvas.height;

    return canvas;
}

/**
 * Gets a palette from Color Thief, classifies each color into a Vibrant.js category,
 * and returns a swatch object compatible with Vibrant.js.
 * @param {HTMLImageElement | HTMLCanvasElement} image The image or canvas to analyze.
 * @param {number} paletteSize The number of colors to extract.
 * @returns {Object.<string, Object>} A dictionary of classified swatches.
 * @throws {Error} If Color Thief fails to extract a palette from the image
 */
function getColorThiefSwatches(image, paletteSize = 12) {
    const colorThief = new ColorThief();
    // Extract a larger palette of colors
    const palette = colorThief.getPalette(image, paletteSize);
    
    // Validate that Color Thief returned a valid palette array
    // getPalette() can return null or false on failure
    if (!palette || !Array.isArray(palette) || palette.length === 0) {
        throw new Error('[SDC] Color Thief failed to extract palette from image');
    }
    
    const classifiedSwatches = {};
    const usedCategories = new Set();
    
    // Classify each color and assign it to the first available category slot
    for (const color of palette) {
        const classification = classifyColor(color[0], color[1], color[2]);
        
        // Only assign if this category hasn't been filled yet
        // This ensures the first (and likely most dominant) color for a category wins
        if (classification && !usedCategories.has(classification)) {
            classifiedSwatches[classification] = {
                // Color Thief gives RGB array, so we create a mock Swatch object
                getRgb: () => color,
                getHex: () => '#' + color.map(x => {
                    const hex = x.toString(16);
                    return hex.length === 1 ? '0' + hex : hex;
                }).join(''),
            };
            usedCategories.add(classification);
        }
    }
    
    return classifiedSwatches;
}

/**
 * Gets swatches from an image using Vibrant.js with Color Thief fallback.
 * Caches results for performance.
 * @param {HTMLImageElement} image
 * @returns {Promise<Object.<string, Object>>} Dictionary of swatches
 */
async function getSwatchesFromImage(image) {
    await waitForImage(image);
    const cacheKey = image.src;
    
    // Check result cache
    if (swatchCache.has(cacheKey)) return swatchCache.get(cacheKey);

    // Check pending requests to avoid duplicate work
    if (pendingSwatches.has(cacheKey)) {
        return pendingSwatches.get(cacheKey);
    }

    const processPromise = (async () => {
        try {
            const imageSourceForAnalysis = createDownscaledCanvas(image);

            // Get the initial results from Vibrant.js
            const vibrant = new Vibrant(imageSourceForAnalysis, 96, 8);
            let swatches = vibrant.swatches();
            
            // Define all the swatches we absolutely require
            const requiredSwatches = [
                'Vibrant', 'DarkVibrant', 'LightVibrant',
                'Muted', 'DarkMuted', 'LightMuted'
            ];

            // Check if any of the required swatches are missing from the result
            const isMissingSwatches = requiredSwatches.some(swatchName => !swatches[swatchName]);
            
            // If ANY swatch is missing, run the Color Thief fallback to fill the gaps
            if (isMissingSwatches) {
                try {
                    // Get the classified swatches from Color Thief
                    const colorThiefSwatches = getColorThiefSwatches(imageSourceForAnalysis, 12);
                    
                    // Create a new merged swatch object. Start with Vibrant.js results.
                    const mergedSwatches = { ...swatches };

                    // Intelligently fill in the blanks
                    for (const swatchName of requiredSwatches) {
                        // If the original swatches are missing this one,
                        if (!mergedSwatches[swatchName] && colorThiefSwatches[swatchName]) {
                            mergedSwatches[swatchName] = colorThiefSwatches[swatchName];
                        }
                    }
                    
                    // The final result is the merged object
                    swatches = mergedSwatches;

                } catch (err) {
                    console.warn('[SDC] Color Thief fallback failed:', err);
                }
            }
            
            swatchCache.set(cacheKey, swatches);

            // Limit cache size to prevent memory issues
            if (swatchCache.size > 50) {
                const oldestKey = swatchCache.keys().next().value;
                swatchCache.delete(oldestKey);
            }
            
            return swatches;
        } finally {
            // Always clean up pending promise
            pendingSwatches.delete(cacheKey);
        }
    })();

    pendingSwatches.set(cacheKey, processPromise);
    return processPromise;
}

/**
 * Checks if a color has good quality for dialogue text.
 * Rejects colors that are too dark, too light, or too desaturated.
 * 
 * @param {[number, number, number]} rgb
 * @returns {boolean}
 */
function isColorQualityGood(rgb) {
    if (!rgb) return false;
    const [r, g, b] = rgb;
    
    // Calculate relative luminance
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    
    // Reject if too dark or too light
    if (luminance < 0.15 || luminance > 0.95) {
        return false;
    }
    
    // Calculate saturation
    const max = Math.max(r, g, b) / 255;
    const min = Math.min(r, g, b) / 255;
    const saturation = max === 0 ? 0 : (max - min) / max;
    
    // Reject if too desaturated (grayish)
    if (saturation < 0.2) {
        return false;
    }
    
    return true;
}

/**
 * Gets average color from all available swatches, weighted by population.
 * This favors more dominant colors in the image.
 * 
 * @param {Object.<string, Object>} swatches
 * @returns {[number, number, number]?}
 */
function getAverageColorFromSwatches(swatches) {
    const validSwatches = Object.values(swatches).filter(s => s !== null && s !== undefined);
    
    if (validSwatches.length === 0) {
        return null;
    }
    
    let totalR = 0, totalG = 0, totalB = 0;
    let totalPopulation = 0;
    
    // Weight each color by its population (how many pixels have this color)
    for (const swatch of validSwatches) {
        const [r, g, b] = swatch.getRgb();
        const population = swatch.getPopulation ? swatch.getPopulation() : 1; // Fallback to 1 if undefined
        
        totalR += r * population;
        totalG += g * population;
        totalB += b * population;
        totalPopulation += population;
    }
    
    // Avoid division by zero
    if (totalPopulation === 0) {
        totalPopulation = 1;
    }
    
    return [
        Math.round(totalR / totalPopulation),
        Math.round(totalG / totalPopulation),
        Math.round(totalB / totalPopulation)
    ];
}

/**
 * Gets the best available color from an image with smart fallback.
 * Uses Vibrant.js with Color Thief fallback for missing swatches.
 * Tries Vibrant → DarkVibrant → LightVibrant → Muted → DarkMuted → LightMuted → Average in order.
 * Filters out colors that are too dark, light, or desaturated.
 * 
 * @param {HTMLImageElement} image
 * @returns {Promise<[number, number, number]?>}
 */
export async function getSmartAvatarColor(image) {
    const swatches = await getSwatchesFromImage(image);
    
    // Try different swatches in order of preference, testing each for quality
    const swatchPriority = ["Vibrant", "DarkVibrant", "LightVibrant", "Muted", "DarkMuted", "LightMuted"];
    
    for (const swatchName of swatchPriority) {
        const swatch = swatches[swatchName];
        if (swatch) {
            const rgb = swatch.getRgb();
            if (isColorQualityGood(rgb)) {
                return rgb;
            }
        }
    }
    
    // If no good swatch found after trying all, calculate average color from palette
    return getAverageColorFromSwatches(swatches);
}
