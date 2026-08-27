/* eslint-disable react-refresh/only-export-components -- lazy-imported PDF utility module, not a fast-refresh route */
/**
 * invoicePdf.tsx — the GST tax-invoice PDF (plan P4), rendered client-side with
 * @react-pdf/renderer. This module is DYNAMIC-imported from the Billing page so
 * the heavy renderer never lands in the main bundle. It takes a plain
 * `InvoicePdfModel` (built by selectors) — no store access here.
 */
import { Document, Page, View, Text, StyleSheet, pdf } from '@react-pdf/renderer'
import { formatINR, toWordsIndian, type Paise } from './money'
import type { InvoicePdfModel } from '@/selectors/invoiceCompute'

const R = (p: Paise) => `₹ ${formatINR(p)}`

const s = StyleSheet.create({
  page: { padding: 28, fontSize: 9, color: '#0f172a', fontFamily: 'Helvetica' },
  title: { fontSize: 13, fontFamily: 'Helvetica-Bold', textAlign: 'center', marginBottom: 2 },
  sub: { fontSize: 8, textAlign: 'center', color: '#64748b', marginBottom: 8 },
  row: { flexDirection: 'row' },
  box: { borderWidth: 1, borderColor: '#cbd5e1' },
  half: { width: '50%', padding: 6 },
  label: { color: '#64748b', fontSize: 7, textTransform: 'uppercase', marginBottom: 1 },
  bold: { fontFamily: 'Helvetica-Bold' },
  th: { backgroundColor: '#f1f5f9', fontFamily: 'Helvetica-Bold', fontSize: 8 },
  cell: { padding: 4, borderRightWidth: 1, borderColor: '#cbd5e1' },
  cTale: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#e2e8f0' },
  right: { textAlign: 'right' },
  totals: { marginTop: 8, marginLeft: 'auto', width: '52%' },
  tRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 1.5 },
  grand: { fontFamily: 'Helvetica-Bold', fontSize: 11, borderTopWidth: 1, borderColor: '#0f172a', paddingTop: 3, marginTop: 3 },
  words: { marginTop: 8, fontSize: 8, fontStyle: 'italic', color: '#475569' },
  foot: { marginTop: 16, flexDirection: 'row', justifyContent: 'space-between' },
})

// Column widths sum to 100%.
const COLS = { sr: '6%', part: '30%', hsn: '14%', challan: '16%', qty: '10%', rate: '12%', amt: '12%' }

function InvoiceDoc({ m }: { m: InvoicePdfModel }) {
  const intra = m.taxKind === 'cgst_sgst'
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <Text style={s.title}>{m.issuerName}</Text>
        <Text style={s.sub}>
          GSTIN {m.issuerGstin} · State {m.issuerState}
          {m.issuerAddress.length ? ` · ${m.issuerAddress.join(', ')}` : ''}
        </Text>
        <Text style={[s.title, { fontSize: 10, marginBottom: 6 }]}>TAX INVOICE</Text>

        <View style={[s.box, s.row]}>
          <View style={s.half}>
            <Text style={s.label}>Consignee (Bill to)</Text>
            <Text style={s.bold}>{m.custName}</Text>
            {m.custAddress.map((l, i) => (
              <Text key={i}>{l}</Text>
            ))}
            <Text>GSTIN {m.custGstin} · State {m.custState}</Text>
          </View>
          <View style={[s.half, { borderLeftWidth: 1, borderColor: '#cbd5e1' }]}>
            <Text><Text style={s.label}>Invoice No  </Text><Text style={s.bold}>{m.invoiceNo}</Text></Text>
            <Text><Text style={s.label}>Date  </Text>{m.invoiceDate}</Text>
            {m.dueDate ? <Text><Text style={s.label}>Due  </Text>{m.dueDate}</Text> : null}
            <Text><Text style={s.label}>Tax  </Text>{intra ? 'CGST + SGST (intra-state)' : 'IGST (inter-state)'}</Text>
          </View>
        </View>

        {/* line items */}
        <View style={[s.box, { marginTop: 8 }]}>
          <View style={[s.row, s.th]}>
            <Text style={[s.cell, { width: COLS.sr }]}>#</Text>
            <Text style={[s.cell, { width: COLS.part }]}>Part</Text>
            <Text style={[s.cell, { width: COLS.hsn }]}>HSN/SAC</Text>
            <Text style={[s.cell, { width: COLS.challan }]}>Challan</Text>
            <Text style={[s.cell, s.right, { width: COLS.qty }]}>Qty</Text>
            <Text style={[s.cell, s.right, { width: COLS.rate }]}>Rate</Text>
            <Text style={[s.right, { width: COLS.amt, padding: 4 }]}>Amount</Text>
          </View>
          {m.lines.map((l, i) => (
            <View key={l.dispatchId} style={s.cTale}>
              <Text style={[s.cell, { width: COLS.sr }]}>{i + 1}</Text>
              <Text style={[s.cell, { width: COLS.part }]}>{l.partNo}</Text>
              <Text style={[s.cell, { width: COLS.hsn }]}>{l.hsnSac}</Text>
              <Text style={[s.cell, { width: COLS.challan }]}>{l.challanNo}</Text>
              <Text style={[s.cell, s.right, { width: COLS.qty }]}>{l.qty.toLocaleString('en-IN')}</Text>
              <Text style={[s.cell, s.right, { width: COLS.rate }]}>{formatINR(l.ratePaise)}</Text>
              <Text style={[s.right, { width: COLS.amt, padding: 4 }]}>{formatINR(l.amountPaise)}</Text>
            </View>
          ))}
        </View>

        {/* packing + totals */}
        <View style={s.row}>
          <View style={{ width: '46%', marginTop: 8 }}>
            <Text style={s.label}>Packing</Text>
            {m.packing.length ? (
              m.packing.map((p, i) => (
                <Text key={i}>{p.boxes} box(es) × {p.qtyPerBox.toLocaleString('en-IN')} pcs</Text>
              ))
            ) : (
              <Text>—</Text>
            )}
          </View>
          <View style={s.totals}>
            <View style={s.tRow}><Text>Assessable</Text><Text>{R(m.totals.assessable)}</Text></View>
            {intra ? (
              <>
                <View style={s.tRow}><Text>CGST</Text><Text>{R(m.totals.cgst)}</Text></View>
                <View style={s.tRow}><Text>SGST</Text><Text>{R(m.totals.sgst)}</Text></View>
              </>
            ) : (
              <View style={s.tRow}><Text>IGST</Text><Text>{R(m.totals.igst)}</Text></View>
            )}
            <View style={s.tRow}><Text>Round off</Text><Text>{formatINR(m.totals.roundOff)}</Text></View>
            <View style={[s.tRow, s.grand]}><Text>Grand Total</Text><Text>{R(m.totals.grand)}</Text></View>
          </View>
        </View>

        <Text style={s.words}>{toWordsIndian(m.totals.grand)}</Text>

        <View style={s.foot}>
          <Text style={{ color: '#94a3b8', fontSize: 7 }}>This is a computer-generated invoice.</Text>
          <Text style={s.bold}>For {m.issuerName}</Text>
        </View>
      </Page>
    </Document>
  )
}

/** Render the invoice to a PDF blob and trigger a browser download. */
export async function downloadInvoicePdf(model: InvoicePdfModel): Promise<void> {
  const blob = await pdf(<InvoiceDoc m={model} />).toBlob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `Invoice-${model.invoiceNo.replace(/[^\w-]/g, '_')}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
