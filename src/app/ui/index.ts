import { StateCategory } from '../../lib/protocol';
import { createDashboardPage } from './dashboard';
import { createDebugPage, DebugPageController } from './debug';

export async function initializeApp(root: HTMLElement): Promise<void> {
  root.classList.add('tsla-app');

  const shell = document.createElement('div');
  shell.className = 'tsla-shell';
  const content = document.createElement('div');
  content.className = 'tsla-content';
  const nav = document.createElement('nav');
  nav.className = 'tsla-nav';
  shell.append(content, nav);
  root.append(shell);

  let debugController: DebugPageController;
  const dashboardController = createDashboardPage({
    onAutoRefreshToggle: () => {
      debugController.handleAutoRefreshToggleRequest();
    },
  });

  debugController = createDebugPage({
    onVinChange: (vin) => {
      dashboardController.setVin(vin);
    },
    onKeyStatusChange: (hasKey) => {
      dashboardController.setKeyLoaded(hasKey);
    },
    onVehicleState: (category, result) => {
      if (category === StateCategory.Drive) {
        dashboardController.updateDriveState(result);
      }
    },
    onAutoRefreshStateChange: (active) => {
      dashboardController.setAutoRefreshState(active);
    },
  });

  const navButtons = new Map<string, HTMLButtonElement>();
  const controllers = [dashboardController, debugController];

  controllers.forEach((controller) => {
    content.append(controller.element);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tsla-nav__button';
    button.textContent = controller.label;
    button.addEventListener('click', () => setActivePage(controller.key));
    nav.append(button);
    navButtons.set(controller.key, button);
  });

  function setActivePage(target: string) {
    controllers.forEach(({ key, element }) => {
      const isActive = key === target;
      element.classList.toggle('is-active', isActive);
      const button = navButtons.get(key);
      if (button) {
        button.classList.toggle('is-active', isActive);
      }
    });
  }

  setActivePage(dashboardController.key);
  dashboardController.setVin(null);
  dashboardController.setKeyLoaded(false);
  dashboardController.updateDriveState(null);
  dashboardController.setAutoRefreshState(false);

  await debugController.initialize();
}
