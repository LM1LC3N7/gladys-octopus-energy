// -----------------------------------------------------------------------------
// Entry point: SDK wiring only. Every handler is registered BEFORE connect(),
// and delegates to the OctopusApp (src/app.js).
//
// Environment variables provided by the Gladys supervisor, read by the SDK:
// GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { OctopusApp } from './src/app.js';
import { ACTIONS, SCENE_ACTIONS, WIDGETS } from './src/constants.js';

const gladys = new GladysIntegration();
const app = new OctopusApp({ gladys });

// --- Discovery -------------------------------------------------------------------
gladys.onScanRequest(() => app.discover());

// --- Scene actions --------------------------------------------------------------
gladys.onSceneAction(SCENE_ACTIONS.GET_PRICE, (fields) => app.getPrice(fields));
gladys.onSceneAction(SCENE_ACTIONS.CHEAPEST_WINDOW, (fields) => app.getCheapestWindow(fields));

// --- Dashboard widget -----------------------------------------------------------
for (const key of Object.values(WIDGETS)) {
  gladys.onWidgetGet(key, (request) => app.getWidget(key, request));
}

// --- Energy contracts: delegated pricing -----------------------------------------
gladys.onEnergyPrice((request) => app.energyPrice(request));
gladys.onEnergyCurrent((request) => app.energyCurrent(request));

// --- Configuration screen button ----------------------------------------------
gladys.onAction(ACTIONS.TEST, () => app.testConnection());

// --- Configuration changed by the user ----------------------------------------
gladys.onConfigUpdated((config) => {
  logger.info('Configuration updated: restarting');
  return app.start(config);
});

// --- Connection lifecycle ------------------------------------------------------
gladys.on('connected', async () => {
  try {
    await app.start(await gladys.getConfig());
  } catch (err) {
    logger.error('Start failed', err);
  }
});
gladys.on('disconnected', () => {
  app.stop().catch((err) => logger.error('Stop failed', err));
});
gladys.handleShutdown(() => app.stop());

logger.info('Starting the Octopus Energy integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
