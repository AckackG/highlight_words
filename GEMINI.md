# GEMINI.MD

## Summary

This project is a Chrome browser extension called "Vocabulary Highlighter". Its main purpose is to help users learn English by automatically highlighting words and phrases from a predefined vocabulary list on any webpage they visit. The extension includes an options page for managing the vocabulary list, with functionality to import words from a "Saladict" JSON file, manage a user-defined list, and export the combined vocabulary. It also features a popup for quickly adding new words.

## File Descriptions

### `manifest.json`

This is the core configuration file for the Chrome extension. It defines the extension's name, version, and description. It requests the `storage` permission to save the user's vocabulary list. It specifies `background.js` as the service worker, injects `content.js`, `highlight-colors.js`, and `styles.css` into all web pages (`<all_urls>`), sets `options.html` as the settings page, and `popup.html` as the action popup.

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
- It features a title and a two-column layout for managing different aspects of the vocabulary.
- **Left Column**: Contains sections for importing from a "Saladict" `.json` file and for manually editing a user-defined word list.
- **Right Column**: Provides buttons for importing and exporting the entire vocabulary, a checkbox to toggle "border mode" (which uses borders instead of background colors for highlighting), and an information `div` showing the word count and last update time.
- A "Save" button persists all changes.

### `options.js`

This script contains the logic for the settings page (`options.html`).
- It loads and displays the saved vocabulary (both Saladict-imported and user-defined), border mode setting, and update information from `chrome.storage` when the page is opened.
- It handles importing words from a "Saladict" JSON file and a general vocabulary JSON file.
- It allows for the exporting of the combined vocabulary into a single JSON file.
- The "Save" button merges the Saladict and user vocabularies, removes duplicates, and saves the combined list, user list, Saladict list, border mode setting, and update info to `chrome.storage`.
- It provides user feedback using a custom toast notification (`showToast`).

### `popup.html`

This is the HTML file for the extension's popup, which appears when the extension icon is clicked. It contains a simple form with a text input for a new word and an "Add Word" button.

### `popup.js`

This script manages the functionality of `popup.html`.
- It listens for a click on the "Add Word" button.
- It retrieves the new word from the input field, trims it, and checks if it's empty or already exists in the user's or Saladict's vocabulary.
- If the word is new, it adds it to the `userVocabulary`, updates the combined `vocabulary` and the `UpdateInfo` in `chrome.storage`.
- It provides feedback to the user directly within the popup.

### `styles.css`

This CSS file is injected into web pages along with the content scripts. It is currently empty but would be the place to define global styles for the highlighted words or any other UI elements the extension might add to the page.

### `readme.md`

This is the documentation file for the project. It explains the extension's features, and provides instructions on how to install and use it, including how to add, import, and export words via the options page.
