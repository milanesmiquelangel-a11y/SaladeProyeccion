(() => {
  // The reference photo is optional. Keep this guard even if an older cached HTML
  // document still contains the previous `required` attribute.
  const imageInput = document.querySelector('#imageInput');
  const form = document.querySelector('#videoForm');
  if (imageInput) {
    imageInput.removeAttribute('required');
    imageInput.required = false;
  }
  if (form && imageInput) {
    form.noValidate = false;
  }
})();
