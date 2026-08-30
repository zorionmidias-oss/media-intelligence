// public/js/theme.js

class ThemeManager {
  constructor() {
    this.storageKey = 'app-theme';
    this.rootAttr = 'data-theme';
    this.init();
  }

  init() {
    // 1. Check localStorage for saved theme
    const savedTheme = localStorage.getItem(this.storageKey);

    // 2. Fall back to system preference
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';

    // 3. Apply theme (saved > system > default light)
    this.currentTheme = savedTheme || systemTheme;
    this.applyTheme(this.currentTheme);

    // 4. Attach event listeners
    this.attachListeners();
  }

  applyTheme(theme) {
    // Update data-theme attribute on root
    document.documentElement.setAttribute(this.rootAttr, theme);

    // Save to localStorage
    localStorage.setItem(this.storageKey, theme);

    // Update current theme state
    this.currentTheme = theme;

    // Update meta theme-color for mobile statusbar
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', theme === 'dark' ? '#000000' : '#FFFFFF');
    }

    // Update toggle button state
    const toggle = document.getElementById('themeToggle');
    if (toggle) {
      toggle.dataset.current = theme;
      // Update icon visibility (CSS handles this, but update aria-label)
      const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
      toggle.setAttribute('aria-label', label);
    }
  }

  toggle() {
    const newTheme = this.currentTheme === 'light' ? 'dark' : 'light';
    this.applyTheme(newTheme);
  }

  attachListeners() {
    // Listen for toggle button clicks
    const toggle = document.getElementById('themeToggle');
    if (toggle) {
      toggle.addEventListener('click', () => this.toggle());
    }

    // Sync theme across browser tabs
    window.addEventListener('storage', (e) => {
      if (e.key === this.storageKey && e.newValue) {
        this.applyTheme(e.newValue);
      }
    });

    // Sync when system preference changes (e.g., user toggles OS dark mode)
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      const newTheme = e.matches ? 'dark' : 'light';
      // Only apply if no saved preference
      if (!localStorage.getItem(this.storageKey)) {
        this.applyTheme(newTheme);
      }
    });
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new ThemeManager();
});
