import express from 'express';
import crypto from 'node:crypto';
import { dbQuery } from './database.js';

const router = express.Router();
const KASPI_URL = 'https://pay.kaspi.kz/pay/8zv3mms1';
const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 5;
const attempts = new Map();
function clean(value, max) { return String(value ?? '').trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max); }
function rateLimited(key) {
  const now = Date.now();
  const prior = (attempts.get(key) || []).filter(t => now - t < WINDOW_MS);
  if (prior.length >= MAX_REQUESTS) { attempts.set(key, prior); return true; }
  prior.push(now); attempts.set(key, prior);
  if (attempts.size > 2000) for (const [k, values] of attempts) if (!values.some(t => now - t < WINDOW_MS)) attempts.delete(k);
  return false;
}
function orderNumber() { return 'SP-' + new Date().toISOString().slice(2,10).replace(/-/g,'') + '-' + crypto.randomBytes(3).toString('hex').toUpperCase(); }
router.post('/', async (req, res) => {
  try {
    if (rateLimited(String(req.ip || req.socket.remoteAddress || 'unknown'))) return res.status(429).json({ error: 'Has enviado demasiadas solicitudes. Inténtalo más tarde.' });
    if (clean(req.body?.website, 200)) return res.status(400).json({ error: 'No se pudo procesar la solicitud.' });
    const name = clean(req.body?.name, 100);
    const contact = clean(req.body?.contact, 120);
    const service = clean(req.body?.service, 100);
    const brief = clean(req.body?.brief, 3000);
    const language = ['ru','kk','es','en'].includes(req.body?.language) ? req.body.language : 'ru';
    if (name.length < 2 || contact.length < 5 || service.length < 2 || brief.length < 15) return res.status(400).json({ error: 'Completa nombre, contacto, tipo de trabajo y una descripción (mínimo 15 caracteres).' });
    const id = crypto.randomUUID(); const accessToken = crypto.randomBytes(32).toString('hex'); const number = orderNumber();
    const result = await dbQuery('INSERT INTO sala_orders (id, order_number, access_token_hash, customer_name, customer_contact, service, brief, language, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,\'submitted\') RETURNING order_number AS "orderNumber", status, created_at AS "createdAt"', [id, number, crypto.createHash('sha256').update(accessToken).digest('hex'), name, contact, service, brief, language]);
    return res.status(201).json({ order: result.rows[0], accessToken, message: 'Solicitud recibida. Guarda el número y el código privado de seguimiento.' });
  } catch (error) { console.error('Order submission error:', error); return res.status(503).json({ error: 'No se pudo guardar la solicitud. Inténtalo más tarde.' }); }
});
router.get('/:orderNumber', async (req, res) => {
  try {
    const number = clean(req.params.orderNumber, 40).toUpperCase(); const token = clean(req.get('x-order-token'), 100);
    if (!token) return res.status(401).json({ error: 'Falta el código privado de seguimiento.' });
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const result = await dbQuery('SELECT order_number AS "orderNumber", service, status, quote_amount AS "quoteAmount", currency, payment_confirmed_at AS "paymentConfirmedAt", delivery_note AS "deliveryNote", created_at AS "createdAt", updated_at AS "updatedAt" FROM sala_orders WHERE order_number=$1 AND access_token_hash=$2 LIMIT 1', [number, hash]);
    if (!result.rows.length) return res.status(404).json({ error: 'Pedido no encontrado o código incorrecto.' });
    return res.json({ order: result.rows[0], paymentUrl: result.rows[0].status === 'awaiting_payment' ? KASPI_URL : null });
  } catch (error) { console.error('Order lookup error:', error); return res.status(503).json({ error: 'No se pudo consultar el pedido.' }); }
});
export default router;
