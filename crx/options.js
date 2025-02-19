function showToast(message) {
  const toastContainer = document.createElement("div");
  toastContainer.id = "myToastContainer";
  toastContainer.innerHTML = `<div id="myToast">${message}</div>`;
  document.body.appendChild(toastContainer);

  // 添加 CSS 样式 (也可以通过 link 引入外部 CSS)
  const style = document.createElement("style");
  style.textContent = `
    #myToastContainer {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1000; /* 确保在最上层 */
    }

    #myToast {
    background-color: green;
    color: white;
    text-align: center;
    border-radius: 5px;
    padding: 16px;
    font-size: 16px;
    }
`;
  document.head.appendChild(style);

  // 延时消失
  setTimeout(function () {
    toastContainer.remove();
  }, 3000); // 3秒后消失
}

document.addEventListener("DOMContentLoaded", () => {
  const textarea = document.getElementById("vocabularyText");
  const saveBtn = document.getElementById("saveBtn");
  const borderModeCheckbox = document.getElementById("borderMode");
  const saladictPath = document.getElementById("saladictInput");

  // 加载已保存的词表和边框模式
  chrome.storage.local.get(["vocabulary", "borderMode", "WordsFilePath"], function (result) {
    if (result.vocabulary) {
      textarea.value = result.vocabulary.join("\n");
    }
    borderModeCheckbox.checked = result.borderMode || false; // 默认关闭
    if (result.WordsFilePath) {
      saladictPath.value = result.WordsFilePath;
    }
  });

  // 保存 btn
  saveBtn.addEventListener("click", () => {
    // border mode
    const borderMode = borderModeCheckbox.checked;
    chrome.storage.local.set({ borderMode });

    // 保存 JSON 路径
    const WordsFilePath = saladictPath.value;
    chrome.storage.local.set({ WordsFilePath });

    if (WordsFilePath) {
      //load vocabulary now
      chrome.runtime.sendMessage(
        {
          action: "call_load_saladict",
        },
        function (response) {
          if (response && response.response) {
            chrome.storage.local.get(["vocabulary"], function (result) {
              if (result.vocabulary) {
                textarea.value = result.vocabulary.join("\n");
                showToast(`已导入 ${vocabulary.length} 个单词 `);
              }
            });
          } else {
            showToast("单词更新失败");
          }
        }
      );
    } else {
      showToast("请先设置沙拉查词JSON路径!!!");
    }
  });
});
