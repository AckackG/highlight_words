// 预定义的颜色方案
const COLOR_SCHEMES = {
  // 浅色系，适合阅读
  basic: [
    { backgroundColor: "#FFE4E1", borderColor: "#FFB6C1" }, // 粉红
    { backgroundColor: "#E0FFFF", borderColor: "#87CEEB" }, // 天蓝
    { backgroundColor: "#F0FFF0", borderColor: "#98FB98" }, // 淡绿
    { backgroundColor: "#FFF0F5", borderColor: "#DDA0DD" }, // 淡紫
    { backgroundColor: "#FFFFF0", borderColor: "#F0E68C" }, // 淡黄
  ],
};

// 根据单词生成唯一的数字
function getWordHash(word) {
  let hash = 0;
  for (let i = 0; i < word.length; i++) {
    hash = (hash << 5) - hash + word.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

// 获取单词的高亮颜色
function getHighlightColor(word) {
  // 使用单词的hash值来选择颜色
  const hash = getWordHash(word.toLowerCase());
  const colorIndex = hash % COLOR_SCHEMES.basic.length;
  const colorScheme = COLOR_SCHEMES.basic[colorIndex];

  return {
    backgroundColor: colorScheme.backgroundColor,
    border: `1px solid ${colorScheme.borderColor}`,
    borderRadius: "2px",
    padding: "0 2px",
    margin: "0 1px",
    transition: "all 0.2s ease-in-out",
  };
}

// 应用高亮样式到元素
window.applyHighlightStyle = function (element, word) {
  const style = getHighlightColor(word);
  Object.assign(element.style, style);

  // 添加悬停效果
  element.addEventListener("mouseover", () => {
    element.style.filter = "brightness(95%)";
    element.style.cursor = "pointer";
  });

  element.addEventListener("mouseout", () => {
    element.style.filter = "brightness(100%)";
  });
};
