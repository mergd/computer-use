/**
 * accessibility-tree.ts - Generates an accessibility tree representation of the page
 *
 * This module provides functionality to traverse the DOM and generate a tree representation
 * that includes element roles, accessible names, and reference IDs for interactive elements.
 */
// Window globals are declared in types.ts
// =============================================================================
// Role Mapping
// =============================================================================
/**
 * Maps HTML tag names to ARIA roles
 */
const ROLE_MAP = {
    a: "link",
    button: "button",
    input: (element) => {
        const inputType = element.getAttribute("type");
        if (inputType === "submit" || inputType === "button")
            return "button";
        if (inputType === "checkbox")
            return "checkbox";
        if (inputType === "radio")
            return "radio";
        if (inputType === "file")
            return "button";
        return "textbox";
    },
    select: "combobox",
    textarea: "textbox",
    h1: "heading",
    h2: "heading",
    h3: "heading",
    h4: "heading",
    h5: "heading",
    h6: "heading",
    img: "image",
    nav: "navigation",
    main: "main",
    header: "banner",
    footer: "contentinfo",
    section: "region",
    article: "article",
    aside: "complementary",
    form: "form",
    table: "table",
    ul: "list",
    ol: "list",
    li: "listitem",
    label: "label",
};
/**
 * Tags that should be excluded from the accessibility tree
 */
const EXCLUDED_TAGS = ["script", "style", "meta", "link", "title", "noscript"];
/**
 * Tags that are considered interactive
 */
const INTERACTIVE_TAGS = ["a", "button", "input", "select", "textarea", "details", "summary"];
/**
 * Tags that are considered landmarks
 */
const LANDMARK_TAGS = [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "nav",
    "main",
    "header",
    "footer",
    "section",
    "article",
    "aside",
];
// =============================================================================
// Helper Functions
// =============================================================================
/**
 * Gets the ARIA role for an element
 * @param element - The DOM element
 * @returns The role of the element
 */
function getElementRole(element) {
    const explicitRole = element.getAttribute("role");
    if (explicitRole) {
        return explicitRole;
    }
    const tagName = element.tagName.toLowerCase();
    const roleEntry = ROLE_MAP[tagName];
    if (typeof roleEntry === "function") {
        return roleEntry(element);
    }
    return roleEntry || "generic";
}
/**
 * Gets the accessible name/label for an element
 * @param element - The DOM element
 * @returns The accessible name of the element
 */
function getAccessibleName(element) {
    const tagName = element.tagName.toLowerCase();
    // Handle select elements specially - get selected option text
    if (tagName === "select") {
        const selectElement = element;
        const selectedOption = selectElement.querySelector("option[selected]") ||
            selectElement.options[selectElement.selectedIndex];
        if (selectedOption && selectedOption.textContent) {
            return selectedOption.textContent.trim();
        }
    }
    // Check aria-label
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel && ariaLabel.trim()) {
        return ariaLabel.trim();
    }
    // Check placeholder
    const placeholder = element.getAttribute("placeholder");
    if (placeholder && placeholder.trim()) {
        return placeholder.trim();
    }
    // Check title
    const title = element.getAttribute("title");
    if (title && title.trim()) {
        return title.trim();
    }
    // Check alt text (for images)
    const altText = element.getAttribute("alt");
    if (altText && altText.trim()) {
        return altText.trim();
    }
    // Check for associated label element
    if (element.id) {
        const labelElement = document.querySelector('label[for="' + element.id + '"]');
        if (labelElement && labelElement.textContent && labelElement.textContent.trim()) {
            return labelElement.textContent.trim();
        }
    }
    // Handle input elements
    if (tagName === "input") {
        const inputElement = element;
        const inputType = element.getAttribute("type") || "";
        const inputValue = element.getAttribute("value");
        if (inputType === "submit" && inputValue && inputValue.trim()) {
            return inputValue.trim();
        }
        if (inputElement.value && inputElement.value.length < 50 && inputElement.value.trim()) {
            return inputElement.value.trim();
        }
    }
    // Get direct text content for buttons, links, and summary elements
    if (["button", "a", "summary"].includes(tagName)) {
        let directText = "";
        for (let nodeIndex = 0; nodeIndex < element.childNodes.length; nodeIndex++) {
            const childNode = element.childNodes[nodeIndex];
            if (childNode.nodeType === Node.TEXT_NODE) {
                directText += childNode.textContent;
            }
        }
        if (directText.trim()) {
            return directText.trim();
        }
    }
    // Get text content for headings
    if (tagName.match(/^h[1-6]$/)) {
        const headingText = element.textContent;
        if (headingText && headingText.trim()) {
            return headingText.trim().substring(0, 100);
        }
    }
    // Images without alt text return empty string
    if (tagName === "img") {
        return "";
    }
    // Fallback: collect direct text nodes
    let collectedText = "";
    for (let childIndex = 0; childIndex < element.childNodes.length; childIndex++) {
        const child = element.childNodes[childIndex];
        if (child.nodeType === Node.TEXT_NODE) {
            collectedText += child.textContent;
        }
    }
    if (collectedText && collectedText.trim() && collectedText.trim().length >= 3) {
        const trimmedText = collectedText.trim();
        return trimmedText.length > 100 ? trimmedText.substring(0, 100) + "..." : trimmedText;
    }
    return "";
}
/**
 * Checks if an element is visible
 * @param element - The DOM element
 * @returns True if the element is visible
 */
