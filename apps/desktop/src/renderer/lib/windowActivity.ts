// Selections turn grey while the window is in the background, as on macOS: the body
// carries `window-inactive` while another window (or another app) has the focus, and
// styles.css draws every selection in its unfocused colors then.

export function installWindowActivity(doc: Document = document): () => void {
  const view = doc.defaultView;
  if (!view) {
    return () => undefined;
  }
  const update = () => {
    doc.body.classList.toggle("window-inactive", !doc.hasFocus());
  };
  update();
  view.addEventListener("focus", update);
  view.addEventListener("blur", update);
  return () => {
    view.removeEventListener("focus", update);
    view.removeEventListener("blur", update);
    doc.body.classList.remove("window-inactive");
  };
}
