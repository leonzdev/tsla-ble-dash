import './app/styles.css';
import { initializeApp } from './app/ui';

document.addEventListener('DOMContentLoaded', () => {
  void initializeApp(document.getElementById('app') ?? document.body);
  if ('serviceWorker' in navigator) {
    const swUrl = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker
      .register(swUrl)
      .then((registration) => {
        // Listen for updates and prompt user to reload
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateBanner(registration);
            }
          });
        });
      })
      .catch((err) => {
        console.warn('Service worker registration failed', err);
      });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload();
    });
  }
});

function showUpdateBanner(reg: ServiceWorkerRegistration) {
  const banner = document.createElement('div');
  banner.style.position = 'fixed';
  banner.style.left = '0';
  banner.style.right = '0';
  banner.style.bottom = '0';
  banner.style.zIndex = '9999';
  banner.style.background = '#1f2937';
  banner.style.color = '#fff';
  banner.style.padding = '10px 12px';
  banner.style.display = 'flex';
  banner.style.alignItems = 'center';
  banner.style.justifyContent = 'space-between';
  banner.style.font = '14px system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif';
  banner.textContent = 'Update available — reload to get the latest version.';

  const btn = document.createElement('button');
  btn.textContent = 'Reload';
  btn.style.marginLeft = '12px';
  btn.style.padding = '6px 10px';
  btn.style.background = '#10b981';
  btn.style.color = '#000';
  btn.style.border = 'none';
  btn.style.borderRadius = '4px';
  btn.style.cursor = 'pointer';
  btn.addEventListener('click', () => {
    const waiting = reg.waiting;
    if (waiting) {
      waiting.postMessage({ type: 'SKIP_WAITING' });
    }
  });

  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.alignItems = 'center';
  wrap.appendChild(document.createTextNode('Update available — reload to get the latest version.'));
  wrap.appendChild(btn);
  banner.textContent = '';
  banner.appendChild(wrap);
  document.body.appendChild(banner);
}