function isElementVisible(element) {
    const htmlElement = element;
    const computedStyle = window.getComputedStyle(element);
    return (computedStyle.display !== "none" &&
        computedStyle.visibility !== "hidden" &&
        computedStyle.opacity !== "0" &&
        htmlElement.offsetWidth > 0 &&
        htmlElement.offsetHeight > 0);
}
/**
 * Checks if an element is interactive (clickable, focusable, etc.)
 * @param element - The DOM element
 * @returns True if the element is interactive
 */
function isInteractiveElement(element) {
    const tagName = element.tagName.toLowerCase();
    return (INTERACTIVE_TAGS.includes(tagName) ||
        element.getAttribute("onclick") !== null ||
        element.getAttribute("tabindex") !== null ||
        element.getAttribute("role") === "button" ||
        element.getAttribute("role") === "link" ||
        element.getAttribute("contenteditable") === "true");
}
/**
 * Checks if an element is a structural/landmark element
 * @param element - The DOM element
 * @returns True if the element is a landmark
 */
function isLandmarkElement(element) {
    const tagName = element.tagName.toLowerCase();
    return LANDMARK_TAGS.includes(tagName) || element.getAttribute("role") !== null;
}
/**
 * Determines if an element should be included in the accessibility tree
 * @param element - The DOM element
 * @param options - Filter options
 * @returns True if the element should be included
 */
