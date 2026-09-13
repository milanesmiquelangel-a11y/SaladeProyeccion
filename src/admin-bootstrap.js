import express from 'express';
import adminRouter from './admin-routes.js';

const originalListen = express.application.listen;

express.application.listen = function patchedAdminListen(...args) {
  if (!this._salaAdminMounted) {
    this.use('/admin', adminRouter);
    this._salaAdminMounted = true;
  }
  return originalListen.apply(this, args);
};
