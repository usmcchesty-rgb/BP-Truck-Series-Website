(function () {
  const ENABLE_IRACING_LOOKUP_UI = false;

  const form = document.getElementById('joinApplicationForm');
  const errorEl = document.getElementById('joinFormError');
  const lookupStatusEl = document.getElementById('lookupStatus');
  const submitBtn = document.getElementById('joinSubmitBtn');
  const lookupBtn = document.getElementById('lookupDriverBtn');
  const formSection = document.getElementById('joinFormSection');
  const successSection = document.getElementById('joinSuccessSection');
  const successMessage = document.getElementById('joinSuccessMessage');
  const customerIdInput = document.getElementById('iracingCustomerId');
  const displayNameInput = document.getElementById('iracingDisplayName');
  const displayNameHelpEl = document.getElementById('iracingDisplayNameHelp');
  const lookupRowEl = document.querySelector('.join-lookup-row');
  const preferredNumberInput = document.getElementById('preferredNumber');
  const preferredNumberHelpEl = document.getElementById('preferredNumberHelp');

  if (!form) return;

  function configureLookupUi() {
    if (ENABLE_IRACING_LOOKUP_UI) {
      if (lookupBtn) lookupBtn.hidden = false;
      if (lookupStatusEl) lookupStatusEl.hidden = true;
      if (displayNameHelpEl) {
        displayNameHelpEl.textContent =
          'Enter your name exactly as it appears in iRacing, including any trailing number. This may be auto-filled after lookup.';
      }
      lookupRowEl?.classList.remove('join-lookup-row--manual');
      return;
    }

    if (lookupBtn) lookupBtn.hidden = true;
    if (lookupStatusEl) {
      lookupStatusEl.textContent = '';
      lookupStatusEl.hidden = true;
    }
    if (displayNameHelpEl) {
      displayNameHelpEl.textContent =
        'Enter your name exactly as it appears in iRacing, including any trailing number.';
    }
    lookupRowEl?.classList.add('join-lookup-row--manual');
  }

  function showError(message) {
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.hidden = !message;
  }

  function showLookupStatus(message, type = '') {
    if (!ENABLE_IRACING_LOOKUP_UI || !lookupStatusEl) return;
    lookupStatusEl.textContent = message;
    lookupStatusEl.hidden = !message;
    lookupStatusEl.classList.remove('join-form-message--success', 'join-form-message--warning');
    if (type) lookupStatusEl.classList.add(`join-form-message--${type}`);
  }

  function isValidEmail(value) {
    const email = String(value || '').trim();
    if (!email) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  const ANY_PREFERRED_NUMBER = 'ANY';

  function renderAnyOption() {
    return `<option value="${ANY_PREFERRED_NUMBER}">ANY</option>`;
  }

  function isAnyPreferredNumber(value) {
    return String(value || '').trim().toUpperCase() === ANY_PREFERRED_NUMBER;
  }

  function isNumericNumberEntry(entry) {
    const number = typeof entry === 'string' ? entry : entry?.number;
    return Boolean(number) && !isAnyPreferredNumber(number);
  }

  function readFormData() {
    return {
      driver_name: form.driver_name?.value?.trim() || '',
      iracing_display_name: form.iracing_display_name?.value?.trim() || '',
      iracing_customer_id: form.iracing_customer_id?.value?.trim() || '',
      discord_name: form.discord_name?.value?.trim() || '',
      email: form.email?.value?.trim() || '',
      age_confirmed: Boolean(form.age_confirmed?.checked),
      timezone: form.timezone?.value?.trim() || '',
      preferred_number: form.preferred_number?.value?.trim() || '',
      referred_by: form.referred_by?.value?.trim() || '',
      racing_background: form.racing_background?.value?.trim() || '',
      why_join: form.why_join?.value?.trim() || '',
    };
  }

  function validateClient(payload) {
    const errors = [];
    if (!payload.iracing_display_name) errors.push('iRacing Display Name is required.');
    if (!payload.iracing_customer_id) errors.push('iRacing Customer ID is required.');
    else if (!/^\d+$/.test(payload.iracing_customer_id)) {
      errors.push('iRacing Customer ID must contain numbers only.');
    }
    if (!payload.age_confirmed) errors.push('Age confirmation is required.');
    if (!payload.preferred_number) errors.push('Preferred number is required.');
    else if (
      !isAnyPreferredNumber(payload.preferred_number) &&
      !/^\d{1,2}$/.test(payload.preferred_number)
    ) {
      errors.push('Preferred number must be ANY, 00, or 1 through 99.');
    }
    if (!isValidEmail(payload.email)) errors.push('Please enter a valid email address.');
    return errors;
  }

  function renderAvailableNumbers(numberRows) {
    if (!preferredNumberInput) return;
    const rows = (Array.isArray(numberRows) ? numberRows : []).filter(isNumericNumberEntry);

    const statusLabel = {
      available: 'Available',
      pending: 'Pending',
      assigned: 'Unavailable',
      reserved: 'Reserved',
    };

    const options = rows.map((entry) => {
      const number = typeof entry === 'string' ? entry : entry?.number;
      const status = typeof entry === 'string' ? 'available' : String(entry?.status || 'available');
      const label = statusLabel[status] || status;
      const disabled = status !== 'available' ? ' disabled' : '';
      return `<option value="${number}"${disabled}>#${number} — ${label}</option>`;
    });

    const hasAvailable = rows.some((entry) => {
      const status = typeof entry === 'string' ? 'available' : String(entry?.status || 'available');
      return status === 'available';
    });

    preferredNumberInput.disabled = false;
    preferredNumberInput.innerHTML = [renderAnyOption(), ...options].join('');

    if (preferredNumberHelpEl) {
      if (!rows.length) {
        preferredNumberHelpEl.textContent =
          'Select ANY if you have no number preference, or contact league staff if no numbers are listed.';
      } else if (hasAvailable) {
        preferredNumberHelpEl.textContent =
          'Select ANY if you have no preference, or choose an available number. Pending numbers are held by other applicants under review. Number 0 is reserved for the pace car.';
      } else {
        preferredNumberHelpEl.textContent =
          'All specific numbers are currently pending, assigned, or reserved. Select ANY if you have no preference, or contact league staff.';
      }
    }
  }

  async function loadAvailableNumbers() {
    if (!preferredNumberInput) return;
    try {
      const res = await fetch('/api/drivers?action=availableNumbers');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Unable to load available numbers.');
      const rows = Array.isArray(data.numbers)
        ? data.numbers
        : (data.available || []).map((number) => ({ number, status: 'available' }));
      renderAvailableNumbers(rows);
    } catch (error) {
      preferredNumberInput.disabled = false;
      preferredNumberInput.innerHTML = renderAnyOption();
      if (preferredNumberHelpEl) {
        preferredNumberHelpEl.textContent =
          'Available numbers could not be loaded. You can still select ANY, or refresh and contact league staff.';
      }
    }
  }

  configureLookupUi();
  loadAvailableNumbers();

  customerIdInput?.addEventListener('input', () => {
    customerIdInput.value = customerIdInput.value.replace(/\D/g, '');
    if (ENABLE_IRACING_LOOKUP_UI) {
      showLookupStatus('');
    }
  });

  lookupBtn?.addEventListener('click', async () => {
    if (!ENABLE_IRACING_LOOKUP_UI) return;

    showError('');
    const customerId = customerIdInput?.value?.trim() || '';
    if (!customerId) {
      showLookupStatus('Enter your iRacing Customer ID before lookup.', 'warning');
      return;
    }
    if (!/^\d+$/.test(customerId)) {
      showLookupStatus('iRacing Customer ID must contain numbers only.', 'warning');
      return;
    }

    lookupBtn.disabled = true;
    lookupBtn.textContent = 'LOOKING UP...';
    showLookupStatus('Looking up driver from iRacing...', '');

    try {
      const res = await fetch(`/api/iracing/member/${encodeURIComponent(customerId)}`);
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.displayName) {
        if (displayNameInput) displayNameInput.value = data.displayName;
        showLookupStatus('Driver verified from iRacing.', 'success');
        return;
      }

      showLookupStatus(
        data.error ||
          'We could not verify this Customer ID. You may still submit, but staff will review it manually.',
        'warning'
      );
    } catch (error) {
      showLookupStatus(
        'We could not verify this Customer ID. You may still submit, but staff will review it manually.',
        'warning'
      );
    } finally {
      lookupBtn.disabled = false;
      lookupBtn.textContent = 'LOOKUP DRIVER';
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showError('');

    const payload = readFormData();
    const errors = validateClient(payload);
    if (errors.length) {
      showError(errors.join(' '));
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'SUBMITTING...';

    try {
      const res = await fetch('/api/driver-applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Unable to submit application. Please try again.');
      }

      formSection.hidden = true;
      successSection.hidden = false;
      if (data.message) successMessage.textContent = data.message;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      showError(error.message || 'Unable to submit application. Please try again.');
      submitBtn.disabled = false;
      submitBtn.textContent = 'SUBMIT APPLICATION';
    }
  });
})();
