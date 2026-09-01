const createCRUDController = require('../middlewaresControllers/createCRUDController');
const { routesList } = require('../../models/utils');
const callingModelGuards = require('./callingModelGuards');

// Requiring each controller by a literal path (rather than discovering
// directories with glob + a dynamic require) so bundlers that statically
// trace dependencies (e.g. Vercel's serverless build) include all of them.
const controllerModules = {
  aboutController: require('./aboutController'),
  callController: require('./callController'),
  clientController: require('./clientController'),
  dashboardController: require('./dashboardController'),
  facebookController: require('./facebookController'),
  gitConnectionController: require('./gitConnectionController'),
  googleController: require('./googleController'),
  invoiceController: require('./invoiceController'),
  leadController: require('./leadController'),
  linkedinController: require('./linkedinController'),
  loginActivityController: require('./loginActivityController'),
  messageController: require('./messageController'),
  notificationController: require('./notificationController'),
  paymentController: require('./paymentController'),
  performanceController: require('./performanceController'),
  reportController: require('./reportController'),
  teamController: require('./teamController'),
  ticketController: require('./ticketController'),
  vercelConnectionController: require('./vercelConnectionController'),
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