function shouldIncludeElement(element, options) {
    const tagName = element.tagName.toLowerCase();
    // Skip non-content elements
    if (EXCLUDED_TAGS.includes(tagName)) {
        return false;
    }
    // Skip aria-hidden elements unless filter is "all"
    if (options.filter !== "all" && element.getAttribute("aria-hidden") === "true") {
        return false;
    }
    // Skip invisible elements unless filter is "all"
    if (options.filter !== "all" && !isElementVisible(element)) {
        return false;
    }
    // Skip elements outside viewport unless filter is "all" or we're focused on a ref
    if (options.filter !== "all" && !options.refId) {
        const boundingRect = element.getBoundingClientRect();
        const isInViewport = boundingRect.top < window.innerHeight &&
            boundingRect.bottom > 0 &&
            boundingRect.left < window.innerWidth &&
            boundingRect.right > 0;
        if (!isInViewport) {
            return false;
        }
    }
    // For interactive filter, only include interactive elements
    if (options.filter === "interactive") {
        return isInteractiveElement(element);
    }
    // Include interactive elements
    if (isInteractiveElement(element)) {
        return true;
    }
    // Include landmark elements
    if (isLandmarkElement(element)) {
        return true;
    }
    // Include elements with accessible names
    if (getAccessibleName(element).length > 0) {
        return true;
    }
    // Include elements with meaningful roles
    const role = getElementRole(element);
    return role !== null && role !== "generic" && role !== "image";
}
// =============================================================================
// Main Function
// =============================================================================
(function () {
    // Initialize global state for element tracking
    window.__claudeElementMap = window.__claudeElementMap || {};
    window.__claudeRefCounter = window.__claudeRefCounter || 0;
    /**
     * Generates an accessibility tree representation of the page
     * @param filterMode - Filter mode: "all", "interactive", etc.
     * @param maxDepth - Maximum depth to traverse
     * @param maxChars - Maximum characters allowed in output
     * @param refId - Optional reference ID to focus on a specific element
     * @returns Result object with pageContent, viewport, and optional error
     */
    window.__generateAccessibilityTree = function (filterMode, maxDepth, maxChars, refId) {
        try {
            // Initialize output and options
            const outputLines = [];
            const depthLimit = maxDepth != null ? maxDepth : 15;
            const options = {
                filter: filterMode || "all",
                refId: refId || null,
            };
            /**
             * Recursively builds the accessibility tree
             * @param element - The DOM element to process
             * @param currentDepth - Current depth in the tree
             * @param treeOptions - Filter options
             */
            function buildTree(element, currentDepth, treeOptions) {
                // Stop if we've exceeded max depth
                if (currentDepth > depthLimit) {
                    return;
                }
                // Skip if element is invalid
                if (!element || !element.tagName) {
                    return;
                }
                const shouldInclude = shouldIncludeElement(element, treeOptions) ||
                    (treeOptions.refId !== null && currentDepth === 0);
                if (shouldInclude) {
                    const role = getElementRole(element);
                    const accessibleName = getAccessibleName(element);
                    // Find existing ref or create new one
                    let elementRef = null;
                    for (const existingRef in window.__claudeElementMap) {
                        if (window.__claudeElementMap[existingRef].deref() === element) {
                            elementRef = existingRef;
                            break;
                        }
                    }
                    if (!elementRef) {
                        elementRef = "ref_" + ++window.__claudeRefCounter;
                        window.__claudeElementMap[elementRef] = new WeakRef(element);
                    }
                    // Build the output line
                    const indentation = " ".repeat(currentDepth);
                    let outputLine = indentation + role;
                    // Add accessible name if present
                    if (accessibleName) {
                        let sanitizedName = accessibleName.replace(/\s+/g, " ").substring(0, 100);
                        sanitizedName = sanitizedName.replace(/"/g, '\\"');
                        outputLine += ' "' + sanitizedName + '"';
                    }
                    // Add reference ID
                    outputLine += " [" + elementRef + "]";
                    // Add relevant attributes
                    if (element.getAttribute("href")) {
                        outputLine += ' href="' + element.getAttribute("href") + '"';
                    }
                    if (element.getAttribute("type")) {
                        outputLine += ' type="' + element.getAttribute("type") + '"';
                    }
                    if (element.getAttribute("placeholder")) {
                        outputLine += ' placeholder="' + element.getAttribute("placeholder") + '"';
                    }
                    outputLines.push(outputLine);
                    // Handle select options specially
                    if (element.tagName.toLowerCase() === "select") {
                        const selectOptions = element.options;
                        for (let optionIndex = 0; optionIndex < selectOptions.length; optionIndex++) {
                            const option = selectOptions[optionIndex];
                            const optionIndent = " ".repeat(currentDepth + 1);
                            let optionLine = optionIndent + "option";
                            const optionText = option.textContent ? option.textContent.trim() : "";
                            if (optionText) {
                                let sanitizedOptionText = optionText.replace(/\s+/g, " ").substring(0, 100);
                                sanitizedOptionText = sanitizedOptionText.replace(/"/g, '\\"');
                                optionLine += ' "' + sanitizedOptionText + '"';
                                if (option.selected) {
                                    optionLine += " (selected)";
                                }
                                if (option.value && option.value !== optionText) {
                                    optionLine += ' value="' + option.value.replace(/"/g, '\\"') + '"';
                                }
                                outputLines.push(optionLine);
                            }
                        }
                    }
                }
                // Recursively process children
                if (element.children && currentDepth < depthLimit) {
                    for (let childIndex = 0; childIndex < element.children.length; childIndex++) {
                        const nextDepth = shouldInclude ? currentDepth + 1 : currentDepth;
                        buildTree(element.children[childIndex], nextDepth, treeOptions);
                    }
                }
            }
            // If a specific ref ID is provided, start from that element
            if (refId) {
                const elementWeakRef = window.__claudeElementMap[refId];
                if (!elementWeakRef) {
                    return {
                        error: "Element with ref_id '" +
                            refId +
                            "' not found. It may have been removed from the page. Use read_page without ref_id to get the current page state.",
                        pageContent: "",
                        viewport: {
                            width: window.innerWidth,
                            height: window.innerHeight,
                        },
                    };
                }
                const targetElement = elementWeakRef.deref();
                if (!targetElement) {
                    return {
                        error: "Element with ref_id '" +
                            refId +
                            "' no longer exists. It may have been removed from the page. Use read_page without ref_id to get the current page state.",
                        pageContent: "",
                        viewport: {
                            width: window.innerWidth,
                            height: window.innerHeight,
                        },
                    };
                }
                buildTree(targetElement, 0, options);
            }
            else {
                // Start from document body
                if (document.body) {
                    buildTree(document.body, 0, options);
                }
            }
            // Clean up stale references from the element map
            for (const refKey in window.__claudeElementMap) {
                if (!window.__claudeElementMap[refKey].deref()) {
                    delete window.__claudeElementMap[refKey];
                }
            }
            // Build final output
            const pageContent = outputLines.join("\n");
            // Check if output exceeds character limit
            if (maxChars != null && pageContent.length > maxChars) {
                let errorMessage = "Output exceeds " + maxChars + " character limit (" + pageContent.length + " characters). ";
                if (refId) {
                    errorMessage +=
                        "The specified element has too much content. Try specifying a smaller depth parameter or focus on a more specific child element.";
                }
                else if (maxDepth !== undefined) {
                    errorMessage +=
                        "Try specifying an even smaller depth parameter or use ref_id to focus on a specific element.";
                }
                else {
                    errorMessage +=
                        "Try specifying a depth parameter (e.g., depth: 5) or use ref_id to focus on a specific element from the page.";
                }
                return {
                    error: errorMessage,
                    pageContent: "",
                    viewport: {
                        width: window.innerWidth,
                        height: window.innerHeight,
                    },
                };
            }
            return {
                pageContent: pageContent,
                viewport: {
                    width: window.innerWidth,
                    height: window.innerHeight,
                },
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            throw new Error("Error generating accessibility tree: " + errorMessage);
        }
    };
})();
// =============================================================================
// Exports for backward compatibility
// =============================================================================
/**
 * Export the generate function for use in other modules
 */
export const __generateAccessibilityTree = window.__generateAccessibilityTree;
