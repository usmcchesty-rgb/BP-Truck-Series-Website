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

  window.BPFantasyDriverLinks = {
    url: driverUrl,
    link: driverLink,
    escapeHtml,
  };
})();
