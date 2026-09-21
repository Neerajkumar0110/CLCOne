const createCRUDController = require('../middlewaresControllers/createCRUDController');
const { routesList } = require('../../models/utils');
const callingModelGuards = require('./operation/callingModelGuards');

// Requiring each controller by a literal path (rather than discovering
// directories with glob + a dynamic require) so bundlers that statically
// trace dependencies (e.g. Vercel's serverless build) include all of them.
const controllerModules = {
  aboutController: require('./core/aboutController'),
  callController: require('./operation/callController'),
  clientController: require('./sales/clientController'),
  dashboardController: require('./core/dashboardController'),
  facebookController: require('./marketing/facebookController'),
  gitConnectionController: require('./operation/gitConnectionController'),
  googleController: require('./marketing/googleController'),
  invoiceController: require('./finance/invoiceController'),
  leadController: require('./sales/leadController'),
  linkedinController: require('./marketing/linkedinController'),
  loginActivityController: require('./hrms/loginActivityController'),
  messageController: require('./operation/messageController'),
  notificationController: require('./operation/notificationController'),
  paymentController: require('./finance/paymentController'),
  performanceController: require('./sales/performanceController'),
  reportController: require('./core/reportController'),
  teamController: require('./core/teamController'),
  ticketController: require('./lms/ticketController'),
  vercelConnectionController: require('./operation/vercelConnectionController'),
  ...callingModelGuards,
};

const appControllers = () => {
  const controllers = {};
  const hasCustomControllers = [];

  Object.entries(controllerModules).forEach(([controllerName, customController]) => {
    if (customController) {
      hasCustomControllers.push(controllerName);
      controllers[controllerName] = customController;
    }
  });

  routesList.forEach(({ modelName, controllerName }) => {
    if (!hasCustomControllers.includes(controllerName)) {
      controllers[controllerName] = createCRUDController(modelName);
    }
  });

  return controllers;
};

module.exports = appControllers();
