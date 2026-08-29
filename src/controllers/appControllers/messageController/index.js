const createCRUDController = require('@/controllers/middlewaresControllers/createCRUDController');
const methods = createCRUDController('Message');

const create = require('./create');
const uploadMessage = require('./uploadMessage');
const thread = require('./thread');
const conversations = require('./conversations');
const markAllRead = require('./markAllRead');

// Messages are private DMs — the generic list/listAll/read/filter/search/
// summary/update/delete from createCRUDController have no per-user scoping
// at all and would let any authenticated caller read anyone else's private
// messages. Block every one of them; only the hand-scoped endpoints below
// (which always filter by the authenticated req.admin) are safe to expose.
const blocked = (req, res) =>
  res.status(403).json({
    success: false,
    result: null,
    message: 'Not available directly — use /message/thread/:userId or /message/conversations',
  });

methods.create = create;
methods.uploadMessage = uploadMessage;
methods.thread = thread;
methods.conversations = conversations;
methods.markAllRead = markAllRead;
methods.read = blocked;
methods.update = blocked;
methods.delete = blocked;
methods.list = blocked;
methods.listAll = blocked;
methods.filter = blocked;
methods.search = blocked;
methods.summary = blocked;

module.exports = methods;
