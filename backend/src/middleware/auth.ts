import type { NextFunction, Request, Response } from "express";
import * as store from "../data/store.js";

/**
 * TEMPORARY stand-in for real login: trusts an `x-user-id` header (or `?userId=` for
 * EventSource, which can't set headers). Replace with session/token verification once
 * the external authenticator is in place — routes only rely on `res.locals.userId`.
 */
export function requireUser(req: Request, res: Response, next: NextFunction): void {
  const fromQuery = typeof req.query.userId === "string" ? req.query.userId : undefined;
  const userId = req.header("x-user-id") ?? fromQuery;
  if (!userId || !store.users.has(userId)) {
    res.status(401).json({ error: "Unknown or missing user" });
    return;
  }
  res.locals.userId = userId;
  next();
}

export function currentUserId(res: Response): string {
  return res.locals.userId as string;
}
