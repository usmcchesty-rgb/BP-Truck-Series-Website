(function () {
  const { link: driverLink, escapeHtml } = window.BPFantasyDriverLinks || {
    link: (d, l) => escapeHtml(l ?? d?.driverName),
    escapeHtml: (v) => String(v ?? ''),
  };

  const Pills = window.BPFantasyPills || {};
  const Insights = window.BPFantasyInsights || {};
  const renderFantasyGradePill = (grade) =>
    Pills.renderFantasyGradePill ? Pills.renderFantasyGradePill(grade) : escapeHtml(grade || '—');

  function $(sel) {
    return document.querySelector(sel);
  }

  function formatMoney(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `$${n.toLocaleString('en-US')}`;
  }

  function section(title, body) {
    return `
      <section class="fantasy-preview-section">
        <h2 class="fantasy-preview-section__title">${escapeHtml(title)}</h2>
        <div class="fantasy-preview-section__body">${body}</div>
      </section>
    `;
  }

  function driverList(items, formatter) {
    if (!items?.length) return '<p class="muted">No drivers highlighted.</p>';
    return `<ul class="fantasy-preview-list">${items.map((item) => `<li>${formatter(item)}</li>`).join('')}</ul>`;
  }

  function buildPreviewArticle(data) {
    const slate = data.slate || {};
    const power = data.fantasyPowerRankings || [];
    const breakdown = data.weeklyBreakdown || {};
    const spotlights = data.spotlightCards || {};
    const ownership = [...(data.ownershipProjection || [])].sort(
      (a, b) => b.projectedOwnershipPct - a.projectedOwnershipPct
    );
    const movers = data.salaryMovers || data.cards || {};
    const drivers = data.drivers || [];

    const top5 = power.slice(0, 5);
    const bestValues = [...drivers]
      .filter((d) => d.valueScore != null)
      .sort((a, b) => Number(b.valueScore) - Number(a.valueScore))
      .slice(0, 5);
    const darkHorses = drivers.filter(
      (d) =>
        d.ownershipLabel === 'Dark Horse' ||
        d.ownershipLabel === 'Sleeper' ||
        (d.projectedOwnershipPct != null && d.projectedOwnershipPct <= 15)
    ).slice(0, 5);
    const avoid = (breakdown.driversToAvoid || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const coreLineup = (breakdown.thisWeeksCorePicks || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const prophetHtml = Insights.renderProphetSection
      ? Insights.renderProphetSection(Insights.buildProphetLines?.(drivers, slate) || [])
      : '';

    return `
      <article class="fantasy-preview-article">
        ${section(
          'BP Fantasy Race Slate Summary',
          `<p>BP Fantasy Race ${escapeHtml(slate.raceNumber ?? '—')} at ${escapeHtml(slate.track || 'TBD')} locks ${escapeHtml(slate.lockTime || 'TBD')}. Salary cap ${formatMoney(slate.salaryCap ?? 50000)} for ${escapeHtml(String(slate.lineupSize ?? 5))}-driver fantasy lineups. Fantasy projections only — not official race predictions.</p>`
        )}
        ${prophetHtml}
        ${section(
          'Top 5 BP Fantasy Picks',
          driverList(top5, (d) =>
            `${driverLink(d, d.driverName)} — ${formatMoney(d.salary)} · Fantasy Rank #${escapeHtml(d.rank)} · ${renderFantasyGradePill(d.valueGrade)}`
          )
        )}
        ${section(
          'Best Fantasy Values',
          driverList(bestValues, (d) =>
            `${driverLink(d, d.driverName)} — ${formatMoney(d.salary)} · ${renderFantasyGradePill(d.valueGrade)} (${Number(d.valueScore).toFixed(2)})`
          )
        )}
        ${section(
          'BP Fantasy Salary Movers',
          `<p><strong>Risers:</strong> ${(movers.biggestRisers || [])
            .slice(0, 3)
            .map((d) => `${escapeHtml(d.driverName)} (${escapeHtml(d.salaryChangeLabel || '—')})`)
            .join(', ') || '—'}</p>
           <p><strong>Fallers:</strong> ${(movers.biggestFallers || [])
             .slice(0, 3)
             .map((d) => `${escapeHtml(d.driverName)} (${escapeHtml(d.salaryChangeLabel || '—')})`)
             .join(', ') || '—'}</p>`
        )}
        ${section(
          'Fantasy Track History Edge',
          `<p>${escapeHtml(
            breakdown.trackHistoryEdge
              ? `BP Fantasy track note: ${breakdown.trackHistoryEdge}`
              : spotlights.trackSpecialist?.driverName
                ? `BP Fantasy track note: ${spotlights.trackSpecialist.driverName} — ${spotlights.trackSpecialist.statLine || 'proven track edge'}`
                : 'No clear fantasy track-history edge flagged on this slate.'
          )}</p>`
        )}
        ${section(
          'Fantasy Ownership Watch',
          driverList(ownership.slice(0, 5), (d) =>
            `${driverLink(d, d.driverName)} — ${d.projectedOwnershipPct}% ${escapeHtml(d.ownershipLabel || '')}`
          )
        )}
        ${section(
          'Fantasy Sleeper & Dark Horse Watch',
          driverList(darkHorses, (d) =>
            `${driverLink(d, d.driverName)} — ${formatMoney(d.salary)} · ${d.projectedOwnershipPct != null ? `${d.projectedOwnershipPct}% ${escapeHtml(d.ownershipLabel || '')}` : escapeHtml(d.ownershipLabel || '—')}`
          )
        )}
        ${section(
          'Fantasy Risk Profiles',
          avoid.length
            ? `<ul class="fantasy-preview-list">${avoid.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>`
            : `<p>${escapeHtml(breakdown.highRiskHighReward ? `Fantasy risk note: ${breakdown.highRiskHighReward}` : 'No high-risk fantasy profiles flagged.')}</p>`
        )}
        ${section(
          'Suggested BP Fantasy Core Lineup',
          coreLineup.length
            ? `<ul class="fantasy-preview-list">${coreLineup.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>`
            : '<p class="muted">Core fantasy picks unavailable.</p>'
        )}
        ${section(
          'BP Fantasy Final Takeaway',
          `<p>${escapeHtml(
            spotlights.bestValue?.driverName
              ? `BP Fantasy takeaway: ${spotlights.bestValue.driverName} leads the value board while ${ownership[0]?.driverName || 'the field'} projects as the top fantasy ownership play. Use the demo lineup builder to explore cap-efficient combinations before lock.`
              : 'BP Fantasy takeaway: Review the full slate, compare drivers side-by-side, and use the demo lineup builder before lock.'
          )}</p>`
        )}
      </article>
    `;
  }

  async function init() {
    const root = $('#fantasyPreviewRoot');
    if (!root) return;

    try {
      const res = await fetch('/api/settings?action=getFantasyPublicSlate');
      if (!res.ok) throw new Error('slate');
      const data = await res.json();
      const slate = data.slate || {};

      root.innerHTML = `
        <section class="fantasy-app-hero-panel fantasy-glass-panel">
          <div class="fantasy-hero-header-row">
            <div>
              <p class="fantasy-app-eyebrow">BP Fantasy Race Preview</p>
              <h1 class="fantasy-app-page-title">Race ${escapeHtml(slate.raceNumber ?? '—')} — ${escapeHtml(slate.track || 'TBD')}</h1>
            </div>
            <div id="fantasyPreviewShareHost"></div>
          </div>
          <p class="fantasy-app-readonly-note">Auto-generated BP Fantasy preview from the current slate. Fantasy projections only — not official race predictions.</p>
        </section>
        ${buildPreviewArticle(data)}
      `;

      const title = `BP Fantasy Race Preview — Race ${slate.raceNumber ?? '—'} — ${slate.track || 'TBD'}`;
      const text = `BP Fantasy Race Preview for Race ${slate.raceNumber ?? '—'} at ${slate.track || 'TBD'}. Fantasy pick outlooks and salary notes.`;
      if (window.BPShare?.initPageShare) {
        window.BPShare.initPageShare('#fantasyPreviewShareHost', {
          title,
          text,
          description: text,
          url: window.location.href,
          image: '/assets/fantasy/fantasy-logo.png',
          type: 'website',
        });
      }
    } catch {
      root.innerHTML = `<section class="fantasy-app-empty"><p>Fantasy preview coming soon.</p></section>`;
    }
  }

  window.BPFantasyPreviewApp = { init };
})();
