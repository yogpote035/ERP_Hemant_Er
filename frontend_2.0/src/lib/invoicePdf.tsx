/* eslint-disable react-refresh/only-export-components -- lazy-imported PDF utility module, not a fast-refresh route */
/**
 * invoicePdf.tsx — the GST tax-invoice PDF (plan P4), rendered client-side with
 * @react-pdf/renderer in the **client format** (matches the real HEW invoice).
 * Dynamic-imported from the Billing page so the heavy renderer never lands in the
 * main bundle. Takes a plain `InvoiceDocModel` (built by selectors) — no store access.
 */
import { Document, Page, View, Text, StyleSheet, pdf } from '@react-pdf/renderer'
import { formatINR, type Paise } from './money'
import { packingLineLabel, packingTotal, type InvoiceDocModel } from '@/selectors/invoiceCompute'

const R = (p: Paise) => `₹ ${formatINR(p)}`

const C = { line: '#94a3b8', soft: '#cbd5e1', head: '#f1f5f9', ink: '#0f172a', sub: '#475569', faint: '#64748b', brand: '#1e3a8a' }

const s = StyleSheet.create({
  page: { padding: 24, fontSize: 8, color: C.ink, fontFamily: 'Helvetica' },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', borderBottomWidth: 1.5, borderColor: C.ink, paddingBottom: 5 },
  title: { fontSize: 15, fontFamily: 'Helvetica-Bold', letterSpacing: 1 },
  titleSub: { fontSize: 5.6, color: C.faint, fontFamily: 'Helvetica-Bold', letterSpacing: 1.6, marginTop: 1.5 },
  origTag: { fontSize: 5.5, color: C.sub, fontFamily: 'Helvetica-Bold', borderWidth: 0.7, borderColor: C.line, paddingHorizontal: 3, paddingVertical: 1.5, marginBottom: 2.5, letterSpacing: 0.8 },
  statute: { fontSize: 6.5, color: C.faint, textAlign: 'right' },
  box: { borderWidth: 1, borderColor: C.soft, borderTopWidth: 0 },
  row: { flexDirection: 'row' },
  half: { width: '50%', padding: 5 },
  vr: { borderRightWidth: 1, borderColor: C.soft },
  brand: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.brand, marginBottom: 1 },
  kv: { flexDirection: 'row', marginTop: 1 },
  kvK: { color: C.faint, width: 78 },
  bold: { fontFamily: 'Helvetica-Bold' },
  sectLabel: { fontSize: 6.5, color: C.faint, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', marginBottom: 2 },
  th: { backgroundColor: C.head, fontFamily: 'Helvetica-Bold', fontSize: 6.8, color: C.sub },
  cell: { padding: 3, borderRightWidth: 1, borderColor: C.soft },
  trow: { flexDirection: 'row', borderTopWidth: 1, borderColor: C.soft },
  right: { textAlign: 'right' },
  spec: { marginTop: 0.5 },
  specK: { fontFamily: 'Helvetica-Bold', color: C.sub },
  totRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 1 },
  grand: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.ink, marginTop: 4, marginHorizontal: -5, marginBottom: -5, paddingHorizontal: 5, paddingVertical: 4 },
  grandT: { fontFamily: 'Helvetica-Bold', fontSize: 11, color: '#ffffff' },
  words: { borderWidth: 1, borderColor: C.soft, borderTopWidth: 0, paddingHorizontal: 5, paddingVertical: 3 },
  cert: { borderWidth: 1, borderColor: C.soft, borderTopWidth: 0, padding: 5, fontSize: 6.5, color: C.faint },
  third: { width: '33.33%', padding: 5 },
  sign: { marginTop: 22, color: C.faint },
})

// Column widths (sum 100%).
const COLS = { sr: '4%', desc: '30%', dcno: '12%', dcdt: '11%', hsn: '9%', qty: '11%', rate: '11%', amt: '12%' }

function KV({ k, v }: { k: string; v: string }) {
  return (
    <View style={s.kv}>
      <Text style={s.kvK}>{k}</Text>
      <Text>: {v}</Text>
    </View>
  )
}

