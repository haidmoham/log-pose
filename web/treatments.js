(() => {
  const choices = [...document.querySelectorAll("[data-treatment]")];
  const status = document.querySelector(".treatment-state");
  const reset = document.querySelector(".treatment-reset");
  const defaultTreatment = "night";
  const labels = new Map(
    choices.map((button) => [
      button.dataset.treatment,
      button.textContent.trim().replace(/^\d+\s*/, ""),
    ]),
  );

  function applyTreatment(name) {
    const selected = labels.has(name) ? name : defaultTreatment;
    document.documentElement.dataset.treatment = selected;
    document.body.classList.remove(
      "treatment-paper",
      "treatment-ledger",
      "treatment-night",
      "treatment-folio",
    );
    document.body.classList.add("treatment-" + selected);
    choices.forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.treatment === selected),
      ),
    );
    status.textContent = "Current treatment: " + labels.get(selected);
    try {
      localStorage.setItem("log-pose-treatment", selected);
    } catch (error) {
      /* Storage can be unavailable in private browsing. */
    }
  }

  let initial = defaultTreatment;
  try {
    initial = localStorage.getItem("log-pose-treatment") || defaultTreatment;
  } catch (error) {
    /* Use the default when storage is unavailable. */
  }
  choices.forEach((button) =>
    button.addEventListener("click", () =>
      applyTreatment(button.dataset.treatment),
    ),
  );
  reset.addEventListener("click", () => applyTreatment(defaultTreatment));
  applyTreatment(initial);
})();
