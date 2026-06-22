(function () {
  const NAV_ITEMS = [
    { id: 'dashboard', label: 'Dashboard', href: '/fantasy/dashboard.html' },
    { id: 'slate', label: 'Race Slate', href: '/fantasy/slate.html' },
    { id: 'history', label: 'Salary History', href: '/fantasy/history.html' },
    { id: 'lineup', label: 'Lineup Builder', href: '/fantasy/lineup.html' },
    { id: 'standings', label: 'Standings', href: '/fantasy/standings.html' },
    { id: 'rules', label: 'Rules', href: '/fantasy/rules.html' },
  ];

  function renderNav(root, activeId) {
    if (!root) return;
    root.innerHTML = `
      <nav class="fantasy-app-nav" aria-label="Fantasy app">
        ${NAV_ITEMS.map(
          (item) =>
            `<a class="fantasy-app-nav__link${item.id === activeId ? ' is-active' : ''}" href="${item.href}">${item.label}</a>`
        ).join('')}
      </nav>
    `;
  }

  window.BPFantasyAppNav = {
    init(activeId = '') {
      renderNav(document.getElementById('fantasyAppNav'), activeId);
    },
  };
})();
