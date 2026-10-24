import type { NextFunction, Request, Response } from "express";
import * as devices from "../data/devices.js";

/** Authenticates a paired phone by the `Authorization: Bearer <device token>` it got when pairing. */
export function requireDevice(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const device = token ? devices.findDeviceByToken(token) : undefined;
  if (!device) {
    res.status(401).json({ error: "Invalid or revoked device token" });
    return;
  }
  res.locals.device = device;
  next();
}

export function currentDevice(res: Response): devices.StoredDevice {
  return res.locals.device as devices.StoredDevice;
}
