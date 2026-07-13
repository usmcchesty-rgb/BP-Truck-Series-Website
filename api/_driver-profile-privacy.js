export function stripPrivateDriverProfileFields(profile) {
  if (!profile || typeof profile !== 'object') return profile;
  const sanitized = { ...profile };
  delete sanitized.form_email;
  delete sanitized.formEmail;
  delete sanitized.form_submitted_at;
  delete sanitized.formSubmittedAt;
  delete sanitized.form_permission_granted;
  delete sanitized.formPermissionGranted;
  return sanitized;
}
