// --- UTILITY FUNCTIONS ---

/**
 * Parses a Saladict JSON file and extracts the words.
 * @param {string} jsonData The JSON data as a string.
 * @returns {string[]} An array of words.
 */
function parse_wordbook(jsonData) {
  try {
    const jsonObject = JSON.parse(jsonData);
    if (jsonObject && jsonObject.words && Array.isArray(jsonObject.words)) {
      return jsonObject.words.map((wordItem) => wordItem.text).filter(Boolean);
    } else {
      console.error("JSON data is not in the expected format.");
      return [];
    }
  } catch (error) {
    console.error("Error parsing JSON:", error);
    return [];
  }
}

/**
 * Shows a toast notification.
 * @param {string} message The message to display.
 */
function showToast(message) {
  const toast = document.getElementById("toast");
  if (toast) {
    toast.textContent = message;
    toast.className = "show";
    setTimeout(() => {
      toast.className = toast.className.replace("show", "");
    }, 3000);
  }
}

// --- CORE LOGIC ---

document.addEventListener("DOMContentLoaded", () => {
  // --- GET ELEMENTS ---
  const saladictInput = document.getElementById("saladictInput");
  const importSaladictBtn = document.getElementById("importSaladictBtn");
  const saladictVocabularyText = document.getElementById("saladictVocabularyText");
  const userVocabularyText = document.getElementById("userVocabularyText");
  const importAllBtn = document.getElementById("importAllBtn");
  const exportAllBtn = document.getElementById("exportAllBtn");
  const borderModeCheckbox = document.getElementById("borderMode");
  const updateinfoDiv = document.getElementById("updateinfo");
  const saveBtn = document.getElementById("saveBtn");

  // --- FUNCTIONS ---

  /**
   * Loads settings from chrome.storage and populates the UI.
   */
  function loadSettings() {
    chrome.storage.local.get(
      ["userVocabulary", "saladictVocabulary", "borderMode", "UpdateInfo"],
      (result) => {
        if (result.userVocabulary) {
          userVocabularyText.value = result.userVocabulary.join("\n");
        }
        if (result.saladictVocabulary) {
          saladictVocabularyText.value = result.saladictVocabulary.join("\n");
        }
        borderModeCheckbox.checked = result.borderMode || false;
        if (result.UpdateInfo) {
          updateinfoDiv.innerHTML = result.UpdateInfo;
        }
      }
    );
  }

  /**
   * Saves the current settings to chrome.storage.
   */
  function saveSettings() {
    const userWords = userVocabularyText.value.split("\n").filter(Boolean);
    const saladictWords = saladictVocabularyText.value.split("\n").filter(Boolean);

    // Merge and deduplicate
    const combinedWords = [...new Set([...userWords, ...saladictWords])];

    const borderMode = borderModeCheckbox.checked;
    const updateInfo = `${combinedWords.length} words, updated at ${new Date().toLocaleString()}`;

    chrome.storage.local.set(
      {
        vocabulary: combinedWords,
        userVocabulary: userWords,
        saladictVocabulary: saladictWords,
        borderMode: borderMode,
        UpdateInfo: updateInfo,
      },
      () => {
        updateinfoDiv.innerHTML = updateInfo;
        showToast("Settings saved!");
      }
    );
  }

  /**
   * Handles the import of a Saladict JSON file.
   */
  function importSaladict() {
    const file = saladictInput.files[0];
    if (!file) {
      showToast("Please select a Saladict JSON file.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const words = parse_wordbook(e.target.result);
      saladictVocabularyText.value = words.join("\n");
      showToast(`Imported ${words.length} words from Saladict.`);
      saveSettings(); // Auto-save after import
    };
    reader.readAsText(file);
  }

  /**
   * Handles the overall import of a vocabulary JSON file.
   */
  function importAll() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const importedWords = JSON.parse(e.target.result);
          if (!Array.isArray(importedWords)) {
            throw new Error("JSON is not an array.");
          }

          const userWords = userVocabularyText.value.split("\n").filter(Boolean);
          const mergedWords = [...new Set([...userWords, ...importedWords])];
          userVocabularyText.value = mergedWords.join("\n");

          showToast(
            `Imported ${importedWords.length} words, merged ${
              mergedWords.length - userWords.length
            } new words.`
          );
          saveSettings(); // Auto-save after import
        } catch (error) {
          showToast("Error importing file: " + error.message);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  /**
   * Handles the overall export of the vocabulary.
   */
  function exportAll() {
    chrome.storage.local.get("vocabulary", (result) => {
      if (result.vocabulary) {
        const blob = new Blob([JSON.stringify(result.vocabulary, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "vocabulary.json";
        a.click();
        URL.revokeObjectURL(url);
        showToast("Vocabulary exported.");
      } else {
        showToast("No vocabulary to export.");
      }
    });
  }

  // --- EVENT LISTENERS ---
  saveBtn.addEventListener("click", saveSettings);
  importSaladictBtn.addEventListener("click", importSaladict);
  importAllBtn.addEventListener("click", importAll);
  exportAllBtn.addEventListener("click", exportAll);

  // --- INITIALIZATION ---
  loadSettings();
});
