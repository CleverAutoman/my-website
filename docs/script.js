const accentButtons = document.querySelectorAll(".accent-dot");
const chaosToggle = document.getElementById("chaosToggle");
const jumpButtons = document.querySelectorAll(".floating-btn");
const clockEl = document.getElementById("projectClock");
const dateEl = document.getElementById("projectDate");
const sections = Array.from(document.querySelectorAll("main .section"));

accentButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const accent = button.dataset.accent;
    document.documentElement.style.setProperty("--accent", accent);
    accentButtons.forEach((b) => b.classList.toggle("active", b === button));
  });
});

chaosToggle?.addEventListener("change", () => {
  document.body.classList.toggle("chaos", chaosToggle.checked);
});

jumpButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.target;
    if (target === "#about") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const el = document.querySelector(target);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

function updateClock() {
  if (!clockEl || !dateEl) return;
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const dateStr = now.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
  clockEl.textContent = timeStr.toUpperCase();
  dateEl.textContent = dateStr;
}

updateClock();
setInterval(updateClock, 1000);

// Show only the active section; others stay hidden (opacity 0) but occupy layout
let activeIndex = 0;

function setActiveSection(idx) {
  sections.forEach((sec, i) => {
    if (i === idx) {
      sec.classList.remove("hidden-section");
      sec.classList.add("revealed");
    } else {
      sec.classList.add("hidden-section");
      sec.classList.remove("revealed");
    }
  });
  activeIndex = idx;
}

function detectActiveSection() {
  const probe = window.innerHeight * 0.45;
  let found = -1;
  for (let i = 0; i < sections.length; i += 1) {
    const rect = sections[i].getBoundingClientRect();
    if (rect.top <= probe && rect.bottom >= probe) {
      found = i;
      break;
    }
  }
  // If nothing matched and we're near page bottom, force last section
  const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 4;
  if (found === -1 && nearBottom) {
    found = sections.length - 1;
  }
  if (found === -1) found = activeIndex;
  if (found !== activeIndex) {
    setActiveSection(found);
  }
}

function initSections() {
  sections.forEach((sec) => sec.classList.add("hidden-section"));
  setActiveSection(0);
}

function onScroll() {
  window.requestAnimationFrame(detectActiveSection);
}

initSections();
window.addEventListener("scroll", onScroll, { passive: true });
window.addEventListener("resize", onScroll);

