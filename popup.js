document.addEventListener('DOMContentLoaded', () => {
  const wordInput = document.getElementById('wordInput');
  const addWordButton = document.getElementById('addWordButton');
  const messageDiv = document.getElementById('message');

  addWordButton.addEventListener('click', async () => {
    const newWord = wordInput.value.trim();
    if (!newWord) {
      showMessage('Please enter a word.', 'red');
      return;
    }

    try {
      const result = await chrome.storage.local.get(['userVocabulary', 'saladictVocabulary', 'UpdateInfo']);
      let userVocabulary = result.userVocabulary || [];
      const saladictVocabulary = result.saladictVocabulary || [];

      if (userVocabulary.includes(newWord) || saladictVocabulary.includes(newWord)) {
        showMessage(`'${newWord}' is already in your vocabulary.`, 'orange');
        wordInput.value = '';
        return;
      }

      userVocabulary.push(newWord);
      userVocabulary = [...new Set(userVocabulary)]; // Deduplicate user vocabulary

      // Merge and deduplicate all words
      const combinedWords = [...new Set([...userVocabulary, ...saladictVocabulary])];

      const updateInfo = `${combinedWords.length} words, updated at ${new Date().toLocaleString()}`;

      await chrome.storage.local.set({
        userVocabulary: userVocabulary,
        vocabulary: combinedWords,
        UpdateInfo: updateInfo,
      });

      showMessage(`'${newWord}' added successfully!`, 'green');
      wordInput.value = ''; // Clear input after adding
    } catch (error) {
      console.error('Error adding word:', error);
      showMessage('Error adding word.', 'red');
    }
  });

  function showMessage(msg, color) {
    messageDiv.textContent = msg;
    messageDiv.style.color = color;
    setTimeout(() => {
      messageDiv.textContent = '';
    }, 3000);
  }
});