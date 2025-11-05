import { initializeApp } from './app/ui';

document.addEventListener('DOMContentLoaded', () => {
  initializeApp(document.getElementById('app') ?? document.body);
});
