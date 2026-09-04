const express = require('express');
const { catchErrors } = require('../../handlers/errorHandlers');
const router = express.Router();

const appControllers = require('../../controllers/appControllers');
const { routesList } = require('../../models/utils');
const { singleStorageUpload } = require('../../middlewares/uploadMiddleware');

const routerApp = (entity, controller) => {
  router.route(`/${entity}/create`).post(catchErrors(controller['create']));
  router.route(`/${entity}/read/:id`).get(catchErrors(controller['read']));
  router.route(`/${entity}/update/:id`).patch(catchErrors(controller['update']));
  router.route(`/${entity}/delete/:id`).delete(catchErrors(controller['delete']));
  router.route(`/${entity}/search`).get(catchErrors(controller['search']));
  router.route(`/${entity}/list`).get(catchErrors(controller['list']));
  router.route(`/${entity}/listAll`).get(catchErrors(controller['listAll']));
  router.route(`/${entity}/filter`).get(catchErrors(controller['filter']));
  router.route(`/${entity}/summary`).get(catchErrors(controller['summary']));

  if (entity === 'invoice' || entity === 'quote' || entity === 'payment') {
    router.route(`/${entity}/mail`).post(catchErrors(controller['mail']));
  }

  if (entity === 'quote') {
    router.route(`/${entity}/convert/:id`).get(catchErrors(controller['convert']));
  }

  if (entity === 'lead') {
    router
      .route(`/${entity}/import`)
      .post(
        singleStorageUpload({ entity: 'lead', fieldName: 'file', fileType: 'default' }),
        catchErrors(controller['import'])
      );
    router.route(`/${entity}/export`).get(catchErrors(controller['export']));
    router.route(`/${entity}/team-stats`).get(catchErrors(controller['teamStats']));
    router.route(`/${entity}/stage-stats`).get(catchErrors(controller['stageStats']));
    router.route(`/${entity}/by-stage`).get(catchErrors(controller['byStage']));
    router.route(`/${entity}/callbacks`).get(catchErrors(controller['callbacks']));
  }

  if (entity === 'team') {
    router.route(`/${entity}/mine`).get(catchErrors(controller['mine']));
  }

  if (entity === 'call') {
    router.route(`/${entity}/agent-stats`).get(catchErrors(controller['agentStats']));
  }

  if (entity === 'ticket') {
    router.route(`/${entity}/mine`).get(catchErrors(controller['mine']));
    router.route(`/${entity}/stats`).get(catchErrors(controller['stats']));
    router.route(`/${entity}/category-counts`).get(catchErrors(controller['categoryCounts']));
  }

  if (entity === 'message') {
    router
      .route(`/${entity}/upload`)
      .post(
        singleStorageUpload({ entity: 'message', fieldName: 'file', fileType: 'default' }),
        catchErrors(controller['uploadMessage'])
      );
    router.route(`/${entity}/thread/:userId`).get(catchErrors(controller['thread']));
    router.route(`/${entity}/conversations`).get(catchErrors(controller['conversations']));
    router.route(`/${entity}/read-all`).patch(catchErrors(controller['markAllRead']));
  }

  if (entity === 'notification') {
    router.route(`/${entity}/mine`).get(catchErrors(controller['mine']));
    router.route(`/${entity}/read-all`).patch(catchErrors(controller['markAllRead']));
    router.route(`/${entity}/:id/read`).patch(catchErrors(controller['markRead']));
  }

  if (entity === 'loginactivity') {
    router.route(`/${entity}/detail/:adminId`).get(catchErrors(controller['detail']));
  }
};

routesList.forEach(({ entity, controllerName }) => {
  const controller = appControllers[controllerName];
  routerApp(entity, controller);
});

// Dashboard has no Mongoose model of its own — it's a read-only aggregate
// over Call/Lead/Team, so it doesn't go through the generic routerApp/CRUD wiring.
router.route('/dashboard/summary').get(catchErrors(appControllers.dashboardController.summary));

// Same story — a read-only aggregate over Call/Payment/Team, not a model of its own.
router.route('/performance/summary').get(catchErrors(appControllers.performanceController.summary));

// Same story again — aggregates over Call/Lead/Payment/Client/Team. Both
// endpoints self-restrict to management roles inside the controller (see
// reportController/summary.js), unlike dashboard/performance which degrade
// gracefully for everyone else.
router.route('/report/summary').get(catchErrors(appControllers.reportController.summary));
router.route('/report/number-lookup').get(catchErrors(appControllers.reportController.numberLookup));

// Same story again — no model of its own, just live process/DB info for the About page.
router.route('/about/info').get(catchErrors(appControllers.aboutController.info));

// Presence heartbeat — no model of its own, just stamps Admin.lastSeenAt and
// returns who's currently online. Polled by the client instead of a socket
// (serverless can't hold a persistent socket.io connection).
// .default fallback: Vercel's Rolldown build lazy-wraps local requires (see
// the note in backend/api/index.js) — reading `.default` unwraps it; on a
// plain Node run `.default` is undefined and we use the module as-is.
const presenceControllerMod = require('../../controllers/appControllers/presenceController');
const presenceController = presenceControllerMod.default || presenceControllerMod;
router.route('/presence/ping').post(catchErrors(presenceController.ping));

// Sales B2B/B2C combined dashboard — aggregates Lead/Call/CallRecord scoped
// to teams matching a "System" filter (Team.businessType/region/systemType),
// + manual monthly cost rows (SalesCost) for the CAC / ROI ratios.
const salesDashMod = require('../../controllers/appControllers/salesDashboardController');
const salesDash = salesDashMod.default || salesDashMod;
router.route('/sales-dashboard/summary').get(catchErrors(salesDash.summary));
router.route('/sales-dashboard/marketing').get(catchErrors(salesDash.marketingSummary));
router.route('/sales-dashboard/config').get(catchErrors(salesDash.config));
router.route('/sales-dashboard/team/:id').patch(catchErrors(salesDash.setTeamSystem));
router.route('/sales-dashboard/cost').post(catchErrors(salesDash.upsertCost));
router.route('/sales-dashboard/cost/:id').delete(catchErrors(salesDash.deleteCost));

// Marketing Analytics Hub — ~60 config-driven dashboards (config/marketingDashboards.js).
// Leaves are computed from real CRM data (leads by channel/region, campaigns) or
// from manual monthly metric rows (MarketingMetric) with ratios derived from
// METRIC_TEMPLATES formulas. No model of its own for the aggregate reads.
const marketingHubMod = require('../../controllers/appControllers/marketingHubController');
const marketingHub = marketingHubMod.default || marketingHubMod;
router.route('/marketing-hub/tree').get(catchErrors(marketingHub.tree));
router.route('/marketing-hub/dashboard/:key').get(catchErrors(marketingHub.dashboard));
router.route('/marketing-hub/metrics/:key').get(catchErrors(marketingHub.listMetrics));
router.route('/marketing-hub/metrics/:key').post(catchErrors(marketingHub.saveMetric));
router.route('/marketing-hub/metrics/:key/:id').delete(catchErrors(marketingHub.deleteMetric));

module.exports = router;
