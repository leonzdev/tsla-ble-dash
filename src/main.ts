import { initializeApp } from './app/ui';

document.addEventListener('DOMContentLoaded', () => {
  initializeApp(document.getElementById('app') ?? document.body);
  if ('serviceWorker' in navigator) {
    const swUrl = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker.register(swUrl).catch((err) => {
      console.warn('Service worker registration failed', err);
    });
  }
});
