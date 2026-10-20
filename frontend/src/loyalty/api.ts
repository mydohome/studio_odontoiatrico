// Chiamate alle API del modulo Fidelity card.
import type { LoyaltyCard, LoyaltyCardDetail, LoyaltyProgram, StampResult } from '../../../shared/loyalty.ts'
import { request } from '../lib/api.ts'

export interface CardInput {
  name: string
  phone: string
  consent?: boolean
}

export const loyaltyApi = {
  program: () => request<LoyaltyProgram>('GET', '/api/loyalty/program'),
  saveProgram: (p: Omit<LoyaltyProgram, 'id'>) => request<LoyaltyProgram>('PUT', '/api/loyalty/program', p),
  info: () => request<{ baseUrl: string | null }>('GET', '/api/loyalty/info'),
  list: (q: string, status: string) => request<LoyaltyCard[]>('GET', `/api/loyalty/cards?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}`),
  card: (id: number) => request<LoyaltyCardDetail>('GET', `/api/loyalty/cards/${id}`),
  create: (input: CardInput) => request<LoyaltyCardDetail>('POST', '/api/loyalty/cards', input),
  update: (id: number, input: CardInput) => request<LoyaltyCardDetail>('PUT', `/api/loyalty/cards/${id}`, input),
  stamp: (id: number, body: { force?: boolean; note?: string } = {}) => request<StampResult>('POST', `/api/loyalty/cards/${id}/stamps`, body),
  voidStamp: (id: number, stampId: number) => request<LoyaltyCardDetail>('POST', `/api/loyalty/cards/${id}/stamps/${stampId}/void`, {}),
  disable: (id: number) => request<LoyaltyCardDetail>('POST', `/api/loyalty/cards/${id}/disable`, {}),
  enable: (id: number) => request<LoyaltyCardDetail>('POST', `/api/loyalty/cards/${id}/enable`, {}),
  regenerate: (id: number) => request<LoyaltyCardDetail>('POST', `/api/loyalty/cards/${id}/regenerate`, {}),
  scan: (code: string) => request<StampResult>('POST', '/api/loyalty/scan', { code }),
}
