const createCRUDController = require('@/controllers/middlewaresControllers/createCRUDController');
const methods = createCRUDController('Notification');

const mine = require('./mine');
const markRead = require('./markRead');
const markAllRead = require('./markAllRead');

// Same reasoning as messageController: the generic list/listAll/read/
// filter/search/summary/update/delete/create from createCRUDController have
// no per-recipient scoping and would let any authenticated caller read (or
// forge) anyone else's notifications. Block all of them — notifications are
// only ever created server-side via notify()/notifyUser() (backend/src/
// notify.js), never through this API.
const blocked = (req, res) =>
  res.status(403).json({
    success: false,
    result: null,
    message: 'Not available directly — use /notification/mine',
  });

methods.mine = mine;
methods.markRead = markRead;
methods.markAllRead = markAllRead;
methods.create = blocked;
methods.read = blocked;
methods.update = blocked;
methods.delete = blocked;
methods.list = blocked;
methods.listAll = blocked;
methods.filter = blocked;
methods.search = blocked;
methods.summary = blocked;

module.exports = methods;
