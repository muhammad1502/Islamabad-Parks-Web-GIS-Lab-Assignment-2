// Runs before the stylesheet paints so a saved dark theme never flashes light first.
(function () {
  var root = document.documentElement;
  root.classList.add("js");
  try {
    var saved = localStorage.getItem("islamabad-parks-theme");
    if (saved === "light" || saved === "dark") root.dataset.theme = saved;
  } catch (e) {}
})();
