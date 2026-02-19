/**
 * app.js — Money Muling Detection Engine Frontend
 *
 * Handles: CSV upload, API integration, result rendering, and interactive network graph.
 */

// ── DOM References ────────────────────────────────────────────
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const fileInfo = document.getElementById('fileInfo');
const fileName = document.getElementById('fileName');
const analyzeBtn = document.getElementById('analyzeBtn');
const errorBanner = document.getElementById('errorBanner');
const loadingOverlay = document.getElementById('loadingOverlay');
const dashboard = document.getElementById('dashboard');

// Summary
const totalAccountsEl = document.getElementById('totalAccounts');
const flaggedAccountsEl = document.getElementById('flaggedAccounts');
const fraudRingsEl = document.getElementById('fraudRings');
const processingTimeEl = document.getElementById('processingTime');

// Tables
const accountsBody = document.getElementById('accountsBody');
const ringsBody = document.getElementById('ringsBody');

// Graph
const graphCanvas = document.getElementById('graphCanvas');
const graphTooltip = document.getElementById('graphTooltip');
const tooltipTitle = document.getElementById('tooltipTitle');
const tooltipContent = document.getElementById('tooltipContent');

// Download
const downloadBtn = document.getElementById('downloadBtn');

// ── State ─────────────────────────────────────────────────────
let selectedFile = null;
let analysisData = null;

// ── File Upload Handling ──────────────────────────────────────
dropzone.addEventListener('click', () => fileInput.click());

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('drag-over');
});

dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('drag-over');
});

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) selectFile(file);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) selectFile(fileInput.files[0]);
});

function selectFile(file) {
  if (!file.name.endsWith('.csv')) {
    showError('Please select a CSV file.');
    return;
  }
  selectedFile = file;
  fileName.textContent = `${file.name} (${formatBytes(file.size)})`;
  fileInfo.classList.add('visible');
  analyzeBtn.disabled = false;
  hideError();
}

// ── Analyze Button ────────────────────────────────────────────
analyzeBtn.addEventListener('click', async () => {
  if (!selectedFile) return;
  
  hideError();
  loadingOverlay.classList.add('active');
  analyzeBtn.disabled = true;

  try {
    const formData = new FormData();
    formData.append('file', selectedFile);

    const response = await fetch('/analyze', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || `Server error: ${response.status}`);
    }

    analysisData = await response.json();
    renderDashboard(analysisData);
  } catch (err) {
    showError(err.message);
  } finally {
    loadingOverlay.classList.remove('active');
    analyzeBtn.disabled = false;
  }
});

// ── Download Button ───────────────────────────────────────────
downloadBtn.addEventListener('click', async () => {
  try {
    const response = await fetch('/download-json');
    if (!response.ok) throw new Error('Download failed');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'analysis_result.json';
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    showError(err.message);
  }
});

// ── Render Dashboard ──────────────────────────────────────────
function renderDashboard(data) {
  // Summary cards
  totalAccountsEl.textContent = data.summary.total_accounts_analyzed.toLocaleString();
  flaggedAccountsEl.textContent = data.summary.suspicious_accounts_flagged.toLocaleString();
  fraudRingsEl.textContent = data.summary.fraud_rings_detected.toLocaleString();
  processingTimeEl.textContent = `${data.summary.processing_time_seconds}s`;

  // Tables
  renderAccountsTable(data.suspicious_accounts);
  renderRingsTable(data.fraud_rings);

  // Graph
  if (data.graph_data) {
    renderGraph(data.graph_data);
  }

  // Show dashboard
  dashboard.classList.add('visible');
  dashboard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Suspicious Accounts Table ─────────────────────────────────
function renderAccountsTable(accounts) {
  accountsBody.innerHTML = '';
  accounts.forEach((acc) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span style="font-family:var(--font-mono);font-weight:600">${esc(acc.account_id)}</span></td>
      <td>${scoreBadge(acc.suspicion_score)}</td>
      <td>${patternTags(acc.detected_patterns)}</td>
      <td>${acc.ring_id ? `<span class="ring-link">${esc(acc.ring_id)}</span>` : '<span style="color:var(--text-muted)">—</span>'}</td>
    `;
    accountsBody.appendChild(tr);
  });
}

// ── Fraud Rings Table ─────────────────────────────────────────
function renderRingsTable(rings) {
  ringsBody.innerHTML = '';
  rings.forEach((ring) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="ring-link">${esc(ring.ring_id)}</span></td>
      <td>${ring.member_accounts.map(m => `<span style="font-family:var(--font-mono);font-size:0.82rem">${esc(m)}</span>`).join(', ')}</td>
      <td>${patternTag(ring.pattern_type)}</td>
      <td>${scoreBadge(ring.risk_score)}</td>
    `;
    ringsBody.appendChild(tr);
  });
}

