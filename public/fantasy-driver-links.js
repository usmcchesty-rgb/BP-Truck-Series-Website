(function () {
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function driverUrl(driver) {
    if (!driver) return '#';
    const id = driver.driverId ?? driver.id;
    if (id != null && String(id).trim()) {
      return `/fantasy/driver.html?id=${encodeURIComponent(String(id))}`;
    }
    const name = driver.driverName ?? driver.name;
    if (name) {
      return `/fantasy/driver.html?driver=${encodeURIComponent(String(name))}`;
    }
    return '#';
  }

  function driverLink(driver, label) {
    const text = label ?? driver?.driverName ?? 'Driver';
    const href = driverUrl(driver);
    return `<a class="fantasy-driver-link" href="${href}">${escapeHtml(text)}</a>`;
  }

  function compareUrl(driver1, driver2) {
    const params = new URLSearchParams();
    const n1 = driver1?.driverName ?? driver1?.name ?? driver1;
    const n2 = driver2?.driverName ?? driver2?.name ?? driver2;
    if (n1) params.set('driver1', String(n1));
    if (n2) params.set('driver2', String(n2));
    const qs = params.toString();
    return qs ? `/fantasy/compare.html?${qs}` : '/fantasy/compare.html';
  }

  window.BPFantasyDriverLinks = {
    url: driverUrl,
    link: driverLink,
    compareUrl,
    escapeHtml,
  };
})();
