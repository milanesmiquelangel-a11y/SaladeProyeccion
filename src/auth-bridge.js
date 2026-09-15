import express from 'express';
import { authRouter, getAuthenticatedUserId } from './auth.js';

const originalUse = express.application.use;
const originalListen = express.application.listen;
let guardInstalled = false;
let authMounted = false;

async function sessionHeaderBridge(req, res, next) {
  const path = req.path || '';
  const protectedPath = path.startsWith('/api/video/') || path.startsWith('/api/billing/');
  if (!protectedPath || path === '/api/billing/status' || path === '/api/billing/webhook') return next();
  try {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) delete req.headers['x-sala-user-id'];
    else req.headers['x-sala-user-id'] = userId;
    return next();
  } catch (error) {
    console.error('Authentication bridge error:', error);
    delete req.headers['x-sala-user-id'];
    return next();
  }
}

express.application.use = function patchedUse(...args) {
  if (!guardInstalled) {
    guardInstalled = true;
    originalUse.call(this, sessionHeaderBridge);
  }
  return originalUse.apply(this, args);
};

express.application.listen = function patchedListen(...args) {
  if (!authMounted) {
    this.use('/api/auth', authRouter(express));
    authMounted = true;
  }
  return originalListen.apply(this, args);
};
