import { Router } from "express";
import * as devices from "../data/devices.js";
import { ADAPTERS, isPlatform } from "../integrations/index.js";
import { currentUserId, requireSenior } from "../middleware/auth.js";
import { currentDevice, requireDevice } from "../middleware/deviceAuth.js";
import { recordReading } from "../services/readings.js";

const MAX_SAMPLES_PER_SYNC = 1000;

/** Called by the companion phone apps. Mounted before user auth: phones use device tokens. */
export const deviceRouter = Router();

deviceRouter.post("/pair", (req, res) => {
  const { code, platform, name } = req.body ?? {};
  if (typeof code !== "string" || !isPlatform(platform)) {
    res.status(400).json({ error: "Body must be { code, platform: 'healthkit' | 'health_connect', name? }" });
    return;
  }
  const fallbackName = platform === "healthkit" ? "iPhone" : "Android phone";
  const deviceName = typeof name === "string" && name.trim() ? name.trim().slice(0, 100) : fallbackName;

  const paired = devices.redeemPairingCode(code, platform, deviceName);
  if (!paired) {
    res.status(400).json({ error: "Invalid or expired pairing code" });
    return;
  }
  // The token is only ever returned here; the app must keep it in the Keychain / Keystore.
  res.status(201).json(paired);
});

deviceRouter.post("/sync", requireDevice, (req, res) => {
  const device = currentDevice(res);
  const { samples } = req.body ?? {};
  if (!Array.isArray(samples) || samples.length > MAX_SAMPLES_PER_SYNC) {
    res.status(400).json({ error: `Body must be { samples: [...] } with at most ${MAX_SAMPLES_PER_SYNC} entries` });
    return;
  }

  const { samples: normalized, skipped } = ADAPTERS[device.platform](samples);
  let accepted = 0;
  let duplicates = 0;
  for (const sample of normalized) {
    if (!devices.markSeen(device, sample.externalId)) {
      duplicates++;
      continue;
    }
    recordReading({
      seniorId: device.seniorId,
      type: sample.type,
      value: sample.value,
      source: device.platform,
      recordedAt: sample.recordedAt,
    });
    accepted++;
  }
  devices.touchSync(device);

  res.json({ accepted, duplicates, skipped });
});

/** Called by the dashboard (logged-in relatives) to connect and manage a senior's phones. */
export const deviceManagementRouter = Router();

deviceManagementRouter.post("/seniors/:id/devices/pairing-code", (req, res) => {
  const senior = requireSenior(req, res);
  if (senior) res.status(201).json(devices.createPairingCode(senior.id, currentUserId(res)));
});

deviceManagementRouter.get("/seniors/:id/devices", (req, res) => {
  const senior = requireSenior(req, res);
  if (senior) res.json(devices.listDevices(senior.id));
});

deviceManagementRouter.delete("/seniors/:id/devices/:deviceId", (req, res) => {
  const senior = requireSenior(req, res);
  if (!senior) return;
  const device = devices.revokeDevice(senior.id, req.params.deviceId);
  if (!device) {
    res.status(404).json({ error: "Device not found" });
    return;
  }
  res.json(device);
});
