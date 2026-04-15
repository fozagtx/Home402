import http from "http";
import { RealEstateAgent } from "./agent";

export class Dashboard {
  private agent: RealEstateAgent;
  private port: number;

  constructor(agent: RealEstateAgent, port = 3000) {
    this.agent = agent;
    this.port = port;
  }

  start(): void {
    const server = http.createServer(async (req, res) => {
      if (req.url === "/api/balance") {
        const balance = await this.agent.getLocus().getBalance();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(balance || { error: "Failed to fetch" }));
        return;
      }

      if (req.url === "/api/leads") {
        const report = this.agent.getLeadManager().generateReport();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(report));
        return;
      }

      if (req.url === "/api/config") {
        const config = this.agent.getConfig();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          city: config.searchCity,
          state: config.searchState,
          propertyType: config.searchPropertyType,
          radius: config.searchRadius,
          scoreThreshold: config.leadScoreThreshold,
        }));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(this.renderHtml());
    });

    server.listen(this.port, () => {
      console.log(`Dashboard running at http://localhost:${this.port}`);
    });
  }

  private renderHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Home402 Dashboard</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e0e0e0; min-height: 100vh; }
.container { max-width: 1200px; margin: 0 auto; padding: 24px; }
header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; border-bottom: 1px solid #1a1a1a; padding-bottom: 16px; }
header h1 { font-size: 24px; font-weight: 700; }
header h1 span { color: #6366f1; }
header .status { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #888; }
header .dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; animation: pulse 2s infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin-bottom: 32px; }
.card { background: #111; border: 1px solid #1a1a1a; border-radius: 12px; padding: 20px; }
.card .label { font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
.card .value { font-size: 28px; font-weight: 700; }
.card .value.green { color: #22c55e; }
.card .value.purple { color: #6366f1; }
.card .value.amber { color: #f59e0b; }
.card .sub { font-size: 12px; color: #555; margin-top: 4px; }
.section { margin-bottom: 32px; }
.section h2 { font-size: 16px; font-weight: 600; margin-bottom: 16px; color: #ccc; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; font-size: 11px; color: #555; text-transform: uppercase; letter-spacing: 0.5px; padding: 8px 12px; border-bottom: 1px solid #1a1a1a; }
td { padding: 12px; font-size: 13px; border-bottom: 1px solid #111; }
tr:hover { background: #111; }
.score-bar { width: 60px; height: 6px; background: #1a1a1a; border-radius: 3px; overflow: hidden; display: inline-block; vertical-align: middle; margin-right: 8px; }
.score-fill { height: 100%; border-radius: 3px; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 500; }
.badge.scored { background: #1a1a2e; color: #6366f1; }
.badge.sent { background: #1a2e1a; color: #22c55e; }
.badge.responded { background: #2e2a1a; color: #f59e0b; }
.badge.lost { background: #2e1a1a; color: #ef4444; }
.badge.discovered { background: #1a1a1a; color: #888; }
.badge.enriched { background: #1a1a2e; color: #818cf8; }
.badge.outreach_queued { background: #1a2a2e; color: #22d3ee; }
.badge.qualified { background: #1a2e1a; color: #4ade80; }
.refresh-btn { background: #1a1a1a; border: 1px solid #222; color: #888; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 12px; }
.refresh-btn:hover { background: #222; color: #ccc; }
.empty { text-align: center; padding: 48px; color: #444; }
.empty p { font-size: 14px; margin-bottom: 8px; }
.empty .hint { font-size: 12px; color: #333; }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>Home<span>402</span> Dashboard</h1>
    <div class="status">
      <div class="dot"></div>
      <span id="status-text">Connecting...</span>
      <button class="refresh-btn" onclick="refresh()">Refresh</button>
    </div>
  </header>

  <div class="grid">
    <div class="card">
      <div class="label">USDC Balance</div>
      <div class="value green" id="balance">--</div>
      <div class="sub" id="wallet-addr"></div>
    </div>
    <div class="card">
      <div class="label">Total Leads</div>
      <div class="value purple" id="total-leads">--</div>
      <div class="sub" id="avg-score"></div>
    </div>
    <div class="card">
      <div class="label">Search Area</div>
      <div class="value amber" id="search-area">--</div>
      <div class="sub" id="search-type"></div>
    </div>
    <div class="card">
      <div class="label">Score Threshold</div>
      <div class="value" id="threshold">--</div>
      <div class="sub">Minimum for outreach</div>
    </div>
  </div>

  <div class="section">
    <h2>Pipeline Breakdown</h2>
    <div class="grid" id="pipeline-grid"></div>
  </div>

  <div class="section">
    <h2>Top Leads</h2>
    <table>
      <thead>
        <tr><th>Score</th><th>Address</th><th>Value</th><th>Rent</th><th>Owner</th><th>Status</th></tr>
      </thead>
      <tbody id="leads-body">
        <tr><td colspan="6" class="empty"><p>Loading...</p></td></tr>
      </tbody>
    </table>
  </div>
</div>

<script>
async function refresh() {
  try {
    const [balance, leads, config] = await Promise.all([
      fetch('/api/balance').then(r => r.json()),
      fetch('/api/leads').then(r => r.json()),
      fetch('/api/config').then(r => r.json()),
    ]);

    document.getElementById('status-text').textContent = 'Live';

    if (balance.balance) {
      document.getElementById('balance').textContent = balance.balance + ' ' + balance.token;
      const addr = balance.wallet_address || '';
      document.getElementById('wallet-addr').textContent = addr.substring(0,10) + '...' + addr.substring(addr.length-6);
    } else {
      document.getElementById('balance').textContent = 'Error';
    }

    document.getElementById('total-leads').textContent = leads.total || '0';
    document.getElementById('avg-score').textContent = leads.total > 0 ? 'Avg score: ' + leads.averageScore : 'No leads yet';
    document.getElementById('search-area').textContent = config.city + ', ' + config.state;
    document.getElementById('search-type').textContent = config.propertyType + ' | ' + config.radius + 'mi radius';
    document.getElementById('threshold').textContent = config.scoreThreshold;

    const pipelineGrid = document.getElementById('pipeline-grid');
    const statusColors = { discovered:'#888', enriched:'#818cf8', scored:'#6366f1', outreach_queued:'#22d3ee', outreach_sent:'#22c55e', owner_responded:'#f59e0b', qualified:'#4ade80', lost:'#ef4444' };
    if (leads.byStatus && Object.keys(leads.byStatus).length > 0) {
      pipelineGrid.innerHTML = Object.entries(leads.byStatus).map(([status, count]) =>
        '<div class="card"><div class="label">' + status.replace(/_/g,' ') + '</div><div class="value" style="color:' + (statusColors[status]||'#888') + '">' + count + '</div></div>'
      ).join('');
    } else {
      pipelineGrid.innerHTML = '<div class="card"><div class="label">Pipeline</div><div class="empty"><p>No leads yet</p><div class="hint">Use /search in Telegram to find properties</div></div></div>';
    }

    const tbody = document.getElementById('leads-body');
    if (leads.topLeads && leads.topLeads.length > 0) {
      tbody.innerHTML = leads.topLeads.map(lead => {
        const pct = Math.min(lead.score, 100);
        const color = pct >= 70 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444';
        const addr = lead.property.address || lead.property.id;
        const val = lead.valueEstimate ? '$' + lead.valueEstimate.price.toLocaleString() : 'N/A';
        const rent = lead.rentalEstimate ? '$' + lead.rentalEstimate.rent.toLocaleString() + '/mo' : 'N/A';
        const owner = lead.ownerVerification?.name || 'Unknown';
        return '<tr><td><span class="score-bar"><span class="score-fill" style="width:'+pct+'%;background:'+color+'"></span></span>'+lead.score+'</td><td>'+addr+'</td><td>'+val+'</td><td>'+rent+'</td><td>'+owner+'</td><td><span class="badge '+lead.status+'">'+lead.status.replace(/_/g,' ')+'</span></td></tr>';
      }).join('');
    } else {
      tbody.innerHTML = '<tr><td colspan="6" class="empty"><p>No leads found yet</p><div class="hint">Message @home_402_bot on Telegram to start hunting</div></td></tr>';
    }
  } catch (err) {
    document.getElementById('status-text').textContent = 'Error';
    console.error(err);
  }
}
refresh();
setInterval(refresh, 30000);
</script>
</body>
</html>`;
  }
}