const COPY_LABELS = ['ORIGINAL', 'DUPLICATE', 'TRIPLICATE', 'EXTRA'] as const

function InvoicePage({ m, copyLabel }: { m: InvoiceDocModel; copyLabel: typeof COPY_LABELS[number] }) {
  const intra = m.taxKind === 'cgst_sgst'
  const half = m.uniformGstPct != null ? m.uniformGstPct / 2 : undefined
  return (
      <Page size="A4" style={s.page}>
        {/* Title */}
        <View style={s.titleRow}>
          <View>
            <Text style={s.title}>TAX INVOICE</Text>
            <Text style={s.titleSub}>GOODS & SERVICES TAX</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={s.origTag}>{copyLabel}</Text>
            <Text style={s.statute}>U/s 31 of CGST & SGST Act{'\n'}R.W Section 20 of IGST Act</Text>
          </View>
        </View>

        {/* Supplier + meta */}
        <View style={[s.box, s.row]}>
          <View style={[s.half, s.vr]}>
            <Text style={s.brand}>{m.issuerName}</Text>
            {m.issuerAddress.map((l, i) => <Text key={i} style={{ color: C.sub }}>{l}</Text>)}
            <KV k="GSTIN/UIN" v={m.issuerGstin || '—'} />
            <KV k="State Code" v={m.issuerState || '—'} />
            <KV k="PAN No" v={m.issuerPan || '—'} />
            <KV k="MSME No" v="—" />
          </View>
          <View style={s.half}>
            <KV k="Invoice No" v={m.invoiceNo} />
            <KV k="Invoice Date" v={m.invoiceDate} />
            <KV k="PO / Jobwork No" v={m.poJobworkNo || '—'} />
            <KV k="Customer Tax Inv" v={m.custTaxInvoiceNo || '—'} />
            <KV k="E-Way Bill No" v={m.ewayBillNo || '—'} />
            <KV k="Motor Vehicle No" v={m.motorVehicleNo || '—'} />
            <KV k="Transporter" v={m.transporter || '—'} />
            <KV k="Dispatched Through" v={m.dispatchedThrough || '—'} />
            <KV k="Destination" v={m.destination || '—'} />
            <KV k="Terms of Payment" v={m.termsOfPayment || '—'} />
            <KV k="Due Date" v={m.dueDate || '—'} />
          </View>
        </View>

        {/* Dynamic billed-to and shipped-to parties */}
        <View style={[s.box, s.row]} wrap={false}>
          <View style={[s.half, s.vr]}>
            <Text style={s.sectLabel}>Details of Receiver (Billed To)</Text>
            <Text style={s.brand}>{m.custName}</Text>
            {m.custAddress.map((l, i) => <Text key={i} style={{ color: C.sub }}>{l}</Text>)}
            <KV k="GSTIN/UIN" v={m.custGstin || '—'} />
            <KV k="State Code" v={m.custState || '—'} />
            <KV k="PAN No" v={m.custPan || '—'} />
            <KV k="Kind Attn." v={m.contactPerson || '—'} />
            <KV k="Contact No" v={m.contactPhone || '—'} />
            <KV k="Freight Charges" v={m.freightTerms || '—'} />
            <KV k="Transit Insurance" v={m.transitInsuranceTerms || '—'} />
          </View>
          <View style={s.half}>
            <Text style={s.sectLabel}>Details of Consignee (Shipped To)</Text>
            <Text style={s.brand}>{m.shipName}</Text>
            {m.shipAddress.map((l, i) => <Text key={i} style={{ color: C.sub }}>{l}</Text>)}
            <KV k="GSTIN/UIN" v={m.shipGstin || '—'} />
            <KV k="State Code" v={m.shipState || '—'} />
            <KV k="PAN No" v={m.shipPan || '—'} />
            <KV k="Email ID" v={m.contactEmail || '—'} />
            <KV k="GST Type" v={m.gstType} />
            <KV k="SEZ" v={m.sez ? 'Yes' : 'No'} />
          </View>
        </View>

        {/* Line table head */}
        <View style={[s.box, s.row, s.th]}>
          <Text style={[s.cell, { width: COLS.sr }]}>Sl</Text>
          <Text style={[s.cell, { width: COLS.desc }]}>Description & Specification of Goods</Text>
          <Text style={[s.cell, { width: COLS.dcno }]}>Customer D.C No</Text>
          <Text style={[s.cell, { width: COLS.dcdt }]}>D.C Date</Text>
          <Text style={[s.cell, { width: COLS.hsn }]}>HSN/SAC</Text>
          <Text style={[s.cell, s.right, { width: COLS.qty }]}>Qty (Nos)</Text>
          <Text style={[s.cell, s.right, { width: COLS.rate }]}>Rate</Text>
          <Text style={[s.right, { width: COLS.amt, padding: 3 }]}>Amount</Text>
        </View>

        {/* Line rows — one part, many Customer D.C sub-lines */}
        {m.parts.map((p, i) => (
          <View key={i} style={[s.box, s.row]} wrap={false}>
            <Text style={[s.cell, { width: COLS.sr }]}>{i + 1}</Text>
            <View style={[s.cell, { width: COLS.desc }]}>
              <View style={s.spec}><Text><Text style={s.specK}>Part No:</Text> <Text style={s.bold}>{p.partNo}</Text></Text></View>
              {p.partType ? <Text style={s.spec}><Text style={s.specK}>Part Type:</Text> {p.partType}</Text> : null}
              {p.dieNo ? <Text style={s.spec}><Text style={s.specK}>Die No:</Text> {p.dieNo}</Text> : null}
              {p.drgEdtNo ? <Text style={s.spec}><Text style={s.specK}>Drg Edt No:</Text> {p.drgEdtNo}</Text> : null}
              {p.ircBinNo ? <Text style={s.spec}><Text style={s.specK}>IRC/Bin No:</Text> {p.ircBinNo}</Text> : null}
              {p.heatNos.length ? <Text style={s.spec}><Text style={s.specK}>Heat No:</Text> {p.heatNos.join(', ')}</Text> : null}
              {p.rmSupplier ? <Text style={s.spec}><Text style={s.specK}>RM Supplier:</Text> {p.rmSupplier}</Text> : null}
              {p.finishWeightG != null ? <Text style={s.spec}><Text style={s.specK}>Finish Weight:</Text> {p.finishWeightG} GM</Text> : null}
              {p.packingMode ? <Text style={s.spec}><Text style={s.specK}>Packing Mode:</Text> {p.packingMode}</Text> : null}
            </View>
            <View style={[s.cell, { width: COLS.dcno }]}>{p.dcs.map((d, j) => <Text key={j}>{d.dcNo}</Text>)}</View>
            <View style={[s.cell, { width: COLS.dcdt }]}>{p.dcs.map((d, j) => <Text key={j}>{d.dcDate || '—'}</Text>)}</View>
            <Text style={[s.cell, { width: COLS.hsn }]}>{p.hsnSac || '—'}</Text>
            <View style={[s.cell, s.right, { width: COLS.qty }]}>
              {p.dcs.map((d, j) => <Text key={j}>{d.qty.toLocaleString('en-IN')}</Text>)}
              {p.dcs.length > 1 ? <Text style={s.bold}>{p.totalQty.toLocaleString('en-IN')}</Text> : null}
            </View>
            <View style={[s.cell, s.right, { width: COLS.rate }]}>{p.dcs.map((d, j) => <Text key={j}>{formatINR(d.ratePaise)}</Text>)}</View>
            <View style={[s.right, { width: COLS.amt, padding: 3 }]}>
              {p.dcs.map((d, j) => <Text key={j}>{formatINR(d.amountPaise)}</Text>)}
              {p.dcs.length > 1 ? <Text style={s.bold}>{formatINR(p.totalAmountPaise)}</Text> : null}
            </View>
          </View>
        ))}

        {/* Notes + totals */}
        <View style={[s.box, s.row]}>
          <View style={[{ width: '58%', padding: 5 }, s.vr]}>
            <Text style={s.bold}>Note: Machining charges of your forged rings</Text>
            <Text style={{ color: C.sub }}>1. All material in oiled condition.</Text>
            <Text style={{ color: C.sub }}>2. All material packed in GSP wooden boxes.</Text>
            <Text style={{ color: C.sub }}>3. Sample inspection & MPI report attached.</Text>
            <Text style={[s.sectLabel, { marginTop: 4 }]}>Packing Details</Text>
            {m.packing.length ? (
              <>
                {m.packing.map((b, i) => <Text key={i}>{packingLineLabel(b)}</Text>)}
                <Text style={s.bold}>TOTAL {packingTotal(m.packing).boxes} {packingTotal(m.packing).mode ?? ''}= {packingTotal(m.packing).qty.toLocaleString('en-IN')}</Text>
              </>
            ) : <Text>—</Text>}
          </View>
          <View style={{ width: '42%', padding: 5 }}>
            <View style={s.totRow}><Text>Assessable Value</Text><Text>{R(m.totals.assessable)}</Text></View>
            {intra ? (
              <>
                <View style={s.totRow}><Text>CGST{half != null ? ` @ ${half}%` : ''}</Text><Text>{R(m.totals.cgst)}</Text></View>
                <View style={s.totRow}><Text>SGST{half != null ? ` @ ${half}%` : ''}</Text><Text>{R(m.totals.sgst)}</Text></View>
              </>
            ) : (
              <View style={s.totRow}><Text>IGST{m.uniformGstPct != null ? ` @ ${m.uniformGstPct}%` : ''}</Text><Text>{R(m.totals.igst)}</Text></View>
            )}
            <View style={s.totRow}><Text>Rounding off (+/-)</Text><Text>{formatINR(m.totals.roundOff)}</Text></View>
            <View style={s.grand}><Text style={s.grandT}>Grand Total</Text><Text style={s.grandT}>{R(m.totals.grand)}</Text></View>
          </View>
        </View>

        {/* Amount in words */}
        <View style={s.words}><Text><Text style={s.bold}>Amount (in words): </Text>{m.amountWords}</Text></View>

        {/* Certification */}
        <Text style={s.cert}>
          Certified that the particulars given above are true and correct, that the amount indicated represents
          the price actually charged, and that there is no flow of additional consideration directly or indirectly
          from the buyer.
        </Text>

        {/* T&C + bank + sign */}
        <View style={[s.box, s.row]}>
          <View style={[s.third, s.vr]}>
            <Text style={s.sectLabel}>Terms & Conditions</Text>
            <Text style={{ color: C.sub }}>1. Raise objections within 3 days of receipt.</Text>
            <Text style={{ color: C.sub }}>2. Interest @ 12% p.a. on overdue bills.</Text>
            <Text style={{ color: C.sub }}>3. Subject to Pune jurisdiction.</Text>
          </View>
          <View style={[s.third, s.vr]}>
            <Text style={s.sectLabel}>Our Bank Details</Text>
            {m.issuerBank?.name ? (
              <>
                <Text>{m.issuerBank.name}</Text>
                {m.issuerBank.branch ? <Text>Branch {m.issuerBank.branch}</Text> : null}
                <Text>A/c {m.issuerBank.acc || '—'}</Text>
                <Text>IFSC {m.issuerBank.ifsc || '—'}</Text>
              </>
            ) : <Text>—</Text>}
          </View>
          <View style={[s.third, { alignItems: 'flex-end' }]}>
            <Text style={s.bold}>For {m.issuerName}</Text>
            <Text style={s.sign}>Authorised Signatory</Text>
          </View>
        </View>
      </Page>
  )
}

/** One downloadable invoice document always contains the four statutory copies. */
function InvoiceDoc({ m }: { m: InvoiceDocModel }) {
  return (
    <Document>
      {COPY_LABELS.map((copyLabel) => <InvoicePage key={copyLabel} m={m} copyLabel={copyLabel} />)}
    </Document>
  )
}

/** Render the invoice to a PDF blob and trigger a browser download. */
export async function downloadInvoicePdf(model: InvoiceDocModel): Promise<void> {
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