// ── Table Sorting ─────────────────────────────────────────────
document.querySelectorAll('.data-table th[data-sort]').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    const table = th.closest('table');
    const tbody = table.querySelector('tbody');
    const isAccounts = table.id === 'accountsTable';
    const sourceData = isAccounts ? analysisData.suspicious_accounts : analysisData.fraud_rings;

    // Toggle sort direction
    const dir = th._sortDir === 'asc' ? 'desc' : 'asc';
    th._sortDir = dir;

    const sorted = [...sourceData].sort((a, b) => {
      let va = a[key], vb = b[key];
      if (typeof va === 'number') return dir === 'asc' ? va - vb : vb - va;
      va = (va || '').toString();
      vb = (vb || '').toString();
      return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    });

    if (isAccounts) renderAccountsTable(sorted);
    else renderRingsTable(sorted);
  });
});

// ── Network Graph (Canvas) ────────────────────────────────────
let graphState = {
  nodes: [],
  edges: [],
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  dragging: false,
  dragStartX: 0,
  dragStartY: 0,
  hoveredNode: null,
};

function renderGraph(graphData) {
  const wrapper = document.getElementById('graphWrapper');
  const rect = wrapper.getBoundingClientRect();
  graphCanvas.width = rect.width * window.devicePixelRatio;
  graphCanvas.height = rect.height * window.devicePixelRatio;
  graphCanvas.style.width = rect.width + 'px';
  graphCanvas.style.height = rect.height + 'px';

  const ctx = graphCanvas.getContext('2d');
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

  graphState.nodes = graphData.nodes;
  graphState.edges = graphData.edges;

  // Center the graph
  const canvasW = rect.width;
  const canvasH = rect.height;

  if (graphState.nodes.length > 0) {
    const xs = graphState.nodes.map(n => n.x);
    const ys = graphState.nodes.map(n => n.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const graphW = maxX - minX || 1;
    const graphH = maxY - minY || 1;

    const padding = 80;
    const scaleX = (canvasW - padding * 2) / graphW;
    const scaleY = (canvasH - padding * 2) / graphH;
    graphState.scale = Math.min(scaleX, scaleY, 2);
    graphState.offsetX = canvasW / 2 - (minX + graphW / 2) * graphState.scale;
    graphState.offsetY = canvasH / 2 - (minY + graphH / 2) * graphState.scale;
  }

  graphState._initialScale = graphState.scale;
  graphState._initialOffsetX = graphState.offsetX;
  graphState._initialOffsetY = graphState.offsetY;

  drawGraph(ctx, rect.width, rect.height);
  setupGraphInteractions(ctx, rect.width, rect.height);
}

function drawGraph(ctx, w, h) {
  const { nodes, edges, scale, offsetX, offsetY, hoveredNode } = graphState;

  ctx.clearRect(0, 0, w, h);

  // Build node lookup
  const nodeLookup = {};
  nodes.forEach(n => { nodeLookup[n.id] = n; });

  // Draw edges
  edges.forEach(edge => {
    const src = nodeLookup[edge.source];
    const tgt = nodeLookup[edge.target];
    if (!src || !tgt) return;

    const x1 = src.x * scale + offsetX;
    const y1 = src.y * scale + offsetY;
    const x2 = tgt.x * scale + offsetX;
    const y2 = tgt.y * scale + offsetY;

    // Determine if edge connects suspicious nodes
    const isSuspicious = src.suspicious || tgt.suspicious;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = isSuspicious ?
      'rgba(239, 68, 68, 0.25)' :
      'rgba(148, 163, 184, 0.1)';
    ctx.lineWidth = isSuspicious ? 1.5 : 0.8;
    ctx.stroke();

    // Arrowhead
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const nodeRadius = getNodeRadius(tgt);
    const arrowLen = 8;
    const ax = x2 - Math.cos(angle) * (nodeRadius + 2);
    const ay = y2 - Math.sin(angle) * (nodeRadius + 2);

    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(
      ax - arrowLen * Math.cos(angle - 0.35),
      ay - arrowLen * Math.sin(angle - 0.35)
    );
    ctx.lineTo(
      ax - arrowLen * Math.cos(angle + 0.35),
      ay - arrowLen * Math.sin(angle + 0.35)
    );
    ctx.closePath();
    ctx.fillStyle = isSuspicious ?
      'rgba(239, 68, 68, 0.4)' :
      'rgba(148, 163, 184, 0.2)';
    ctx.fill();
  });

  // Draw nodes
  nodes.forEach(node => {
    const x = node.x * scale + offsetX;
    const y = node.y * scale + offsetY;
    const r = getNodeRadius(node);
    const color = getNodeColor(node);
    const isHovered = hoveredNode && hoveredNode.id === node.id;

    // Glow for suspicious
    if (node.suspicious) {
      const gradient = ctx.createRadialGradient(x, y, r, x, y, r * 3);
      gradient.addColorStop(0, color.replace(')', ', 0.25)').replace('rgb', 'rgba'));
      gradient.addColorStop(1, 'transparent');
      ctx.beginPath();
      ctx.arc(x, y, r * 3, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    // Node circle
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    if (isHovered) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Label (only if scale > threshold to avoid clutter)
    if (scale > 0.4 || isHovered) {
      ctx.font = `${isHovered ? 'bold ' : ''}${isHovered ? 11 : 9}px Inter, sans-serif`;
      ctx.fillStyle = isHovered ? '#f1f5f9' : 'rgba(241, 245, 249, 0.6)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(node.id, x, y + r + 4);
    }
  });
}

function getNodeRadius(node) {
  if (!node.suspicious) return 5;
  const score = node.suspicion_score || 0;
  return 6 + (score / 100) * 8; // 6–14
}

function getNodeColor(node) {
  if (!node.suspicious) return '#2dd4bf';
  const score = node.suspicion_score || 0;
  if (score >= 70) return '#ef4444';
  if (score >= 40) return '#f97316';
  return '#fbbf24';
}

function setupGraphInteractions(ctx, w, h) {
  let isPanning = false;
  let panStartX, panStartY;

  // Pan
  graphCanvas.addEventListener('mousedown', (e) => {
    isPanning = true;
    panStartX = e.offsetX;
    panStartY = e.offsetY;
    graphCanvas.style.cursor = 'grabbing';
  });

  graphCanvas.addEventListener('mousemove', (e) => {
    if (isPanning) {
      graphState.offsetX += e.offsetX - panStartX;
      graphState.offsetY += e.offsetY - panStartY;
      panStartX = e.offsetX;
      panStartY = e.offsetY;
      drawGraph(ctx, w, h);
      return;
    }

    // Hover detection
    const mx = e.offsetX;
    const my = e.offsetY;
    let found = null;

    for (const node of graphState.nodes) {
      const nx = node.x * graphState.scale + graphState.offsetX;
      const ny = node.y * graphState.scale + graphState.offsetY;
      const r = getNodeRadius(node) + 4;
      if ((mx - nx) ** 2 + (my - ny) ** 2 <= r ** 2) {
        found = node;
        break;
      }
    }

    if (found !== graphState.hoveredNode) {
      graphState.hoveredNode = found;
      drawGraph(ctx, w, h);

      if (found) {
        graphCanvas.style.cursor = 'pointer';
        showTooltip(e, found);
      } else {
        graphCanvas.style.cursor = 'grab';
        graphTooltip.classList.remove('visible');
      }
    } else if (found) {
      // Update tooltip position
      positionTooltip(e);
    }
  });

  graphCanvas.addEventListener('mouseup', () => {
    isPanning = false;
    graphCanvas.style.cursor = graphState.hoveredNode ? 'pointer' : 'grab';
  });

  graphCanvas.addEventListener('mouseleave', () => {
    isPanning = false;
    graphState.hoveredNode = null;
    drawGraph(ctx, w, h);
    graphTooltip.classList.remove('visible');
  });

  // Zoom
  graphCanvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const mx = e.offsetX;
    const my = e.offsetY;

    graphState.offsetX = mx - (mx - graphState.offsetX) * zoomFactor;
    graphState.offsetY = my - (my - graphState.offsetY) * zoomFactor;
    graphState.scale *= zoomFactor;

    drawGraph(ctx, w, h);
  }, { passive: false });

  // Zoom buttons
  document.getElementById('zoomIn').addEventListener('click', () => {
    const cx = w / 2;
    const cy = h / 2;
    graphState.offsetX = cx - (cx - graphState.offsetX) * 1.2;
    graphState.offsetY = cy - (cy - graphState.offsetY) * 1.2;
    graphState.scale *= 1.2;
    drawGraph(ctx, w, h);
  });

  document.getElementById('zoomOut').addEventListener('click', () => {
    const cx = w / 2;
    const cy = h / 2;
    graphState.offsetX = cx - (cx - graphState.offsetX) * 0.8;
    graphState.offsetY = cy - (cy - graphState.offsetY) * 0.8;
    graphState.scale *= 0.8;
    drawGraph(ctx, w, h);
  });

  document.getElementById('resetView').addEventListener('click', () => {
    graphState.scale = graphState._initialScale;
    graphState.offsetX = graphState._initialOffsetX;
    graphState.offsetY = graphState._initialOffsetY;
    drawGraph(ctx, w, h);
  });

  graphCanvas.style.cursor = 'grab';
}

function showTooltip(e, node) {
  tooltipTitle.textContent = node.id;
  let html = '';
  html += tooltipRow('Score', node.suspicious ? node.suspicion_score : 'Clean');
  html += tooltipRow('In Degree', node.in_degree);
  html += tooltipRow('Out Degree', node.out_degree);
  if (node.patterns && node.patterns.length > 0) {
    html += tooltipRow('Patterns', node.patterns.join(', '));
  }
  if (node.ring_id) {
    html += tooltipRow('Ring', node.ring_id);
  }
  tooltipContent.innerHTML = html;
  graphTooltip.classList.add('visible');
  positionTooltip(e);
}

function positionTooltip(e) {
  const wrapper = document.getElementById('graphWrapper');
  const rect = wrapper.getBoundingClientRect();
  let left = e.clientX - rect.left + 16;
  let top = e.clientY - rect.top + 16;

  // Clamp to wrapper
  const tw = graphTooltip.offsetWidth;
  const th = graphTooltip.offsetHeight;
  if (left + tw > rect.width) left = left - tw - 32;
  if (top + th > rect.height) top = top - th - 32;

  graphTooltip.style.left = left + 'px';
  graphTooltip.style.top = top + 'px';
}

function tooltipRow(label, value) {
  return `<div class="graph-tooltip__row">
    <span class="graph-tooltip__label">${label}</span>
    <span class="graph-tooltip__value">${value}</span>
  </div>`;
}

// ── Helpers ───────────────────────────────────────────────────
function scoreBadge(score) {
  let cls = 'low';
  if (score >= 70) cls = 'critical';
  else if (score >= 50) cls = 'high';
  else if (score >= 25) cls = 'medium';
  return `<span class="score-badge score-badge--${cls}">${score}</span>`;
}

function patternTags(patterns) {
  return patterns.map(p => patternTag(p)).join('');
}

function patternTag(pattern) {
  let cls = 'default';
  if (pattern.includes('cycle')) cls = 'cycle';
  else if (pattern.includes('smurf')) cls = 'smurfing';
  else if (pattern.includes('shell')) cls = 'shell';
  return `<span class="pattern-tag pattern-tag--${cls}">${esc(pattern)}</span>`;
}

function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.classList.add('visible');
}

function hideError() {
  errorBanner.classList.remove('visible');
}

function esc(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}
