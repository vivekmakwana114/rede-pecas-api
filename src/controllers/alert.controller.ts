import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync.js';
import { formatDateTime } from '../utils/helpers.js';
import { getAlerts, markAlertRead } from '../models/alert.model.js';

/**
 * Backs `GET /v1/admin/alerts` — returns the newest 100 rows from `admin_alerts`
 * (payment-proof-received, stock-confirmation-needed, etc.), with timestamps formatted for display.
 */
export const getAlertsHandler = catchAsync(async (req: Request, res: Response) => {
  const alerts = await getAlerts();

  res.status(200).json({
    success: true,
    message: 'Alerts retrieved.',
    code: 200,
    data: alerts.map((alert) => ({
      ...alert,
      created_at: formatDateTime(alert.created_at),
      read_at: formatDateTime(alert.read_at),
    })),
    meta: { timestamp: new Date().toISOString() },
  });
});

/**
 * Backs `POST /v1/admin/alerts/:id/read` — stamps `read_at` on the given `admin_alerts`
 * row so the panel can dismiss it from the feed.
 */
export const markAlertReadHandler = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  await markAlertRead(Number(id));

  res.status(200).json({
    success: true,
    message: `Alert ${id} marked read.`,
    code: 200,
    data: null,
    meta: { timestamp: new Date().toISOString() },
  });
});
