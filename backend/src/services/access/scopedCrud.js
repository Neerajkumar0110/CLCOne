// Identity-aware counterparts of createCRUDController's generic list/
// listAll/filter/search/summary/read — same behavior, same response shape,
// just with an extra `scopeFilter` Mongo condition ANDed into every query.
// `scopeFilter` is `{}` for a full-access caller (see services/access/
// salesScope.js) or a real restricting condition otherwise. Kept separate
// from createCRUDController (rather than editing it directly) because that
// module is shared by every feature-section in the whole CRM — scoping it
// unconditionally would affect modules that were never asked for this
// (Marketing, HRMS, Support/Ticket, etc.).

async function scopedPaginatedList(Model, req, res, scopeFilter) {
  const page = req.query.page || 1;
  const limit = parseInt(req.query.items) || 10;
  const skip = page * limit - limit;

  const { sortBy = 'enabled', sortValue = -1, filter, equal } = req.query;
  const sortDirection = Number(sortValue) === 1 ? 1 : -1;

  const fieldsArray = req.query.fields ? req.query.fields.split(',') : [];
  const fields = fieldsArray.length === 0 ? {} : { $or: [] };
  for (const field of fieldsArray) {
    fields.$or.push({ [field]: { $regex: new RegExp(req.query.q, 'i') } });
  }

  let filterCondition = {};
  if (filter && equal !== undefined) {
    if (typeof equal === 'object') {
      return res.status(400).json({ success: false, result: [], message: 'Invalid filter value' });
    }
    filterCondition = { [filter]: equal };
  }

  const query = { removed: false, ...filterCondition, ...fields, ...scopeFilter };

  const [result, count] = await Promise.all([
    Model.find(query).skip(skip).limit(limit).sort({ [sortBy]: sortDirection }).populate().exec(),
    Model.countDocuments(query),
  ]);

  const pages = Math.ceil(count / limit);
  const pagination = { page, pages, count };
  if (count > 0) {
    return res.status(200).json({ success: true, result, pagination, message: 'Successfully found all documents' });
  }
  return res.status(203).json({ success: true, result: [], pagination, message: 'Collection is Empty' });
}

async function scopedListAll(Model, req, res, scopeFilter) {
  const sort = req.query.sort || 'desc';
  const enabled = req.query.enabled || undefined;
  const query = { removed: false, ...(enabled === undefined ? {} : { enabled }), ...scopeFilter };

  const result = await Model.find(query).sort({ created: sort }).populate().exec();
  if (result.length > 0) {
    return res.status(200).json({ success: true, result, message: 'Successfully found all documents' });
  }
  return res.status(203).json({ success: false, result: [], message: 'Collection is Empty' });
}

async function scopedFilter(Model, req, res, scopeFilter) {
  if (req.query.filter === undefined || req.query.equal === undefined) {
    return res.status(403).json({ success: false, result: null, message: 'filter not provided correctly' });
  }
  const result = await Model.find({ removed: false, ...scopeFilter, [req.query.filter]: req.query.equal }).exec();
  if (!result) {
    return res.status(404).json({ success: false, result: null, message: 'No document found ' });
  }
  return res.status(200).json({ success: true, result, message: 'Successfully found all documents  ' });
}

async function scopedSearch(Model, req, res, scopeFilter) {
  const fieldsArray = req.query.fields ? req.query.fields.split(',') : ['name'];
  const fields = { $or: [] };
  for (const field of fieldsArray) {
    fields.$or.push({ [field]: { $regex: new RegExp(req.query.q, 'i') } });
  }

  const results = await Model.find({ removed: false, ...scopeFilter, ...fields })
    .limit(20)
    .exec();

  if (results.length >= 1) {
    return res.status(200).json({ success: true, result: results, message: 'Successfully found all documents' });
  }
  return res.status(202).json({ success: false, result: [], message: 'No document found by this request' });
}

async function scopedSummary(Model, req, res, scopeFilter) {
  const countAllDocs = await Model.countDocuments({ removed: false, ...scopeFilter });
  const countFilter = await Model.countDocuments({ removed: false, ...scopeFilter })
    .where(req.query.filter)
    .equals(req.query.equal);
  return res.status(200).json({ success: true, result: { countFilter, countAllDocs }, message: 'Successfully count all documents' });
}

// Single-record read, scoped — so a frontline caller can't fetch another
// team's record directly by id even knowing/guessing it.
async function scopedRead(Model, req, res, scopeFilter) {
  const result = await Model.findOne({ _id: req.params.id, removed: false, ...scopeFilter }).exec();
  if (!result) {
    return res.status(404).json({ success: false, result: null, message: 'No document found ' });
  }
  return res.status(200).json({ success: true, result, message: 'we found this document ' });
}

module.exports = { scopedPaginatedList, scopedListAll, scopedFilter, scopedSearch, scopedSummary, scopedRead };
