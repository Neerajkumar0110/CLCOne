const createCRUDController = require('@/controllers/middlewaresControllers/createCRUDController');
const methods = createCRUDController('LoginActivity');

const summary = require('./summary');
const detail = require('./detail');

// Overrides the generic (and unrelated — a plain document-count) /summary
// with the real paginated "every admin's login stats for a day" endpoint
// Shift Management actually uses; the auto-wired route already points at
// controller.summary, so no extra route wiring needed for this one.
methods.summary = summary;
methods.detail = detail;

module.exports = methods;
