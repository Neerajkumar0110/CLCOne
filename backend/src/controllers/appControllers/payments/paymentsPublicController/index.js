const status = require('./status');
const returnHandler = require('./return');
const upload = require('./upload');
const submitKyc = require('./submitKyc');
const webhookHandler = require('./webhook');
const finance = require('./finance');

module.exports = { status, returnHandler, upload, submitKyc, webhookHandler, ...finance };
