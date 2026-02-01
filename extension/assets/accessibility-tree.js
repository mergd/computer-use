(function () {
  // Initialize global state for element tracking
  window.__claudeElementMap = window.__claudeElementMap || {};
  window.__claudeRefCounter = window.__claudeRefCounter || 0;

  /**
   * Generates an accessibility tree representation of the page
   * @param {string} filterMode - Filter mode: "all", "interactive", etc.
   * @param {number} maxDepth - Maximum depth to traverse
   * @param {number} maxChars - Maximum characters allowed in output
   * @param {string} refId - Optional reference ID to focus on a specific element
   * @returns {Object} Result object with pageContent, viewport, and optional error
   */
  window.__generateAccessibilityTree = function (filterMode, maxDepth, maxChars, refId) {
    try {
      /**
       * Gets the ARIA role for an element
       * @param {Element} element - The DOM element
       * @returns {string} The role of the element
       */
      function getElementRole(element) {
        var explicitRole = element.getAttribute("role");
        if (explicitRole) {
          return explicitRole;
        }

        var tagName = element.tagName.toLowerCase();
        var inputType = element.getAttribute("type");

        var roleMap = {
          a: "link",
          button: "button",
          input:
            inputType === "submit" || inputType === "button"
              ? "button"
              : inputType === "checkbox"
                ? "checkbox"
                : inputType === "radio"
                  ? "radio"
                  : inputType === "file"
                    ? "button"
                    : "textbox",
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

        return roleMap[tagName] || "generic";
      }

      /**
       * Gets the accessible name/label for an element
       * @param {Element} element - The DOM element
       * @returns {string} The accessible name of the element
       */
      function getAccessibleName(element) {
        var tagName = element.tagName.toLowerCase();

        // Handle select elements specially - get selected option text
        if (tagName === "select") {
          var selectElement = element;
          var selectedOption =
            selectElement.querySelector("option[selected]") ||
            selectElement.options[selectElement.selectedIndex];
          if (selectedOption && selectedOption.textContent) {
            return selectedOption.textContent.trim();
          }
        }

        // Check aria-label
        var ariaLabel = element.getAttribute("aria-label");
        if (ariaLabel && ariaLabel.trim()) {
          return ariaLabel.trim();
        }

        // Check placeholder
        var placeholder = element.getAttribute("placeholder");
        if (placeholder && placeholder.trim()) {
          return placeholder.trim();
        }

        // Check title
        var title = element.getAttribute("title");
        if (title && title.trim()) {
          return title.trim();
        }

        // Check alt text (for images)
        var altText = element.getAttribute("alt");
        if (altText && altText.trim()) {
          return altText.trim();
        }

        // Check for associated label element
        if (element.id) {
          var labelElement = document.querySelector('label[for="' + element.id + '"]');
          if (labelElement && labelElement.textContent && labelElement.textContent.trim()) {
            return labelElement.textContent.trim();
          }
        }

        // Handle input elements
        if (tagName === "input") {
          var inputElement = element;
          var inputType = element.getAttribute("type") || "";
          var inputValue = element.getAttribute("value");

          if (inputType === "submit" && inputValue && inputValue.trim()) {
            return inputValue.trim();
          }

          if (inputElement.value && inputElement.value.length < 50 && inputElement.value.trim()) {
            return inputElement.value.trim();
          }
        }

        // Get direct text content for buttons, links, and summary elements
        if (["button", "a", "summary"].includes(tagName)) {
          var directText = "";
          for (var nodeIndex = 0; nodeIndex < element.childNodes.length; nodeIndex++) {
            var childNode = element.childNodes[nodeIndex];
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
          var headingText = element.textContent;
          if (headingText && headingText.trim()) {
            return headingText.trim().substring(0, 100);
          }
        }

        // Images without alt text return empty string
        if (tagName === "img") {
          return "";
        }

        // Fallback: collect direct text nodes
        var collectedText = "";
        for (var childIndex = 0; childIndex < element.childNodes.length; childIndex++) {
          var child = element.childNodes[childIndex];
          if (child.nodeType === Node.TEXT_NODE) {
            collectedText += child.textContent;
          }
        }

        if (collectedText && collectedText.trim() && collectedText.trim().length >= 3) {
          var trimmedText = collectedText.trim();
          return trimmedText.length > 100 ? trimmedText.substring(0, 100) + "..." : trimmedText;
        }

        return "";
      }

      /**
       * Checks if an element is visible
       * @param {Element} element - The DOM element
       * @returns {boolean} True if the element is visible
       */
      function isElementVisible(element) {
        var computedStyle = window.getComputedStyle(element);
        return (
          computedStyle.display !== "none" &&
          computedStyle.visibility !== "hidden" &&
          computedStyle.opacity !== "0" &&
          element.offsetWidth > 0 &&
          element.offsetHeight > 0
        );
      }

      /**
       * Checks if an element is interactive (clickable, focusable, etc.)
       * @param {Element} element - The DOM element
       * @returns {boolean} True if the element is interactive
       */
      function isInteractiveElement(element) {
        var tagName = element.tagName.toLowerCase();
        var interactiveTags = ["a", "button", "input", "select", "textarea", "details", "summary"];

        return (
          interactiveTags.includes(tagName) ||
          element.getAttribute("onclick") !== null ||
          element.getAttribute("tabindex") !== null ||
          element.getAttribute("role") === "button" ||
          element.getAttribute("role") === "link" ||
          element.getAttribute("contenteditable") === "true"
        );
      }

      /**
       * Checks if an element is a structural/landmark element
       * @param {Element} element - The DOM element
       * @returns {boolean} True if the element is a landmark
       */
      function isLandmarkElement(element) {
        var tagName = element.tagName.toLowerCase();
        var landmarkTags = [
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

        return landmarkTags.includes(tagName) || element.getAttribute("role") !== null;
      }

      /**
       * Determines if an element should be included in the accessibility tree
       * @param {Element} element - The DOM element
       * @param {Object} options - Filter options
       * @returns {boolean} True if the element should be included
       */
      function shouldIncludeElement(element, options) {
        var tagName = element.tagName.toLowerCase();

        // Skip non-content elements
        var excludedTags = ["script", "style", "meta", "link", "title", "noscript"];
        if (excludedTags.includes(tagName)) {
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
          var boundingRect = element.getBoundingClientRect();
          var isInViewport =
            boundingRect.top < window.innerHeight &&
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
        var role = getElementRole(element);
        return role !== null && role !== "generic" && role !== "image";
      }

      /**
       * Recursively builds the accessibility tree
       * @param {Element} element - The DOM element to process
       * @param {number} currentDepth - Current depth in the tree
       * @param {Object} options - Filter options
       */
      function buildTree(element, currentDepth, options) {
        // Stop if we've exceeded max depth
        if (currentDepth > depthLimit) {
          return;
        }

        // Skip if element is invalid
        if (!element || !element.tagName) {
          return;
        }

        var shouldInclude = shouldIncludeElement(element, options) || (options.refId !== null && currentDepth === 0);

        if (shouldInclude) {
          var role = getElementRole(element);
          var accessibleName = getAccessibleName(element);

          // Find existing ref or create new one
          var elementRef = null;
          for (var existingRef in window.__claudeElementMap) {
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
          var indentation = " ".repeat(currentDepth);
          var outputLine = indentation + role;

          // Add accessible name if present
          if (accessibleName) {
            var sanitizedName = accessibleName.replace(/\s+/g, " ").substring(0, 100);
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
            var selectOptions = element.options;
            for (var optionIndex = 0; optionIndex < selectOptions.length; optionIndex++) {
              var option = selectOptions[optionIndex];
              var optionIndent = " ".repeat(currentDepth + 1);
              var optionLine = optionIndent + "option";

              var optionText = option.textContent ? option.textContent.trim() : "";
              if (optionText) {
                var sanitizedOptionText = optionText.replace(/\s+/g, " ").substring(0, 100);
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
          for (var childIndex = 0; childIndex < element.children.length; childIndex++) {
            var nextDepth = shouldInclude ? currentDepth + 1 : currentDepth;
            buildTree(element.children[childIndex], nextDepth, options);
          }
        }
      }

      // Initialize output and options
      var outputLines = [];
      var depthLimit = maxDepth != null ? maxDepth : 15;
      var options = {
        filter: filterMode || "all",
        refId: refId,
      };

      // If a specific ref ID is provided, start from that element
      if (refId) {
        var elementWeakRef = window.__claudeElementMap[refId];

        if (!elementWeakRef) {
          return {
            error:
              "Element with ref_id '" +
              refId +
              "' not found. It may have been removed from the page. Use read_page without ref_id to get the current page state.",
            pageContent: "",
            viewport: {
              width: window.innerWidth,
              height: window.innerHeight,
            },
          };
        }

        var targetElement = elementWeakRef.deref();

        if (!targetElement) {
          return {
            error:
              "Element with ref_id '" +
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
      } else {
        // Start from document body
        if (document.body) {
          buildTree(document.body, 0, options);
        }
      }

      // Clean up stale references from the element map
      for (var refKey in window.__claudeElementMap) {
        if (!window.__claudeElementMap[refKey].deref()) {
          delete window.__claudeElementMap[refKey];
        }
      }

      // Build final output
      var pageContent = outputLines.join("\n");

      // Check if output exceeds character limit
      if (maxChars != null && pageContent.length > maxChars) {
        var errorMessage = "Output exceeds " + maxChars + " character limit (" + pageContent.length + " characters). ";

        if (refId) {
          errorMessage +=
            "The specified element has too much content. Try specifying a smaller depth parameter or focus on a more specific child element.";
        } else if (maxDepth !== undefined) {
          errorMessage +=
            "Try specifying an even smaller depth parameter or use ref_id to focus on a specific element.";
        } else {
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
    } catch (error) {
      throw new Error("Error generating accessibility tree: " + (error.message || "Unknown error"));
    }
  };
})();
