import './styles.css';

import { createDashboardPage } from './dashboard/page';
import { createBottomNav, PageName } from './navigation';
import { createDebugPage } from './debug/page';

export async function initializeApp(root: HTMLElement): Promise<void> {
  root.classList.add('tsla-app');
  root.textContent = '';

  const layout = document.createElement('div');
  layout.className = 'tsla-layout';
  root.append(layout);

  const pages = document.createElement('div');
  pages.className = 'tsla-pages';
  layout.append(pages);

  const dashboardSection = document.createElement('section');
  dashboardSection.className = 'tsla-page tsla-page--dashboard';
  const debugSection = document.createElement('section');
  debugSection.className = 'tsla-page tsla-page--debug';
  pages.append(dashboardSection, debugSection);

  const dashboardPage = createDashboardPage(dashboardSection);

  const debugPage = await createDebugPage(debugSection, {
    dashboard: {
      setSpeed: (value) => dashboardPage.setSpeed(value),
      setGear: (value) => dashboardPage.setGear(value),
      setLastUpdate: (text) => dashboardPage.setLastUpdate(text),
      setVin: (value) => dashboardPage.setVin(value),
      setKeyLoaded: (loaded) => dashboardPage.setKeyLoaded(loaded),
      setAutoRefresh: (active, interval) => dashboardPage.setAutoRefresh(active, interval),
    },
  });

  const navControls = createBottomNav(
    [
      { id: 'dashboard', label: 'Dashboard' },
      { id: 'debug', label: 'Debug Tools' },
    ],
    (page) => {
      setActivePage(page);
    },
  );
  layout.append(navControls.element);

  dashboardPage.onAutoRefreshToggle(() => {
    debugPage.toggleAutoRefreshFromDashboard();
  });

  let activePage: PageName = 'dashboard';
  function setActivePage(page: PageName): void {
    activePage = page;
    dashboardSection.classList.toggle('tsla-page--active', page === 'dashboard');
    debugSection.classList.toggle('tsla-page--active', page === 'debug');
    navControls.setActive(page);
  }

  setActivePage(activePage);
}
