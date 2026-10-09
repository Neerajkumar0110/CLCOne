// Shared by every "Person"/"Owner"/"Agent" filter backed by the sales
// org-chart tree (backend's orgTree shape: {id, name, role, children}[] —
// see services/access/salesHierarchy.js's buildOrgTree, consumed by
// performanceController/orgTree.js and analyticsController/shared.js's
// scopeFacets). Flattens it to one level for a plain searchable Select —
// no expand/collapse, no indentation, just every person in one flat,
// filterable dropdown (deliberately not a nested tree widget). `value` is
// the person's NAME, not their id — every agent-scoped query in this app
// (Call.calledBy, Payment.createdBy, Lead.assignedUserName, ?agent=) is
// already name-keyed, so this stays consistent instead of introducing a
// second identity scheme just for a picker. The "view as" expansion (self +
// everyone reporting up to them — see namesInSubtree below / backend's
// namesForAgent) still happens once a name is picked; only the PICKER
// itself is flat, not the resulting data scope.
export function flattenOrgTree(nodes, roleDisplay) {
  const out = [];
  function walk(list) {
    for (const n of list || []) {
      out.push({
        label: roleDisplay && n.role ? `${n.name} — ${roleDisplay(n.role)}` : n.name,
        value: n.name,
      });
      walk(n.children);
    }
  }
  walk(nodes);
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

// "View as <rootName>" for pages that filter an already-fetched flat agent
// list client-side (frontend/src/pages/Reports/index.jsx's Advanced
// Reporting tabs) instead of re-querying the backend per selection —
// returns rootName + every name in their reporting chain beneath them, so
// picking a Team Leader shows their whole team, not just their own row. A
// leaf (no reports) naturally resolves to just [rootName].
export function namesInSubtree(nodes, rootName) {
  function collect(node, out) {
    out.push(node.name);
    (node.children || []).forEach((c) => collect(c, out));
  }
  function find(list) {
    for (const n of list || []) {
      if (n.name === rootName) return n;
      const hit = find(n.children);
      if (hit) return hit;
    }
    return null;
  }
  const root = find(nodes);
  if (!root) return rootName ? [rootName] : [];
  const out = [];
  collect(root, out);
  return out;
}
