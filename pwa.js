const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
document.documentElement.classList.toggle("is-standalone", standalone);
document.documentElement.classList.toggle("is-browser", !standalone);

installZoomGuards();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // PWA still works as an installed web clip if service worker registration is unavailable.
    });
  });
}

window.addEventListener("orientationchange", () => {
  document.documentElement.classList.toggle("is-portrait", window.innerHeight > window.innerWidth);
});
document.documentElement.classList.toggle("is-portrait", window.innerHeight > window.innerWidth);

function installZoomGuards() {
  let lastTouchEnd = 0;
  let lastTapTarget = null;
  let touchStartX = 0;
  let touchStartY = 0;
  document.addEventListener("touchstart", (event) => {
    const touch = event.touches?.[0];
    if (!touch) return;
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
  }, { passive: true });

  document.addEventListener("touchend", (event) => {
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    const moved = Math.hypot(touch.clientX - touchStartX, touch.clientY - touchStartY);
    if (moved > 12) {
      lastTapTarget = null;
      lastTouchEnd = 0;
      return;
    }
    const now = Date.now();
    const tapTarget = event.target?.closest?.("button, a, input, select, textarea, [role='button']");
    if (isLearningInputTap(tapTarget)) {
      lastTapTarget = null;
      lastTouchEnd = now;
      return;
    }
    if (tapTarget && tapTarget === lastTapTarget && now - lastTouchEnd <= 320) {
      event.preventDefault();
    }
    lastTapTarget = tapTarget;
    lastTouchEnd = now;
  }, { passive: false });

  document.addEventListener("dblclick", (event) => {
    event.preventDefault();
  }, { passive: false });

  document.addEventListener("gesturestart", (event) => {
    event.preventDefault();
  }, { passive: false });
}

function isLearningInputTap(target) {
  if (!target?.matches) return false;
  return target.matches([
    "input",
    "textarea",
    "select",
    ".letter-card",
    ".letter-block",
    ".choice-blank",
    ".keyboard-blank",
    ".keyboard-action",
    ".practice-option",
    "[data-letter-block]",
    "[data-keyboard-word]",
    "[data-keyboard-action]",
    "[data-choice-blank]",
    "[data-choice-option]",
    "[data-practice-option]"
  ].join(", "));
}
