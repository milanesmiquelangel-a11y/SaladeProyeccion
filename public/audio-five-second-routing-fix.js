// Route 5-second generations through the main video handler.
// Longer generations keep using the continuity sequence handler.
(() => {
  const form = document.querySelector('#videoForm');
  const durationInput = document.querySelector('#duration');
  if (!form || !durationInput) return;

  form.addEventListener('submit', (event) => {
    if (Number(durationInput.value) <= 5) {
      // photo-optional-fix.js must not intercept the 5-second path.
      // app.js + audio-request-fix.js handle /api/video/generate and narration.
      event.stopImmediatePropagation();
    }
  }, true);
})();
