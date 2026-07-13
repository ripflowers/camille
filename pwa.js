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
  document.addEventListener("touchend", (event) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 320) {
      event.preventDefault();
    }
    lastTouchEnd = now;
  }, { passive: false });

  document.addEventListener("dblclick", (event) => {
    event.preventDefault();
  }, { passive: false });

  document.addEventListener("gesturestart", (event) => {
    event.preventDefault();
  }, { passive: false });
}
