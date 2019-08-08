import "normalize.css";

import "../css/fonts.scss";
import "../css/base.scss";
import "../css/layout.scss";
import "../css/responsive.scss";

const el = document.getElementById("feedback-list");
if (el) {
  const idx = Math.floor(Math.random() * (el.children.length - 1) + 1);
  el.children[1].style.display = "none";
  el.children[idx].style.display = "block";
}
