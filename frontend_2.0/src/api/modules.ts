/**
 * Per-module API client surface. Thin typed wrappers over the backend module
 * endpoints — used by write-through (and available for future per-page reads).
 * Bodies mirror the backend Zod schemas; money is integer paise throughout.
 */
import { api } from './client'

export const mastersApi = {
  list: <T>(entity: string) => api.get<T[]>(`/masters/${entity}`),
  create: <T>(entity: string, body: unknown) => api.post<T>(`/masters/${entity}`, body),
  update: <T>(entity: string, id: string, body: unknown) => api.put<T>(`/masters/${entity}/${id}`, body),
  remove: (entity: string, id: string) => api.del(`/masters/${entity}/${id}`),
  setActive: (entity: string, id: string, active: boolean) => api.patch(`/masters/${entity}/${id}/active`, { active }),
}

export const inwardApi = {
  create: (body: unknown) => api.post('/inward', body),
  update: (id: string, body: unknown) => api.put(`/inward/${id}`, body),
  remove: (id: string) => api.del(`/inward/${id}`),
  uploadAttachment: (id: string, body: { filename: string; mime: string; dataBase64: string }) => api.post(`/inward/${id}/attachment`, body),
  removeAttachment: (id: string) => api.del(`/inward/${id}/attachment`),
  attachmentUrl: (id: string) => api.objectUrl(`/inward/${id}/attachment`),
}
export const dispatchApi = {
  nextDc: () => api.post<{ dcNo: string }>('/dispatch/next-dc'),
  create: (body: unknown) => api.post('/dispatch', body),
  remove: (id: string) => api.del(`/dispatch/${id}`),
}
export const invoicesApi = {
  finalize: (body: unknown) => api.post('/invoices/finalize', body),
  editDraft: (id: string, body: unknown) => api.post(`/invoices/${id}/edit-draft`, body),
  void: (id: string) => api.post(`/invoices/${id}/void`),
}
export const paymentsApi = {
  record: (body: unknown) => api.post('/payments', body),
  reverse: (id: string) => api.post(`/payments/${id}/reverse`),
}
export const scrapApi = {
  create: (body: unknown) => api.post('/scrap', body),
  update: (id: string, body: unknown) => api.put(`/scrap/${id}`, body),
  remove: (id: string) => api.del(`/scrap/${id}`),
}
export const expensesApi = {
  create: (body: unknown) => api.post('/expenses', body),
  update: (id: string, body: unknown) => api.put(`/expenses/${id}`, body),
  pay: (id: string, body: unknown) => api.post(`/expenses/${id}/pay`, body),
  remove: (id: string) => api.del(`/expenses/${id}`),
}
export const rejectionApi = {
  create: (body: unknown) => api.post('/rejection', body),
  update: (id: string, body: unknown) => api.put(`/rejection/${id}`, body),
  remove: (id: string) => api.del(`/rejection/${id}`),
}
export const attendanceApi = {
  createProduction: (body: unknown) => api.post('/attendance/production', body),
  createProductionBulk: (body: unknown[]) => api.post('/attendance/production/bulk', body),
  removeProduction: (id: string) => api.del(`/attendance/production/${id}`),
  createShift: (body: unknown) => api.post('/attendance/shift', body),
  removeShift: (id: string) => api.del(`/attendance/shift/${id}`),
}
export const ratesApi = {
  createRm: (body: unknown) => api.post('/rates/rm', body),
  updateRm: (id: string, body: unknown) => api.put(`/rates/rm/${id}`, body),
  createProduction: (body: unknown) => api.post('/rates/production', body),
}
export const usersApi = {
  create: (body: unknown) => api.post('/users', body),
  update: (id: string, body: unknown) => api.put(`/users/${id}`, body),
  setActive: (id: string, active: boolean) => api.patch(`/users/${id}/active`, { active }),
  setOverride: (id: string, body: unknown) => api.put(`/users/${id}/override`, body),
}
export const rolesApi = {
  create: (body: unknown) => api.post('/roles', body),
  updatePermissions: (id: string, body: unknown) => api.put(`/roles/${id}/permissions`, body),
  rename: (id: string, body: unknown) => api.put(`/roles/${id}`, body),
  remove: (id: string) => api.del(`/roles/${id}`),
  reset: (id: string) => api.post(`/roles/${id}/reset`),
}
export const importApi = {
  apply: (body: unknown) => api.post('/import/apply', body),
}
export const systemApi = {
  downloadSql: () => api.get<string>('/system/backup.sql'),
  restoreSql: (sql: string) => api.post('/system/restore.sql', { sql }),
  backup: () => api.get('/system/backup'),
  // baseVersion lets the server 409 when another session has advanced the state.
  restore: (state: unknown, baseVersion?: number) => api.post('/system/backup', { state, baseVersion }),
  resetDemo: () => api.post('/system/reset-demo'),
}
