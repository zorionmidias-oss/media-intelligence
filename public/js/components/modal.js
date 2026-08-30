// public/js/components/modal.js

class ModalManager {
  constructor() {
    this.modals = document.querySelectorAll('.modal');
    this.init();
  }

  init() {
    // Handle modal triggers (data-modal-trigger)
    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-modal-trigger]');
      if (trigger) {
        const modalId = trigger.dataset.modalTrigger;
        this.open(modalId);
      }
    });

    // Handle modal close buttons
    document.addEventListener('click', (e) => {
      const closeBtn = e.target.closest('[data-modal-close]');
      if (closeBtn) {
        const modal = closeBtn.closest('.modal');
        if (modal) this.close(modal);
      }
    });

    // Close on backdrop click
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-overlay')) {
        this.close(e.target.closest('.modal'));
      }
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const openModal = document.querySelector('.modal.open');
        if (openModal) this.close(openModal);
      }
    });
  }

  open(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
  }

  close(modal) {
    if (modal) {
      modal.classList.remove('open');
      document.body.style.overflow = '';
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new ModalManager();
});
