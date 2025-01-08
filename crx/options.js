document.addEventListener("DOMContentLoaded", () => {
  const textarea = document.getElementById("vocabularyText");
  const saveBtn = document.getElementById("saveBtn");
  const exportBtn = document.getElementById("exportBtn");
  const importBtn = document.getElementById("importBtn");
  const fileInput = document.getElementById("fileInput");
  const borderModeCheckbox = document.getElementById("borderMode");

  // 加载已保存的词表和边框模式
  chrome.storage.local.get(["vocabulary", "borderMode"], function (result) {
    if (result.vocabulary) {
      textarea.value = result.vocabulary.join("\n");
    }
    borderModeCheckbox.checked = result.borderMode || false; // 默认关闭
  });

  // 保存词表和边框模式
  saveBtn.addEventListener("click", () => {
    const words = textarea.value
      .split("\n")
      .map((word) => word.trim().toLowerCase())
      .filter((word) => word.length > 0);

    const borderMode = borderModeCheckbox.checked;

    chrome.storage.local.set({ vocabulary: words, borderMode: borderMode }, () => {
      alert("保存成功！");
    });
  });

  // 导出词表
  exportBtn.addEventListener("click", () => {
    const content = textarea.value;
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vocabulary.txt";
    a.click();
    URL.revokeObjectURL(url);
  });

  // 导入词表
  importBtn.addEventListener("click", () => {
    fileInput.click();
  });

  fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        textarea.value = e.target.result;
      };
      reader.readAsText(file);
    }
  });
});
