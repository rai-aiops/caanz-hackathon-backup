"use client";

import { useEffect, useState } from "react";
import type { KpiData } from "@/lib/kpiMetrics";

export function KpiPanel({ revision, onToggleTheme, theme }: {
  revision: number;
  onToggleTheme: () => void;
  theme: "dark" | "light";
}) {
  const [data, setData] = useState<KpiData | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let disposed = false;
    let pending = false;
    const controller = new AbortController();
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch("/api/kpis", { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "KPI data unavailable");
        if (!disposed) { setData(result as KpiData); setError(""); }
      } catch (failure) {
        if (!disposed) setError(failure instanceof Error ? failure.message : String(failure));
      } finally { pending = false; }
    };
    void load();
    const timer = window.setInterval(() => void load(), 10000);
    return () => { disposed = true; controller.abort(); window.clearInterval(timer); };
  }, [revision, refresh]);

  const rows = data?.metrics.filter((metric) => filter === "all" || (filter === "live" ? metric.connected : !metric.connected));
  return <section className="kpi-panel" aria-label="Client KPIs">
    <header className="workbench-toolbar">
      <div className="toolbar-title"><div className="eyebrow">CAANZ · PRD Section 1.3</div><h2>Client KPIs</h2></div>
      <div className="header-actions">
        <button className="refresh-button" onClick={() => setRefresh((value) => value + 1)}>Refresh KPIs</button>
        <button className="theme-toggle" onClick={onToggleTheme}>{theme === "dark" ? "Light" : "Dark"}</button>
      </div>
    </header>
    <p className="kpi-scope">Current values use synthetic runtime tickets and locally saved traces, refreshed every 10 seconds. Runtime resets replace ticket observations; saved traces remain across resets. Baselines and targets come from the PRD. Knowledge utilization uses runs with source-contribution reports; older runs without reports are excluded. Connected values are proxies, with their limits explained below.</p>
    <div className="kpi-controls">
      <p className="kpi-scope" aria-live="polite">{data ? `${data.ticket_count} current tickets · ${data.completed_trace_count} ended traces · ${data.running_trace_count} running traces excluded · Updated ${new Date(data.generated_at).toLocaleTimeString()}` : error ? "KPI data unavailable" : "Loading KPI data…"}</p>
      <label>Show <select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter KPIs">
        <option value="all">All {data?.metrics.length ?? 11} KPIs</option><option value="live">Connected proxies</option><option value="gaps">Measurement gaps</option>
      </select></label>
    </div>
    {error ? <p role="alert">{error}{data ? " Previous values may be stale." : ""}</p> : null}
    {data ? <div className="kpi-table-scroll"><table className="kpi-table">
      <thead><tr><th scope="col">KPI</th><th scope="col">Baseline</th><th scope="col">Target</th><th scope="col">Current</th><th scope="col">Measurement</th></tr></thead>
      <tbody>{rows?.map((metric) => <tr key={metric.name} className={metric.connected ? "kpi-connected" : undefined}>
        <th scope="row">{metric.name}<span className="kpi-label">{metric.connected ? "Connected · Proxy" : "Measurement gap"}</span></th>
        <td>{metric.baseline}</td><td>{metric.target}</td><td className="kpi-current">{metric.value}</td>
        <td><details><summary>{metric.connected ? "How it is calculated" : "What is needed"}</summary><p>{metric.note}</p></details></td>
      </tr>)}</tbody>
    </table></div> : null}
  </section>;
}
