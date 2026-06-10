# TODO - Standings schedule_id auto-detection

## Plan approval status
- Pending user approval.

## Steps
- [x] Inspect `api/schedule.js` parsing logic to extract latest completed schedule_id.
- [ ] Implement schedule_id auto-detection in `api/standings.js`.

- [ ] Add console logs: settings.scheduleId, detected latest completed scheduleId, final scheduleId.

- [ ] Keep existing standings field mappings unchanged.
- [ ] Add fallback to `settings.scheduleId` when detection fails.
- [ ] Run a quick local verification (fetch `/api/standings` and confirm points match expected schedule_id).



