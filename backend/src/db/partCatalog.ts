import type { Part } from '../types/domain.js'
import { toPaise } from '../lib/money.js'

interface CatalogRow {
  partNo: string
  detail: string
  rate: number
  boxQty: number
  finishKg?: number
  hsn: string
  gsp?: string
  poNo?: string
  poDate?: string
  blankKg?: number
}

/** Client-supplied priced part catalogue transcribed from the approved worksheet. */
const ROWS: CatalogRow[] = [
  { partNo: 'K028554 PC', detail: 'BODY SLACK ADJUSTER', rate: 32, boxQty: 14, finishKg: 1.76, hsn: '87089900', poNo: 'PO/2021/1724', poDate: '2021-03-26' },
  { partNo: 'OM-6207-A-2RS', detail: '4/18 06', rate: 2.5, boxQty: 340, finishKg: 0.146, hsn: '9988', poNo: 'HEW/PO/170/0421', poDate: '2021-04-20' },
  { partNo: 'IM-6207-ALS', detail: '2/02 12', rate: 2, boxQty: 500, finishKg: 0.091, hsn: '9988', poNo: 'HEW/PO/170/0421', poDate: '2021-04-20' },
  { partNo: 'E202538', detail: 'KUGELBOLZEN', rate: 48, boxQty: 10, finishKg: 2.451, hsn: '86073010', poNo: '0799', poDate: '2022-12-23', blankKg: 3.241 },
  { partNo: 'E202500', detail: 'KUGELBOLZEN', rate: 48, boxQty: 10, finishKg: 3.744, hsn: '86073010', poNo: '0981', poDate: '2023-02-26', blankKg: 4.67 },
  { partNo: '417050026001', detail: 'WASHER OD 40 X ID 26 X 5 TK.', rate: 11.37, boxQty: 1, hsn: '7318', poNo: 'POP032324000076', poDate: '2023-11-04' },
  { partNo: '417058040005', detail: 'PIN-DIA 40 X 175L', rate: 146, boxQty: 1, hsn: '87169010', poNo: 'POP032324000076', poDate: '2023-11-04' },
  { partNo: '417580020022', detail: 'REAR SHAFT LENGTH = 1525 X DIA 90 MM', rate: 730, boxQty: 1, hsn: '87169010', poNo: 'POP032324000076', poDate: '2023-11-04' },
  { partNo: '417580025019', detail: 'PIN DIA.25 X 103 LG', rate: 87, boxQty: 1, hsn: '87169010', poNo: 'POP032324000076', poDate: '2023-11-04' },
  { partNo: '417580040007', detail: 'STABILIZER PIN L=110 X DIA 60 MM', rate: 185, boxQty: 1, hsn: '87169010', poNo: 'POP032324000076', poDate: '2023-11-04' },
  { partNo: '417580040019', detail: 'LOCKING SYSTEM FOR TIP TRAILER', rate: 3830, boxQty: 1, hsn: '87169010', poNo: 'POP032324000076', poDate: '2023-11-04' },
  { partNo: '417580050004', detail: 'STABILIZER SHAFT L=230 X DIA 40 MM', rate: 212, boxQty: 1, hsn: '87169010', poNo: 'POP032324000076', poDate: '2023-11-04' },
  { partNo: '417580060001', detail: 'STABILIZER BUSH-1 L=52XID=42XOD=60', rate: 105, boxQty: 1, hsn: '87169010', poNo: 'POP032324000076', poDate: '2023-11-04' },
  { partNo: '417580060002', detail: 'STABILIZER BUSH-2 L=165XID=42XOD=60', rate: 210, boxQty: 1, hsn: '87169010', poNo: 'POP032324000076', poDate: '2023-11-04' },
  { partNo: '417580060112', detail: 'BUSH - L-80 X ID 41 X OD 60', rate: 138, boxQty: 1, hsn: '87169010', poNo: 'POP032324000076', poDate: '2023-11-04' },
  { partNo: '417580080001', detail: 'REAR LOCKING PIN-1 L=55 DIA 80MM', rate: 157, boxQty: 1, hsn: '87169010', poNo: 'POP032324000076', poDate: '2023-11-04' },
  { partNo: '417580080002', detail: 'REAR LOCKING PIN-2 L=190 DIA 35MM', rate: 165, boxQty: 1, hsn: '87169010', poNo: 'POP032324000076', poDate: '2023-11-04' },
  { partNo: '417580106001', detail: 'TIPPING REAR BUSH2-INNER BUSH OD-106XID-91XL=125', rate: 846, boxQty: 1, hsn: '87169010', poNo: 'POP032324000076', poDate: '2023-11-04' },
  { partNo: '417580130002', detail: 'TIPPING REAR BUS2H-OUTER BUSH OD-135XID-110XL=125', rate: 704, boxQty: 1, hsn: '87169010', poNo: 'POP032324000076', poDate: '2023-11-04' },
  { partNo: '417580135002', detail: 'TIPPING BUSH-1 BUSH OD135XID-91XL=206', rate: 1522, boxQty: 1, hsn: '87169010', poNo: 'POP032324000076', poDate: '2023-11-04' },
  { partNo: 'SCKIUMS1090600001', detail: 'SUPPORT LEFT 52154010906', rate: 351, boxQty: 1, finishKg: 5.3, hsn: '84279000', poNo: '30191', poDate: '2023-12-27' },
  { partNo: 'SCKIUMS1090700001', detail: 'SUPPORT RIGHT 52154010907', rate: 351, boxQty: 1, finishKg: 5.3, hsn: '84279000', poNo: '30191', poDate: '2023-12-27' },
  { partNo: 'AB3542-OT-01 02 02 3111-F', detail: 'X014 RR OR', rate: 14.5, boxQty: 1, finishKg: 0.818, hsn: '73269099', gsp: '400', poNo: 'SES/PO/26-27/28', poDate: '2026-06-09', blankKg: 0.4 },
  { partNo: 'AB3541-OT-01 01 02 3111-F', detail: 'X104 FRT OR', rate: 14.5, boxQty: 1, finishKg: 0.722, hsn: '73269099', gsp: '400', poNo: 'SES/PO/26-27/28', poDate: '2026-06-09', blankKg: 0.4 },
  { partNo: 'MS SCRAP', detail: 'MS TURNING SCRAP', rate: 25.5, boxQty: 1, finishKg: 1, hsn: '7204', gsp: '5985', poNo: 'VERBAL', poDate: '2026-08-16' },
  { partNo: 'X104 FRT OR-OILING', detail: 'X104 FRT OR', rate: 1, boxQty: 1, finishKg: 0.722, hsn: '73269099', gsp: '400', poNo: 'Mallikarjun', poDate: '2026-08-09', blankKg: 0.4 },
]

const looksLikeEdition = (s: string) => /^\d+\/\d+\s+\d+$/.test(s)

export function clientPartCatalog(unitId: string): Part[] {
  return ROWS.map((r, index) => ({
    id: `catalog-part-${String(index + 1).padStart(3, '0')}`,
    partNo: r.partNo,
    materialCode: `RM-${String(index + 1).padStart(3, '0')}`,
    description: looksLikeEdition(r.detail) ? undefined : r.detail,
    editionNo: looksLikeEdition(r.detail) ? r.detail : undefined,
    category: r.partNo === 'MS SCRAP' ? 'Scrap' : 'Raw Material',
    unitId,
    uom: 'NOS',
    hsnSac: r.hsn,
    gstPct: 18,
    finishWtMg: Math.round((r.finishKg ?? 0) * 1_000_000),
    scrapWtMg: 0,
    rmRatePaise: toPaise(r.rate),
    rmWtMg: r.blankKg != null ? Math.round(r.blankKg * 1_000_000) : undefined,
    avgQtyPerBox: r.boxQty,
    packingMode: r.gsp,
    defaultPoNo: r.poNo,
    defaultPoDate: r.poDate,
    active: true,
  }))
}
