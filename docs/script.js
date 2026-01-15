const accentButtons = document.querySelectorAll(".accent-dot");
const chaosToggle = document.getElementById("chaosToggle");
const jumpTriggers = document.querySelectorAll("[data-target]");
const clockEl = document.getElementById("projectClock");
const dateEl = document.getElementById("projectDate");
const sections = Array.from(document.querySelectorAll("main .section"));
const floatingButtons = document.querySelectorAll(".floating-btn");
const coursesTrigger = document.querySelector(".courses-link");
const coursesModalOverlay = document.getElementById("coursesModalOverlay");
const coursesModalClose = document.getElementById("coursesModalClose");

// 映射 section id 到对应的按钮
const sectionToButtonMap = {
  "#about": floatingButtons[0],
  "#work": floatingButtons[1],
  "#projects": floatingButtons[2],
  "#blog": floatingButtons[3],
};

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

jumpTriggers.forEach((el) => {
  el.addEventListener("click", (event) => {
    const target = el.dataset.target;
    if (!target) return;
    // 阻止带 href 的链接默认跳转，统一用平滑滚动
    if (el.tagName === "A") {
      event.preventDefault();
    }
    if (target === "#about") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const sectionEl = document.querySelector(target);
    if (sectionEl) {
      sectionEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
});

// Courses modal
if (coursesTrigger && coursesModalOverlay && coursesModalClose) {
  const openCoursesModal = () => {
    coursesModalOverlay.classList.add("open");
    coursesModalOverlay.setAttribute("aria-hidden", "false");
  };

  const closeCoursesModal = () => {
    coursesModalOverlay.classList.remove("open");
    coursesModalOverlay.setAttribute("aria-hidden", "true");
  };

  coursesTrigger.addEventListener("click", (e) => {
    e.preventDefault();
    openCoursesModal();
  });

  coursesModalClose.addEventListener("click", () => {
    closeCoursesModal();
  });

  coursesModalOverlay.addEventListener("click", (e) => {
    if (e.target === coursesModalOverlay) {
      closeCoursesModal();
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && coursesModalOverlay.classList.contains("open")) {
      closeCoursesModal();
    }
  });
}

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
  
  // 更新按钮状态和指示器
  floatingButtons.forEach((btn) => btn.classList.remove("active"));
  const currentSection = sections[idx];
  if (currentSection) {
    const sectionId = `#${currentSection.id}`;
    const activeButton = sectionToButtonMap[sectionId];
    if (activeButton) {
      activeButton.classList.add("active");
    }
  }
}

function detectActiveSection() {
  const probe = window.innerHeight * 0.45;
  let found = -1;
  
  // 如果接近页面顶部，默认选中第一个 section (about)
  if (window.scrollY < 100) {
    found = 0;
  } else {
    for (let i = 0; i < sections.length; i += 1) {
      const rect = sections[i].getBoundingClientRect();
      if (rect.top <= probe && rect.bottom >= probe) {
        found = i;
        break;
      }
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

// Handle blog link clicks with highlight effect
const blogLinks = document.querySelectorAll(".blog-link");
blogLinks.forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    const targetId = link.getAttribute("href");
    const targetElement = document.querySelector(targetId);
    
    if (targetElement) {
      // Scroll to target
      targetElement.scrollIntoView({ behavior: "smooth", block: "start" });
      
      // Add highlight class
      targetElement.classList.add("highlight");
      
      // Remove highlight class after animation completes
      setTimeout(() => {
        targetElement.classList.remove("highlight");
      }, 2000);
    }
  });
});

