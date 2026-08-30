// public/js/components/dropdown.js

class DropdownManager {
  constructor() {
    this.dropdowns = document.querySelectorAll('[data-dropdown]');
    this.init();
  }

  init() {
    this.dropdowns.forEach(dropdown => {
      const trigger = dropdown.querySelector('[data-dropdown-trigger]');
      const menu = dropdown.querySelector('[data-dropdown-menu]');

      if (trigger && menu) {
        trigger.addEventListener('click', (e) => {
          e.stopPropagation();
          this.toggle(dropdown, menu);
        });
      }
    });

    // Close dropdowns on outside click
    document.addEventListener('click', () => {
      this.closeAll();
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeAll();
    });
  }

  toggle(dropdown, menu) {
    const isOpen = menu.classList.contains('open');
    this.closeAll();
    if (!isOpen) {
      menu.classList.add('open');
      dropdown.classList.add('open');
    }
  }

  closeAll() {
    this.dropdowns.forEach(dropdown => {
      const menu = dropdown.querySelector('[data-dropdown-menu]');
      if (menu) {
        menu.classList.remove('open');
        dropdown.classList.remove('open');
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new DropdownManager();
});
