const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const path = require('path');
const { isPathInside } = require('../../utils/is-path-inside');
const { submitWebsiteLead } = require('../../controllers/corePublicControllers/websiteLead');
const facebookController = require('../../controllers/appControllers/facebookController');
const googleController = require('../../controllers/appControllers/googleController');
const linkedinController = require('../../controllers/appControllers/linkedinController');
const gitController = require('../../controllers/appControllers/gitConnectionController');
const vercelController = require('../../controllers/appControllers/vercelConnectionController');
const { catchErrors } = require('../../handlers/errorHandlers');

// These three are hit by anonymous website visitors and by Meta's own
// servers — neither carries this app's bearer token, so they live under the
// unauthenticated /public mount instead of /api. Registered before the
// catch-all file-serving route below so they take priority.

const websiteLeadLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 });
router.route('/leads/website').post(websiteLeadLimiter, catchErrors(submitWebsiteLead));

const webhookLimiter = rateLimit({ windowMs: 60 * 1000, max: 300 });
router.route('/webhooks/facebook').get(catchErrors(facebookController.verifyWebhook));
router.route('/webhooks/facebook').post(webhookLimiter, catchErrors(facebookController.receiveWebhook));

router.route('/facebook/callback').get(catchErrors(facebookController.callback));

router.route('/google/webhook').post(webhookLimiter, catchErrors(googleController.receiveWebhook));
router.route('/google/callback').get(catchErrors(googleController.callback));

router.route('/linkedin/callback').get(catchErrors(linkedinController.callback));

router.route('/git/callback').get(catchErrors(gitController.callback));

router.route('/vercel/callback').get(catchErrors(vercelController.callback));

router.route('/:subPath/:directory/:file').get(function (req, res) {
  try {
    const { subPath, directory, file } = req.params;

    // Decode each parameter separately
    const decodedSubPath = decodeURIComponent(subPath);
    const decodedDirectory = decodeURIComponent(directory);
    const decodedFile = decodeURIComponent(file);

    // Define the trusted root directory
    const rootDir = path.join(__dirname, '../../public');

    // Safely join the decoded path segments
    const relativePath = path.join(decodedSubPath, decodedDirectory, decodedFile);
    const absolutePath = path.join(rootDir, relativePath);

    // Check if the resulting path stays inside rootDir
    if (!isPathInside(absolutePath, rootDir)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid filepath',
      });
    }

    return res.sendFile(absolutePath, (error) => {
      if (error) {
        return res.status(404).json({
          success: false,
          result: null,
          message: 'we could not find : ' + file,
        });
      }
    });
  } catch (error) {
    return res.status(503).json({
      success: false,
      result: null,
      message: error.message,
      error: error,
    });
  }
});

module.exports = router;
