/* Seven elapsed days after verified production completion. This planner never
   mutates source rows or payroll. The caller rechecks fresh evidence under lock
   before applying these PO-only patches. Old complete POs start at first sight. */
var CORE_AUTO_COMPLETE_MS = 7 * 24 * 60 * 60 * 1000;

function coreAutoCompletionTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return NaN;
  var ms = Date.parse(value);
  return isFinite(ms) && new Date(ms).toISOString() === value.replace(/(\d{2}:\d{2}:\d{2})Z$/, '$1.000Z') ? ms : NaN;
}
function coreAutoCompletionEligible(po, flow) {
  var provenance = coreParseJSON(po.imporSumber, {}), reconciliation = provenance.legacyReconciliation || {};
  if (po.status !== 'aktif' || po.imporReview || reconciliation.mode === 'review' || reconciliation.mode === 'archive') return false;
  if (!flow || flow.complete !== true || (flow.issues || []).length) return false;
  return !Object.keys(flow.ukuran || {}).some(function (size) { return (flow.ukuran[size].issues || []).length; });
}
/* Cheap same-version sync check; an unregistered PO is examined on full state,
   including the first authenticated load after deployment and production writes. */
function coreAutoCompletionDue(poRows, now) {
  var ms = now.getTime();
  return (poRows || []).some(function (po) {
    if (po.status !== 'aktif' || !po.tuntasPada) return false;
    var start = coreAutoCompletionTime(po.tuntasPada);
    return !isFinite(start) || start > ms || ms - start >= CORE_AUTO_COMPLETE_MS;
  });
}
function coreAutoCompletionPlan(poRows, workflowById, now) {
  var ms = now.getTime();
  if (!isFinite(ms)) throw new Error('Waktu server tidak sah untuk penutupan PO.');
  var iso = now.toISOString(), patches = [], next = Infinity;
  (poRows || []).forEach(function (po) {
    if (po.status !== 'aktif') return;
    if (!coreAutoCompletionEligible(po, (workflowById || {})[po.id])) {
      if (po.tuntasPada) patches.push({ id: po.id, changes: { tuntasPada: '' }, reason: 'incomplete' });
      return;
    }
    var start = coreAutoCompletionTime(po.tuntasPada);
    if (!isFinite(start) || start > ms) {
      patches.push({ id: po.id, changes: { tuntasPada: iso }, reason: 'started' });
      start = ms;
    } else if (ms - start >= CORE_AUTO_COMPLETE_MS) {
      patches.push({ id: po.id, changes: { status: 'selesai', selesaiPada: coreYmd(now), diubah: iso }, reason: 'completed' });
      return;
    }
    next = Math.min(next, start + CORE_AUTO_COMPLETE_MS);
  });
  return { patches: patches, nextDeadline: isFinite(next) ? new Date(next).toISOString() : '' };
}
