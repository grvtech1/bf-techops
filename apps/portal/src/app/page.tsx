"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

interface OpsSummary {
  release: string;
  environment: string;
  invoices: number;
  payments: number;
  refunds: number;
  pendingOutbox: number;
  processingOutbox: number;
  successfulDeliveries: number;
  deadLetters: number;
  oldestPendingOutboxAt: string | null;
  generatedAt: string;
}

interface Invoice {
  id: string;
  storeId: string;
  status: string;
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  issuedAt: string;
  version: number;
}

interface Store {
  id: string;
  merchantId: string;
  code: string;
  name: string;
  timezone: string;
}

interface Payment {
  id: string;
  invoiceId: string;
  provider: string;
  providerPaymentId: string;
  amountMinor: number;
  refundedMinor: number;
  currency: string;
  status: string;
  capturedAt: string;
}

interface AuditEvent {
  id: string;
  actorSubject: string;
  action: string;
  resourceType: string;
  resourceId: string;
  createdAt: string;
}

export default function OperationsPage() {
  const [summary, setSummary] = useState<OpsSummary | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [opsResponse, invoiceResponse, storeResponse, paymentResponse, auditResponse] = await Promise.all([
        fetch("/api/ops", { cache: "no-store" }),
        fetch("/api/invoices", { cache: "no-store" }),
        fetch("/api/stores", { cache: "no-store" }),
        fetch("/api/payments", { cache: "no-store" }),
        fetch("/api/audit", { cache: "no-store" })
      ]);
      if (!opsResponse.ok || !invoiceResponse.ok || !storeResponse.ok || !paymentResponse.ok || !auditResponse.ok) {
        throw new Error("Operations data is unavailable");
      }
      setSummary(await opsResponse.json() as OpsSummary);
      setInvoices(await invoiceResponse.json() as Invoice[]);
      setStores(await storeResponse.json() as Store[]);
      setPayments(await paymentResponse.json() as Payment[]);
      setAuditEvents(await auditResponse.json() as AuditEvent[]);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Operations data is unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function issueInvoice(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/invoices", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": `portal:${crypto.randomUUID()}` },
      body: JSON.stringify({
        storeId: form.get("storeId"),
        customerName: form.get("customerName"),
        customerContact: form.get("customerContact"),
        currency: "INR",
        discountMinor: Number(form.get("discountMinor")),
        taxRateBasisPoints: Number(form.get("taxRateBasisPoints")),
        items: [{
          description: form.get("description"),
          quantity: Number(form.get("quantity")),
          unitPriceMinor: Number(form.get("unitPriceMinor"))
        }]
      })
    });
    if (!response.ok) {
      const body = await response.json() as { message?: string; error?: string };
      setError(body.message ?? body.error ?? "Invoice could not be issued");
    } else {
      event.currentTarget.reset();
      await refresh();
    }
    setSubmitting(false);
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brandMark">MP</span><span>Merchant Platform</span></div>
        <nav aria-label="Primary navigation">
          <a className="navItem active" href="#overview">Overview</a>
          <a className="navItem" href="#invoices">Invoices</a>
          <a className="navItem" href="#payments">Payments</a>
          <a className="navItem" href="#audit">Audit</a>
        </nav>
        <div className="sidebarFooter">
          <span className="environment">{summary?.environment?.toUpperCase() ?? "CHECKING"}</span>
          <span className="release">{summary?.release ?? "checking"}</span>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div><p className="eyebrow">OPERATIONS</p><h1>Merchant billing</h1></div>
          <button className="secondaryButton" type="button" onClick={() => void refresh()} disabled={loading}>Refresh</button>
        </header>

        {error && <div className="errorBanner" role="alert">{error}</div>}

        <section id="overview" className="metricsBand" aria-label="Platform overview">
          <Metric label="Invoices" value={summary?.invoices} tone="neutral" />
          <Metric label="Payments" value={summary?.payments} tone="active" />
          <Metric label="Refunds" value={summary?.refunds} tone="neutral" />
          <Metric label="Pending outbox" value={summary?.pendingOutbox} tone="warning" />
          <Metric label="Delivered" value={summary?.successfulDeliveries} tone="active" />
          <Metric label="Dead letters" value={summary?.deadLetters} tone="critical" />
        </section>

        <div className="workspace">
          <section id="invoices" className="tableSection">
            <div className="sectionHeader">
              <div><p className="eyebrow">LATEST ACTIVITY</p><h2>Invoices</h2></div>
              <span className="timestamp">{summary ? formatTime(summary.generatedAt) : ""}</span>
            </div>
            <div className="tableWrap">
              <table>
                <thead><tr><th>Invoice</th><th>Status</th><th>Amount</th><th>Issued</th></tr></thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td><span className="mono">{invoice.id.slice(0, 8)}</span><small>{invoice.storeId.slice(0, 8)}</small></td>
                      <td><span className="statusBadge">{invoice.status}</span></td>
                      <td>{money(invoice.totalMinor, invoice.currency)}</td>
                      <td>{formatTime(invoice.issuedAt)}</td>
                    </tr>
                  ))}
                  {!loading && invoices.length === 0 && <tr><td className="empty" colSpan={4}>No invoices issued</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className="invoiceTool" aria-labelledby="issue-heading">
            <div className="sectionHeader"><div><p className="eyebrow">AUTHORIZED STORE</p><h2 id="issue-heading">Issue invoice</h2></div></div>
            <form onSubmit={(event) => void issueInvoice(event)}>
              <label>Store
                <select name="storeId" required defaultValue="">
                  <option value="" disabled>Select a store</option>
                  {stores.map((store) => <option key={store.id} value={store.id}>{store.name} ({store.code})</option>)}
                </select>
              </label>
              <label>Customer name<input name="customerName" maxLength={160} required defaultValue="Aarav Sharma" /></label>
              <label>Customer email<input name="customerContact" type="email" maxLength={254} required defaultValue="aarav@example.test" /></label>
              <label>Line item<input name="description" maxLength={240} required defaultValue="Retail order" /></label>
              <div className="formGrid">
                <label>Quantity<input name="quantity" type="number" min="1" max="10000" required defaultValue="1" /></label>
                <label>Unit price (paise)<input name="unitPriceMinor" type="number" min="0" required defaultValue="12500" /></label>
              </div>
              <div className="formGrid">
                <label>Discount (paise)<input name="discountMinor" type="number" min="0" required defaultValue="0" /></label>
                <label>Tax (basis points)<input name="taxRateBasisPoints" type="number" min="0" max="10000" required defaultValue="1800" /></label>
              </div>
              <button className="primaryButton" type="submit" disabled={submitting || stores.length === 0}>{submitting ? "Issuing..." : "Issue invoice"}</button>
            </form>
          </section>
        </div>

        <div className="activityGrid">
          <section id="payments" className="tableSection">
            <div className="sectionHeader"><div><p className="eyebrow">FINANCIAL EVENTS</p><h2>Payments</h2></div></div>
            <div className="tableWrap">
              <table>
                <thead><tr><th>Payment</th><th>Status</th><th>Captured</th><th>Refunded</th></tr></thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.id}>
                      <td><span className="mono">{payment.providerPaymentId}</span><small>{payment.invoiceId.slice(0, 8)}</small></td>
                      <td><span className="statusBadge">{payment.status}</span></td>
                      <td>{money(payment.amountMinor, payment.currency)}</td>
                      <td>{money(payment.refundedMinor, payment.currency)}</td>
                    </tr>
                  ))}
                  {!loading && payments.length === 0 && <tr><td className="empty" colSpan={4}>No captured payments</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section id="audit" className="tableSection">
            <div className="sectionHeader"><div><p className="eyebrow">APPEND-ONLY HISTORY</p><h2>Audit events</h2></div></div>
            <div className="tableWrap">
              <table>
                <thead><tr><th>Action</th><th>Resource</th><th>Actor</th><th>Time</th></tr></thead>
                <tbody>
                  {auditEvents.map((event) => (
                    <tr key={event.id}>
                      <td>{event.action}</td>
                      <td><span className="mono">{event.resourceId.slice(0, 12)}</span><small>{event.resourceType}</small></td>
                      <td>{event.actorSubject}</td>
                      <td>{formatTime(event.createdAt)}</td>
                    </tr>
                  ))}
                  {!loading && auditEvents.length === 0 && <tr><td className="empty" colSpan={4}>No audit events</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <section id="deliveries" className="reliabilityBand">
          <div><p className="eyebrow">DELIVERY PIPELINE</p><h2>Outbox health</h2></div>
          <div className="healthItem"><span>Oldest pending</span><strong>{age(summary?.oldestPendingOutboxAt)}</strong></div>
          <div className="healthItem"><span>Queue state</span><strong className={summary?.deadLetters ? "criticalText" : "healthyText"}>{summary?.deadLetters ? "Action required" : "Healthy"}</strong></div>
          <div className="healthItem"><span>Release</span><strong className="mono">{summary?.release ?? "unknown"}</strong></div>
        </section>
      </main>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value?: number; tone: string }) {
  return <div className={`metric ${tone}`}><span>{label}</span><strong>{value ?? "-"}</strong></div>;
}

function money(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(minor / 100);
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function age(value: string | null | undefined): string {
  if (!value) return "No backlog";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
}
