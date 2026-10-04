// Chiamate alle API del modulo Gift card.
import type { GiftCard, GiftCardInput, GiftPackage } from '../../../shared/giftCards.ts'
import { request } from '../lib/api.ts'

export const giftApi = {
  list: () => request<GiftCard[]>('GET', '/api/giftcards'),
  lookup: (code: string) => request<GiftCard>('GET', `/api/giftcards/lookup/${encodeURIComponent(code)}`),
  create: (input: Partial<GiftCardInput>) => request<GiftCard>('POST', '/api/giftcards', input),
  update: (id: number, changes: { recipient?: string; buyer?: string; notes?: string; expiresOn?: string | null }) =>
    request<GiftCard>('PUT', `/api/giftcards/${id}`, changes),
  redeem: (id: number, body: { amount?: string | number; itemIdx?: number; qty?: number; note?: string }) =>
    request<GiftCard>('POST', `/api/giftcards/${id}/redeem`, body),
  reverse: (id: number, movementId: number) => request<GiftCard>('POST', `/api/giftcards/${id}/movements/${movementId}/reverse`, {}),
  cancel: (id: number, cancelled: boolean) => request<GiftCard>('POST', `/api/giftcards/${id}/cancel`, { cancelled }),
  packages: () => request<GiftPackage[]>('GET', '/api/gift-packages'),
  createPackage: (p: Omit<GiftPackage, 'id'>) => request<GiftPackage>('POST', '/api/gift-packages', p),
  updatePackage: (id: number, p: Omit<GiftPackage, 'id'>) => request<GiftPackage>('PUT', `/api/gift-packages/${id}`, p),
  deletePackage: (id: number) => request<{ ok: boolean }>('DELETE', `/api/gift-packages/${id}`),
}
