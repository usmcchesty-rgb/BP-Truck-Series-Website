(function () {
  const form = document.getElementById('joinApplicationForm');
  const errorEl = document.getElementById('joinFormError');
  const submitBtn = document.getElementById('joinSubmitBtn');
  const formSection = document.getElementById('joinFormSection');
  const successSection = document.getElementById('joinSuccessSection');
  const successMessage = document.getElementById('joinSuccessMessage');
  const customerIdInput = document.getElementById('iracingCustomerId');

  if (!form) return;

  function showError(message) {
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.hidden = !message;
  }

  function readFormData() {
    return {
      driver_name: form.driver_name?.value?.trim() || '',
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
    if (!payload.driver_name) errors.push('Driver name is required.');
    if (!payload.iracing_customer_id) errors.push('iRacing Customer ID is required.');
    else if (!/^\d+$/.test(payload.iracing_customer_id)) {
      errors.push('iRacing Customer ID must contain numbers only.');
    }
    if (!payload.age_confirmed) errors.push('Age confirmation is required.');
    return errors;
  }

  customerIdInput?.addEventListener('input', () => {
    customerIdInput.value = customerIdInput.value.replace(/\D/g, '');
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
