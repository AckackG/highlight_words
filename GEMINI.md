```markdown
# GEMINI.MD

## Summary

This project is a Chrome browser extension called "Vocabulary Highlighter". Its main purpose is to help users learn English by automatically highlighting words and phrases from a predefined vocabulary list on any webpage they visit. The extension includes an options page for managing the vocabulary list, with functionality to import words from a "Saladict" JSON file.

## File Descriptions

### `manifest.json`

This is the core configuration file for the Chrome extension. It defines the extension's name, version, and description. It requests the `storage` permission to save the user's vocabulary list. It specifies `background.js` as the service worker, injects `content.js`, `highlight-colors.js`, and `styles.css` into all web pages (`<all_urls>`), and sets `options.html` as the settings page.

### `background.js`

This file is designated as the extension's service worker in the manifest. It is currently empty but would be used to handle background tasks, such as listening for extension lifecycle events.

### `content.js`

This is the main content script responsible for the highlighting logic on web pages.
- It retrieves the vocabulary list and the "border mode" setting from `chrome.storage.local`.
- It separates the vocabulary into sets of single words and multi-word phrases for efficient lookups.
- It uses a `TreeWalker` to efficiently traverse all text nodes in the document's body.
- It first processes and highlights phrases to ensure they take precedence over individual words they might contain.
- It then processes and highlights the remaining single words.
- It calls `createHighlightSpan` to create the styled `<span>` elements for highlighting.

### `highlight-colors.js`

This script handles the visual aspect of the highlighting.
- It programmatically generates a set of 30 distinct HSL colors to ensure variety.
- The `getWordHash` function creates a numeric hash from a word, which is then used to consistently assign a color to that specific word.
- The `getHighlightColor` function returns the style properties (background color, border color) for a given word.
- The `applyHighlightStyle` function applies the generated styles to a DOM element. It also checks for a "border mode" setting from `chrome.storage`, applying only border styles if it's enabled.

### `options.html`

This file provides the user interface for the extension's settings page.
- It features a title, a file input for uploading a "Saladict" `.json` vocabulary file, and a "Save" button.
- A checkbox allows the user to toggle "border mode," which changes the highlighting style to use only borders instead of background colors.
- A read-only `<textarea>` element displays the currently loaded vocabulary list.
- An information `div` shows the number of words and the last update time.

### `options.js`

This script contains the logic for the settings page (`options.html`).
- It loads and displays the saved vocabulary, border mode setting, and update information from `chrome.storage` when the page is opened.
- It adds an event listener to the "Save" button. When clicked, it reads the selected "Saladict" JSON file.
- The `parse_wordbook` function parses the JSON file, extracts the list of words, and handles potential errors.
- It saves the new word list and the state of the "border mode" checkbox to `chrome.storage`.
- It provides user feedback using a custom toast notification (`showToast`) to confirm that the vocabulary has been imported successfully.

### `styles.css`

This CSS file is injected into web pages along with the content scripts. It is currently empty but would be the place to define global styles for the highlighted words or any other UI elements the extension might add to the page.

### `readme.md`

This is the documentation file for the project. It explains the extension's features, and provides instructions on how to install and use it, including how to add, import, and export words via the options page.
```