import express from 'express';
import whatsappRoute from './whatsapp.route.js';
import authRoute from './auth.route.js';
import orderRoute from './order.route.js';
import productRoute from './product.route.js';
import serviceRoute from './service.route.js';
import alertRoute from './alert.route.js';
import customerRoute from './customer.route.js';

const router = express.Router();

const defaultRoutes = [
  { path: '/webhook/whatsapp', route: whatsappRoute },
  { path: '/admin', route: authRoute },
  { path: '/admin', route: orderRoute },
  { path: '/admin', route: productRoute },
  { path: '/admin', route: serviceRoute },
  { path: '/admin', route: alertRoute },
  { path: '/admin', route: customerRoute },
];

defaultRoutes.forEach((route) => {
  router.use(route.path, route.route);
});

export default router;
