export type PageName = 'dashboard' | 'debug';

interface BottomNavItem {
  id: PageName;
  label: string;
}

interface BottomNavControls {
  element: HTMLElement;
  setActive(id: PageName): void;
}

export function createBottomNav(
  items: BottomNavItem[],
  onSelect: (id: PageName) => void,
): BottomNavControls {
  const nav = document.createElement('nav');
  nav.className = 'tsla-nav';
  const buttons = new Map<PageName, HTMLButtonElement>();
  items.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tsla-nav__button';
    button.textContent = item.label;
    button.setAttribute('data-page', item.id);
    button.addEventListener('click', () => {
      onSelect(item.id);
    });
    nav.append(button);
    buttons.set(item.id, button);
  });
  return {
    element: nav,
    setActive(id: PageName) {
      buttons.forEach((button, page) => {
        const isActive = page === id;
        button.classList.toggle('tsla-nav__button--active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
    },
  } satisfies BottomNavControls;
}
