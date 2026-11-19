import type { Prisma } from '../../generated/prisma/client.js';

/*
 * Order state changes as plain functions over a transaction, used by both the payments webhook path and the
 * orders service. Each one locks the order row first, so concurrent webhooks / sweeps cannot double-apply.
 */

type Tx = Prisma.TransactionClient;

const lock = (tx: Tx, orderId: string) => tx.$queryRaw`SELECT id FROM "app"."orders" WHERE id = ${orderId}::uuid FOR UPDATE`;

/** Gives the reserved units back (order lines whose variant was deleted have nothing to restore). */
async function restock(tx: Tx, orderId: string) {
  const items = await tx.orderItem.findMany({ where: { orderId, variantId: { not: null } }, select: { variantId: true, quantity: true } });
  for (const i of items) await tx.productVariant.updateMany({ where: { id: i.variantId! }, data: { stock: { increment: i.quantity } } });
}

/** PENDING_PAYMENT → CANCELED with stock returned. Returns false if the order was not waiting for payment. */
export async function cancelUnpaidOrder(tx: Tx, orderId: string): Promise<boolean> {
  await lock(tx, orderId);
  const { count } = await tx.order.updateMany({ where: { id: orderId, status: 'PENDING_PAYMENT' }, data: { status: 'CANCELED', canceledAt: new Date() } });
  if (!count) return false;
  await restock(tx, orderId);
  return true;
}

export type PaidResult = 'paid' | 'already' | 'paid_after_cancel';

/**
 * PENDING_PAYMENT → PAID. If the order was already canceled/expired when the money arrived, it stays canceled
 * (stock may be gone) and the caller records an anomaly for a refund.
 */
export async function markOrderPaid(tx: Tx, orderId: string): Promise<PaidResult> {
  await lock(tx, orderId);
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } });
  if (order.status === 'CANCELED') return 'paid_after_cancel';
  if (order.status !== 'PENDING_PAYMENT') return 'already';
  await tx.order.update({ where: { id: orderId }, data: { status: 'PAID', paidAt: new Date() } });
  return 'paid';
}

/** A fully refunded payment marks the order REFUNDED (stock is left alone: the brand decides if goods came back). */
export async function markOrderRefunded(tx: Tx, orderId: string) {
  await lock(tx, orderId);
  await tx.order.updateMany({ where: { id: orderId, status: { in: ['PAID', 'FULFILLED'] } }, data: { status: 'REFUNDED' } });
}
