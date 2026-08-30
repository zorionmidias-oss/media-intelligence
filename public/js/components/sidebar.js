// public/js/components/sidebar.js

class SidebarManager {
  constructor() {
    this.sidebar = document.querySelector('.sidebar');
    this.toggleBtn = document.querySelector('[data-sidebar-toggle]');
    this.navButtons = document.querySelectorAll('.nav-btn');
    this.init();
  }

  init() {
    if (this.toggleBtn) {
      this.toggleBtn.addEventListener('click', () => this.toggle());
    }

    // Set active state based on current page
    this.setActiveNav();

    // Close sidebar on nav item click (mobile)
    this.navButtons.forEach(btn => {
      btn.addEventListener('click', () => this.setActive(btn));
    });
  }

  toggle() {
    this.sidebar.classList.toggle('collapsed');
    localStorage.setItem('sidebar-collapsed', this.sidebar.classList.contains('collapsed'));
  }

  setActive(element) {
    this.navButtons.forEach(btn => btn.classList.remove('on'));
    element.classList.add('on');
  }

  setActiveNav() {
    const currentPath = window.location.pathname;
    const activeBtn = Array.from(this.navButtons).find(btn => {
      const href = btn.getAttribute('href') || btn.dataset.href;
      return href === currentPath;
    });
    if (activeBtn) this.setActive(activeBtn);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new SidebarManager();
});
