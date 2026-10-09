// Shared by every "Person"/"Owner"/"Agent" filter backed by the sales
// org-chart tree (backend's orgTree shape: {id, name, role, children}[] —
// see services/access/salesHierarchy.js's buildOrgTree, consumed by
// performanceController/orgTree.js and analyticsController/shared.js's
// scopeFacets). Converts it to antd TreeSelect's {title, value, key,
// children} shape. `value` is the person's NAME, not their id — every
// agent-scoped query in this app (Call.calledBy, Payment.createdBy,
// Lead.assignedUserName, ?agent=) is already name-keyed, so this stays
// consistent instead of introducing a second identity scheme just for a picker.
export function orgTreeToTreeData(nodes, roleDisplay) {
  return (nodes || []).map((n) => ({
    title: roleDisplay && n.role ? `${n.name} — ${roleDisplay(n.role)}` : n.name,
    value: n.name,
    key: n.id,
    children: n.children && n.children.length ? orgTreeToTreeData(n.children, roleDisplay) : undefined,
  }));
}
