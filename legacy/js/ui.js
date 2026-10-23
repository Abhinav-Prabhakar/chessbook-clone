export const logoMark = (cls = "") => `
<svg class="logo-mark ${cls}" viewBox="0 0 200 164.87" xmlns="http://www.w3.org/2000/svg" aria-label="Chessbook">
  <g fill="currentColor">
    <path d="m150 142.48-50 22.39v-60l50-22.39z" opacity=".25"/>
    <path d="m200 119.97-50 22.39v-60l50-22.39zm-50-37.42-50 22.38v-60l50-22.38z" opacity=".75"/>
    <path d="m200 60.03-50 22.39v-60l50-22.39z" opacity=".25"/>
    <path d="m50 142.45 50 22.39v-60l-50-22.39z"/>
    <path d="m0 119.94 50 22.38v-60l-50-22.38zm50-37.42 50 22.38v-60l-50-22.38z" opacity=".5"/>
    <path d="m0 60 50 22.39v-60l-50-22.39z"/>
  </g>
</svg>`;

export const icon = (name, cls = "") => `<i class="fa-solid fa-${name} ${cls}" aria-hidden="true"></i>`;

export function breadcrumb(items, opts = {}) {
  const parts = [logoMark()];
  items.forEach((item, i) => {
    parts.push(`<span class="sep">${icon("angle-right")}</span>`);
    const label = i === items.length - 1
      ? `<span class="crumb-current">${item}</span>`
      : `<button class="crumb-link" data-nav="${(opts.links && opts.links[i]) || ""}">${item}</button>`;
    parts.push(label);
  });
  return `<div class="board-breadcrumb">${parts.join("")}</div>`;
}

export function progress(pct, cls = "") {
  return `<div class="progress-track"><div class="progress-fill ${cls}" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>`;
}

export function segmentMeter(on, color = "green", total = 10) {
  return `<div class="seg-meter">${Array.from({ length: total }, (_, i) => `<i class="${i < on ? `on ${color}` : ""}"></i>`).join("")}</div>`;
}

export function moveRow(m, i, opts = {}) {
  const num = opts.number || "2.";
  const ev = m.eval || "0.0";
  const neg = ev.startsWith("-");
  const mark = m.mark ? `<span class="mark">${m.mark}</span>` : "";
  const best = m.best ? `<span class="best">♛</span>` : "";
  return `<button class="move-row" data-move="${m.san}">
    <div class="mv"><span class="num">${num}</span><span class="san">${m.san}</span>${best}${mark}</div>
    <div class="desc"><div class="opening">${m.name || ""}</div>${m.desc ? `<div class="blurb">${m.desc}</div>` : ""}</div>
    <div class="masters">${m.pct}%</div>
    <div class="eval ${neg ? "neg" : ""}">${ev}</div>
    <div class="peers"><span class="peer-chip light">${m.peers[0]}</span><span class="peer-chip dark">${m.peers[1]}</span></div>
  </button>`;
}

export function tableHead(cls = "") {
  return `<div class="table-head ${cls}"><span>Potential moves</span><span class="grow"></span><span class="col-masters">Masters</span><span class="col-eval">Eval</span><span class="col-peer">Peer results</span></div>`;
}

export function toast(title, sub = "", iconName = "crown") {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<span class="t-icon">${icon(iconName)}</span><div><div class="t-title">${title}</div>${sub ? `<div class="t-sub">${sub}</div>` : ""}</div>`;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity 200ms"; setTimeout(() => el.remove(), 220); }, 3200);
}

export function formatMoves(moves) {
  const out = [];
  for (let i = 0; i < moves.length; i += 2) {
    out.push(`<span class="num">${i / 2 + 1}.</span><span class="mv${i === moves.length - 1 ? " last" : ""}">${moves[i]}</span>`);
    if (moves[i + 1]) out.push(`<span class="mv${i + 1 === moves.length - 1 ? " last" : ""}">${moves[i + 1]}</span>`);
  }
  return out.join("");
}
