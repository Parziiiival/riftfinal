/* ═══════════════════════════════════════════════════════════════
   RIFT — Fraud Detection Intelligence Platform
   Main Application Logic
   ═══════════════════════════════════════════════════════════════ */

// ── Global State ──────────────────────────────────────────────────
const State = {
    data: null,
    cy: null,
    allEdges: [],
    legitimateAccounts: new Set(),
    currentMode: 'analyst',
    playInterval: null,
    currentView: 'dashboard',
    comparisonAccounts: [],
    comparisonMode: false,
    presetPositions: {},
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ═══════════════════════════════════════════════════════════════
//  PARTICLE SYSTEM
// ═══════════════════════════════════════════════════════════════

function initParticles() {
    const canvas = document.getElementById('particleCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let particles = [];
    const PARTICLE_COUNT = 60;
    const CONNECT_DIST = 140;

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
        particles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            vx: (Math.random() - 0.5) * 0.4,
            vy: (Math.random() - 0.5) * 0.4,
            r: Math.random() * 2 + 1,
            alpha: Math.random() * 0.4 + 0.1,
        });
    }

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // connections
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < CONNECT_DIST) {
                    ctx.beginPath();
                    ctx.strokeStyle = `rgba(6,214,160,${0.08 * (1 - dist / CONNECT_DIST)})`;
                    ctx.lineWidth = 0.5;
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.stroke();
                }
            }
        }
        // dots
        particles.forEach(p => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(0,180,216,${p.alpha})`;
            ctx.fill();
            p.x += p.vx;
            p.y += p.vy;
            if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
            if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
        });
        requestAnimationFrame(draw);
    }
    draw();
}

// ═══════════════════════════════════════════════════════════════
//  SCROLL REVEAL ANIMATIONS
// ═══════════════════════════════════════════════════════════════

function initScrollAnimations() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    document.querySelectorAll('.animate-on-scroll').forEach(el => observer.observe(el));
}

// ═══════════════════════════════════════════════════════════════
//  PAGE TRANSITIONS
// ═══════════════════════════════════════════════════════════════

function showResultsPage() {
    State.currentView = 'results';
    const dv = $('#dashboardView');
    const rv = $('#resultsView');
    const backBtn = $('#backToDashboard');
    dv.classList.remove('active');
    rv.classList.add('active');
    backBtn.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showDashboardPage() {
    State.currentView = 'dashboard';
    const dv = $('#dashboardView');
    const rv = $('#resultsView');
    const backBtn = $('#backToDashboard');
    rv.classList.remove('active');
    dv.classList.add('active');
    backBtn.classList.add('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 1: FILE UPLOAD & VALIDATION
// ═══════════════════════════════════════════════════════════════

function initUpload() {
    const dropZone = $('#dropZone');
    const fileInput = $('#fileInput');

    ['dragenter', 'dragover'].forEach(evt => {
        dropZone.addEventListener(evt, e => { e.preventDefault(); dropZone.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(evt => {
        dropZone.addEventListener(evt, e => { e.preventDefault(); dropZone.classList.remove('dragover'); });
    });

    dropZone.addEventListener('drop', e => {
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    });

    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
        if (fileInput.files[0]) handleFile(fileInput.files[0]);
    });
}

function handleFile(file) {
    if (!file.name.endsWith('.csv')) {
        showValidation([{ pass: false, msg: 'File must be a .csv file' }], 0);
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target.result;
        validateAndPreview(text, file.name, file.size);
    };
    reader.readAsText(file);

    // Store file for analysis
    State.uploadedFile = file;
}

function validateAndPreview(csv, fileName, fileSize) {
    const lines = csv.trim().split('\n');
    if (lines.length < 2) {
        showValidation([{ pass: false, msg: 'CSV has no data rows' }], 0);
        return;
    }

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const required = ['transaction_id', 'sender_id', 'receiver_id', 'amount', 'timestamp'];
    const checks = [];
    let score = 0;

    // Column checks
    const missing = required.filter(r => !headers.includes(r));
    if (missing.length === 0) {
        checks.push({ pass: true, msg: `✓ All required columns present (${required.join(', ')})` });
        score += 30;
    } else {
        checks.push({ pass: false, msg: `✗ Missing columns: ${missing.join(', ')}` });
    }

    // Row count
    const rowCount = lines.length - 1;
    if (rowCount <= 13000) {
        checks.push({ pass: true, msg: `✓ ${rowCount.toLocaleString()} transactions (≤ 13,000 limit)` });
        score += 20;
    } else {
        checks.push({ pass: false, msg: `✗ ${rowCount.toLocaleString()} transactions exceeds 13,000 limit` });
    }

    // Check for empty rows
    const emptyRows = lines.filter((l, i) => i > 0 && l.trim() === '').length;
    if (emptyRows === 0) {
        checks.push({ pass: true, msg: '✓ No empty rows detected' });
        score += 15;
    } else {
        checks.push({ pass: 'warn', msg: `⚠ ${emptyRows} empty rows will be skipped` });
        score += 8;
    }

    // Check data quality (sample first 10 rows)
    let badRows = 0;
    const sampleEnd = Math.min(11, lines.length);
    for (let i = 1; i < sampleEnd; i++) {
        const cols = lines[i].split(',');
        if (cols.length < 5) badRows++;
        else {
            const amt = parseFloat(cols[3]);
            if (isNaN(amt) || amt < 0) badRows++;
        }
    }
    if (badRows === 0) {
        checks.push({ pass: true, msg: '✓ Data quality check passed (sample)' });
        score += 20;
    } else {
        checks.push({ pass: 'warn', msg: `⚠ ${badRows} potentially malformed rows in sample` });
        score += 10;
    }

    // Unique accounts
    const senders = new Set();
    const receivers = new Set();
    const txnIdIdx = headers.indexOf('transaction_id');
    const senderIdx = headers.indexOf('sender_id');
    const receiverIdx = headers.indexOf('receiver_id');
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        if (senderIdx >= 0 && cols[senderIdx]) senders.add(cols[senderIdx].trim());
        if (receiverIdx >= 0 && cols[receiverIdx]) receivers.add(cols[receiverIdx].trim());
    }
    const uniqueAccounts = new Set([...senders, ...receivers]);
    checks.push({ pass: true, msg: `✓ ${uniqueAccounts.size} unique accounts detected` });
    score += 15;

    showValidation(checks, Math.min(score, 100));
    showPreview(lines, headers, rowCount, uniqueAccounts.size, fileName, fileSize);
}

function showValidation(checks, score) {
    const panel = $('#validationPanel');
    const results = $('#validationResults');
    panel.classList.remove('hidden');

    results.innerHTML = checks.map(c => {
        const cls = c.pass === true ? 'pass' : (c.pass === 'warn' ? 'warn' : 'fail');
        return `<div class="validation-item ${cls}">${c.msg}</div>`;
    }).join('');

    // Animate health score
    const ring = $('#healthRing');
    const val = $('#healthValue');
    const color = score >= 80 ? '#06d6a0' : score >= 50 ? '#ffd166' : '#ef476f';
    ring.style.stroke = color;
    val.style.color = color;

    let current = 0;
    const interval = setInterval(() => {
        current++;
        if (current > score) { clearInterval(interval); return; }
        ring.setAttribute('stroke-dasharray', `${current}, 100`);
        val.textContent = current;
    }, 20);
}

function showPreview(lines, headers, rowCount, accountCount, fileName, fileSize) {
    const panel = $('#previewPanel');
    panel.classList.remove('hidden');

    // Meta
    $('#previewMeta').innerHTML = `
    <span>📄 ${fileName}</span>
    <span>📊 ${rowCount.toLocaleString()} rows</span>
    <span>👥 ${accountCount} accounts</span>
    <span>💾 ${(fileSize / 1024).toFixed(1)} KB</span>
  `;

    // Table head
    $('#previewHead').innerHTML = headers.map(h => `<th>${h}</th>`).join('');

    // Table body (first 5 rows)
    const tbody = $('#previewBody');
    tbody.innerHTML = '';
    for (let i = 1; i <= Math.min(5, lines.length - 1); i++) {
        const cols = lines[i].split(',');
        const tr = document.createElement('tr');
        tr.innerHTML = cols.map(c => `<td>${c.trim()}</td>`).join('');
        tbody.appendChild(tr);
    }
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 2: API COMMUNICATION
// ═══════════════════════════════════════════════════════════════

async function runAnalysis() {
    if (!State.uploadedFile) {
        console.warn('No file uploaded yet');
        return;
    }

    console.log('Starting analysis for file:', {
        name: State.uploadedFile.name,
        size: State.uploadedFile.size,
        type: State.uploadedFile.type
    });

    showLoading(true);
    const formData = new FormData();
    formData.append('file', State.uploadedFile);

    const fetchUrl = '/analyze';
    console.log('Fetching:', fetchUrl);

    try {
        const res = await fetch(fetchUrl, { method: 'POST', body: formData });
        console.log('Fetch response status:', res.status, res.statusText);
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || 'Analysis failed');
        }
        const data = await res.json();
        console.log('Analysis data received successfully');
        State.data = data;
        State.legitimateAccounts.clear();
        onAnalysisComplete(data);
    } catch (err) {
        showLoading(false);
        console.error('CRITICAL: Fetch failed or error in processing:', err);
        alert('Analysis Error: ' + err.message + '\n\nPlease check the browser console (F12) and the terminal for more details.');
    }

}


function showLoading(show) {
    const overlay = $('#loadingOverlay');
    if (show) {
        overlay.classList.remove('hidden');
        animateLoadingSteps();
    } else {
        overlay.classList.add('hidden');
    }
}

function animateLoadingSteps() {
    const steps = $$('.loading-step');
    steps.forEach(s => { s.classList.remove('active', 'done'); });

    let i = 0;
    const interval = setInterval(() => {
        if (i > 0) steps[i - 1].classList.replace('active', 'done');
        if (i < steps.length) {
            steps[i].classList.add('active');
            i++;
        } else {
            clearInterval(interval);
        }
    }, 400);
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 3: DASHBOARD + INSIGHTS
// ═══════════════════════════════════════════════════════════════

function onAnalysisComplete(data) {
    showLoading(false);

    // Switch to results view
    showResultsPage();

    // Update nav status
    const statusEl = $('#navStatus');
    statusEl.innerHTML = `<span class="status-dot online"></span><span>${data.summary.total_accounts_analyzed} accounts analyzed</span>`;

    // Animate counters
    animateCounter('#statTotalAccounts .stat-value', data.summary.total_accounts_analyzed);
    animateCounter('#statSuspicious .stat-value', data.summary.suspicious_accounts_flagged);
    animateCounter('#statRings .stat-value', data.summary.fraud_rings_detected);
    animateCounter('#statProcessing .stat-value', data.processing_time_seconds, true);

    // Generate insights
    generateInsights(data);

    // Build graph
    buildGraph(data);

    // Build rings table
    buildRingsTable(data);

    // Populate ring filter
    populateRingFilter(data);

    // Build JSON viewer
    updateJsonViewer(data);

    // Setup time-travel
    setupTimeTravel(data);

    // Build risk heatmap
    buildRiskHeatmap(data);

    // Trigger alert notifications
    triggerAnalysisAlerts(data);

    // Set analysis timestamp
    const tsEl = $('#analysisTimestamp');
    if (tsEl) tsEl.textContent = `Analyzed at ${new Date().toLocaleString()}`;
}

function animateCounter(selector, target, isFloat = false) {
    const el = document.querySelector(selector);
    if (!el) return;
    const duration = 1200;
    const start = performance.now();

    function step(now) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const value = target * eased;
        el.textContent = isFloat ? value.toFixed(4) : Math.round(value);
        if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

function generateInsights(data) {
    const list = $('#insightsList');
    const insights = [];

    // Cycle insights
    const cycleRings = data.fraud_rings.filter(r => r.pattern_type === 'cycle');
    if (cycleRings.length > 0) {
        insights.push({
            type: 'danger',
            icon: '🚨',
            text: `Detected ${cycleRings.length} circular money loop${cycleRings.length > 1 ? 's' : ''} — funds cycling between accounts`
        });
    }

    // Smurfing insights
    const smurfRings = data.fraud_rings.filter(r => r.pattern_type === 'smurfing');
    if (smurfRings.length > 0) {
        insights.push({
            type: 'warning',
            icon: '⚠️',
            text: `High-risk fan-out pattern detected in ${smurfRings.length} ring${smurfRings.length > 1 ? 's' : ''} — possible structuring activity`
        });
    }

    // Shell insights
    const shellRings = data.fraud_rings.filter(r => r.pattern_type === 'shell');
    if (shellRings.length > 0) {
        insights.push({
            type: 'danger',
            icon: '🔗',
            text: `${shellRings.length} shell chain${shellRings.length > 1 ? 's' : ''} identified — layered pass-through laundering`
        });
    }

    // High risk accounts
    const highRisk = data.suspicious_accounts.filter(a => a.suspicion_score >= 70);
    if (highRisk.length > 0) {
        insights.push({
            type: 'danger',
            icon: '🎯',
            text: `${highRisk.length} account${highRisk.length > 1 ? 's' : ''} scored above 70 — immediate investigation recommended`
        });
    }

    // Multi-pattern
    const multiPattern = data.suspicious_accounts.filter(a => a.detected_patterns.length >= 3);
    if (multiPattern.length > 0) {
        insights.push({
            type: 'warning',
            icon: '📉',
            text: `${multiPattern.length} account${multiPattern.length > 1 ? 's show' : ' shows'} multi-pattern behavior (3+ detection types)`
        });
    }

    // Performance
    if (data.processing_time_seconds < 1) {
        insights.push({
            type: 'success',
            icon: '⚡',
            text: `Analysis completed in ${(data.processing_time_seconds * 1000).toFixed(0)}ms — all ${data.summary.total_accounts_analyzed} accounts processed`
        });
    }

    // Clean accounts
    const cleanPct = ((1 - data.summary.suspicious_accounts_flagged / data.summary.total_accounts_analyzed) * 100).toFixed(1);
    insights.push({
        type: 'info',
        icon: '📊',
        text: `${cleanPct}% of accounts show no suspicious patterns`
    });

    list.innerHTML = insights.map((ins, i) => `
    <div class="insight-card ${ins.type}" style="animation-delay:${i * 0.1}s">
      <span class="insight-icon">${ins.icon}</span>
      <span>${ins.text}</span>
    </div>
  `).join('');
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 4: GRAPH VISUALIZATION
// ═══════════════════════════════════════════════════════════════

function buildGraph(data) {
    const nodes = data.graph_data.nodes.map(n => ({
        data: {
            id: n.id,
            suspicious: n.suspicious && !State.legitimateAccounts.has(n.id),
            score: n.suspicion_score,
            patterns: n.patterns,
            ringId: n.ring_id,
            inDeg: n.in_degree,
            outDeg: n.out_degree,
            totalDeg: n.in_degree + n.out_degree,
            label: n.id.replace('ACC_', ''),
        },
        position: { x: n.x, y: n.y },
    }));

    const edges = data.graph_data.edges.map(e => ({
        data: {
            id: e.transaction_id,
            source: e.source,
            target: e.target,
            amount: e.amount,
            timestamp: e.timestamp,
            label: `$${e.amount.toLocaleString()}`,
        }
    }));

    State.allEdges = data.graph_data.edges;

    if (State.cy) State.cy.destroy();

    State.cy = cytoscape({
        container: document.getElementById('cyGraph'),
        elements: { nodes, edges },
        style: [
            {
                selector: 'node',
                style: {
                    'label': 'data(label)',
                    'text-valign': 'center',
                    'text-halign': 'center',
                    'font-size': '9px',
                    'font-family': 'Inter, sans-serif',
                    'font-weight': '600',
                    'color': '#e2e8f0',
                    'text-outline-color': '#0a0e17',
                    'text-outline-width': '2px',
                    'background-color': (ele) => getNodeColor(ele.data('score'), ele.data('suspicious')),
                    'width': (ele) => Math.max(25, Math.min(60, 20 + ele.data('totalDeg') * 4)),
                    'height': (ele) => Math.max(25, Math.min(60, 20 + ele.data('totalDeg') * 4)),
                    'border-width': (ele) => ele.data('ringId') ? 3 : 1,
                    'border-color': (ele) => ele.data('ringId') ? '#ef476f' : '#1e293b',
                    'overlay-opacity': 0,
                    'transition-property': 'background-color, border-color, border-width, width, height',
                    'transition-duration': '0.3s',
                }
            },
            {
                selector: 'node[?suspicious]',
                style: {
                    'shadow-blur': '15',
                    'shadow-color': '#ef476f',
                    'shadow-opacity': 0.5,
                    'shadow-offset-x': 0,
                    'shadow-offset-y': 0,
                }
            },
            {
                selector: 'edge',
                style: {
                    'width': (ele) => Math.max(1, Math.min(5, ele.data('amount') / 3000)),
                    'line-color': '#2d3748',
                    'target-arrow-color': '#2d3748',
                    'target-arrow-shape': 'triangle',
                    'curve-style': 'bezier',
                    'arrow-scale': 0.8,
                    'opacity': 0.6,
                    'transition-property': 'line-color, target-arrow-color, opacity',
                    'transition-duration': '0.3s',
                }
            },
            {
                selector: 'edge:selected',
                style: {
                    'line-color': '#00b4d8',
                    'target-arrow-color': '#00b4d8',
                    'opacity': 1,
                    'label': 'data(label)',
                    'font-size': '8px',
                    'color': '#00b4d8',
                    'text-background-color': '#0a0e17',
                    'text-background-opacity': 0.8,
                    'text-background-padding': '3px',
                }
            },
            {
                selector: 'node:selected',
                style: {
                    'border-color': '#00b4d8',
                    'border-width': 4,
                    'shadow-blur': '20',
                    'shadow-color': '#00b4d8',
                    'shadow-opacity': 0.6,
                }
            },
            {
                selector: '.highlighted',
                style: {
                    'background-color': '#ffd166',
                    'border-color': '#ef476f',
                    'border-width': 4,
                    'shadow-blur': '25',
                    'shadow-color': '#ffd166',
                    'shadow-opacity': 0.7,
                    'z-index': 10,
                }
            },
            {
                selector: '.highlighted-edge',
                style: {
                    'line-color': '#ffd166',
                    'target-arrow-color': '#ffd166',
                    'opacity': 1,
                    'width': 3,
                    'z-index': 10,
                }
            },
            {
                selector: '.dimmed',
                style: {
                    'opacity': 0.1,
                }
            },
            {
                selector: '.hidden-node',
                style: {
                    'display': 'none',
                }
            },
        ],
        layout: { name: 'preset' },
        minZoom: 0.2,
        maxZoom: 5,
        wheelSensitivity: 0.3,
    });

    // ── Events ──
    State.cy.on('tap', 'node', (evt) => {
        const nodeId = evt.target.data('id');
        if (State.comparisonMode) {
            addToComparison(nodeId);
        } else {
            openAccountPanel(nodeId);
        }
    });

    State.cy.on('mouseover', 'node', (evt) => {
        evt.target.style('cursor', 'pointer');
        const data = evt.target.data();
        evt.target.popperRefObj = showTooltip(evt, data);
    });

    State.cy.on('mouseout', 'node', () => {
        hideTooltip();
    });

    State.cy.on('mouseover', 'edge', (evt) => {
        const d = evt.target.data();
        evt.target.style({ 'line-color': '#00b4d8', 'target-arrow-color': '#00b4d8', 'opacity': 1 });
    });

    State.cy.on('mouseout', 'edge', (evt) => {
        if (!evt.target.hasClass('highlighted-edge')) {
            evt.target.style({
                'line-color': '#2d3748',
                'target-arrow-color': '#2d3748',
                'opacity': 0.6,
            });
        }
    });

    State.cy.fit(undefined, 40);

    // Save original backend-computed positions for the 'Default' layout
    State.presetPositions = {};
    State.cy.nodes().forEach(node => {
        const pos = node.position();
        State.presetPositions[node.data('id')] = { x: pos.x, y: pos.y };
    });

    // Reset layout dropdown
    const layoutSel = $('#layoutSelect');
    if (layoutSel) layoutSel.value = 'preset';
}

function getNodeColor(score, suspicious) {
    if (!suspicious) return '#374151';
    if (score >= 70) return '#ef476f';
    if (score >= 40) return '#ffd166';
    return '#06d6a0';
}

// Tooltip
let tooltipEl = null;
function showTooltip(evt, data) {
    hideTooltip();
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'graph-tooltip';
    tooltipEl.innerHTML = `
    <strong>${data.id}</strong><br>
    Score: <span style="color:${getNodeColor(data.score, data.suspicious)}">${data.score}</span><br>
    In: ${data.inDeg} | Out: ${data.outDeg}<br>
    ${data.patterns.length ? 'Patterns: ' + data.patterns.join(', ') : 'No patterns'}
  `;
    tooltipEl.style.cssText = `
    position:fixed; z-index:1000; padding:10px 14px; background:rgba(17,24,39,0.95);
    border:1px solid #1e293b; border-radius:8px; font-size:12px; color:#e2e8f0;
    pointer-events:none; font-family:Inter,sans-serif; line-height:1.6;
    box-shadow:0 8px 32px rgba(0,0,0,0.4); backdrop-filter:blur(10px);
  `;
    document.body.appendChild(tooltipEl);

    const renderedPos = evt.renderedPosition || evt.target.renderedPosition();
    tooltipEl.style.left = (renderedPos.x + 20) + 'px';
    tooltipEl.style.top = (renderedPos.y + 80) + 'px';
}

function hideTooltip() {
    if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; }
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 5: GRAPH FILTERS & PATTERN MODES
// ═══════════════════════════════════════════════════════════════

function initGraphControls() {
    // Filter: All vs Suspicious
    $('#filterSelect').addEventListener('change', (e) => {
        applyGraphFilters();
    });

    // Ring filter
    $('#ringFilter').addEventListener('change', (e) => {
        const ringId = e.target.value;
        highlightRing(ringId);
    });

    // Pattern mode
    $('#patternMode').addEventListener('change', (e) => {
        applyPatternMode(e.target.value);
    });

    // Amount filter
    $('#amountFilter').addEventListener('input', (e) => {
        applyGraphFilters();
    });

    // Layout switcher
    $('#layoutSelect').addEventListener('change', (e) => {
        applyLayout(e.target.value);
    });

    // ── Pan Sliders ──
    const panH = $('#graphPanH');
    const panV = $('#graphPanV');
    let panSliderActive = false;

    function panFromSliders() {
        if (!State.cy) return;
        panSliderActive = true;
        const ext = State.cy.extent();
        const cw = State.cy.width();
        const ch = State.cy.height();
        const graphW = ext.w;
        const graphH = ext.h;
        // Map slider 0-100 to pan range
        const hVal = parseInt(panH.value);
        const vVal = parseInt(panV.value);
        const panX = -((hVal / 100) * graphW - cw / 2);
        const panY = -((vVal / 100) * graphH - ch / 2);
        State.cy.pan({ x: panX, y: panY });
        panSliderActive = false;
    }

    panH.addEventListener('input', panFromSliders);
    panV.addEventListener('input', panFromSliders);

    // Fit
    $('#fitGraphBtn').addEventListener('click', () => {
        if (State.cy) {
            State.cy.fit(undefined, 40);
            panH.value = 50;
            panV.value = 50;
        }
    });

    // Reset
    $('#resetGraphBtn').addEventListener('click', () => {
        if (State.cy) {
            State.cy.elements().removeClass('highlighted highlighted-edge dimmed hidden-node');
            $('#filterSelect').value = 'all';
            $('#ringFilter').value = 'all';
            $('#patternMode').value = 'default';
            $('#amountFilter').value = '';
            $('#layoutSelect').value = 'preset';
            panH.value = 50;
            panV.value = 50;
            applyLayout('preset');
        }
    });
}

function applyLayout(layoutName) {
    if (!State.cy) return;

    if (layoutName === 'preset') {
        // Restore original backend-computed positions
        State.cy.nodes().forEach(node => {
            const pos = State.presetPositions[node.data('id')];
            if (pos) node.position(pos);
        });
        State.cy.fit(undefined, 40);
        return;
    }

    const layoutConfigs = {
        cose: {
            name: 'cose',
            animate: true,
            animationDuration: 800,
            nodeRepulsion: () => 6000,
            idealEdgeLength: () => 100,
            edgeElasticity: () => 100,
            gravity: 0.25,
            numIter: 300,
            fit: true,
            padding: 40,
        },
        circle: {
            name: 'circle',
            animate: true,
            animationDuration: 600,
            fit: true,
            padding: 40,
            avoidOverlap: true,
        },
        concentric: {
            name: 'concentric',
            animate: true,
            animationDuration: 600,
            fit: true,
            padding: 40,
            minNodeSpacing: 30,
            concentric: (node) => node.data('suspicious') ? node.data('score') : 0,
            levelWidth: () => 2,
        },
        grid: {
            name: 'grid',
            animate: true,
            animationDuration: 600,
            fit: true,
            padding: 40,
            avoidOverlap: true,
            condense: true,
            rows: undefined,
        },
    };

    const config = layoutConfigs[layoutName];
    if (config) {
        State.cy.layout(config).run();
    }
}

function applyGraphFilters() {
    if (!State.cy) return;

    const filter = $('#filterSelect').value;
    const minAmount = parseFloat($('#amountFilter').value) || 0;

    State.cy.nodes().forEach(node => {
        let show = true;
        if (filter === 'suspicious' && !node.data('suspicious')) show = false;
        node.toggleClass('hidden-node', !show);
    });

    // Filter edges by amount
    State.cy.edges().forEach(edge => {
        edge.toggleClass('hidden-node', edge.data('amount') < minAmount);
    });
}

function populateRingFilter(data) {
    const select = $('#ringFilter');
    select.innerHTML = '<option value="all">All Rings</option>';
    data.fraud_rings.forEach(ring => {
        const opt = document.createElement('option');
        opt.value = ring.ring_id;
        opt.textContent = `${ring.ring_id} (${ring.pattern_type})`;
        select.appendChild(opt);
    });

    // Add ring-specific options to the main filter too
    data.fraud_rings.forEach(ring => {
        const opt = document.createElement('option');
        opt.value = `ring_${ring.ring_id}`;
        opt.textContent = `Ring: ${ring.ring_id}`;
        $('#filterSelect').appendChild(opt);
    });
}

function highlightRing(ringId) {
    if (!State.cy || !State.data) return;

    // Clear existing highlights
    State.cy.elements().removeClass('highlighted highlighted-edge dimmed');

    if (ringId === 'all') return;

    const ring = State.data.fraud_rings.find(r => r.ring_id === ringId);
    if (!ring) return;

    const members = new Set(ring.member_accounts);

    // Dim everything
    State.cy.elements().addClass('dimmed');

    // Highlight ring members
    State.cy.nodes().forEach(node => {
        if (members.has(node.data('id'))) {
            node.removeClass('dimmed').addClass('highlighted');
        }
    });

    // Highlight edges between ring members
    State.cy.edges().forEach(edge => {
        if (members.has(edge.data('source')) && members.has(edge.data('target'))) {
            edge.removeClass('dimmed').addClass('highlighted-edge');
        }
    });

    // Fit to highlighted nodes
    const highlighted = State.cy.nodes('.highlighted');
    if (highlighted.length > 0) {
        State.cy.fit(highlighted, 80);
    }
}

function applyPatternMode(mode) {
    if (!State.cy || !State.data) return;

    State.cy.elements().removeClass('highlighted highlighted-edge dimmed');

    if (mode === 'default') return;

    const patternMap = {
        cycle: 'cycle',
        fanout: 'smurfing',
        shell: 'shell',
    };

    const targetPattern = patternMap[mode];
    if (!targetPattern) return;

    // Dim everything
    State.cy.elements().addClass('dimmed');

    // Highlight matching rings
    const matchingRings = State.data.fraud_rings.filter(r => r.pattern_type === targetPattern);
    const memberSet = new Set();
    matchingRings.forEach(ring => ring.member_accounts.forEach(m => memberSet.add(m)));

    State.cy.nodes().forEach(node => {
        if (memberSet.has(node.data('id'))) {
            node.removeClass('dimmed').addClass('highlighted');
        }
    });

    State.cy.edges().forEach(edge => {
        if (memberSet.has(edge.data('source')) && memberSet.has(edge.data('target'))) {
            edge.removeClass('dimmed').addClass('highlighted-edge');
        }
    });
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 6: TIME TRAVEL
// ═══════════════════════════════════════════════════════════════

function setupTimeTravel(data) {
    const edges = data.graph_data.edges.filter(e => e.timestamp);
    if (edges.length === 0) return;

    const timestamps = edges.map(e => new Date(e.timestamp).getTime()).sort((a, b) => a - b);
    const minTime = timestamps[0];
    const maxTime = timestamps[timestamps.length - 1];

    $('#timeStart').textContent = new Date(minTime).toLocaleDateString();
    $('#timeEnd').textContent = new Date(maxTime).toLocaleDateString();
    $('#timeCurrent').textContent = 'All transactions';

    const slider = $('#timeSlider');
    slider.value = 100;

    slider.addEventListener('input', () => {
        const pct = parseInt(slider.value);
        const cutoff = minTime + (maxTime - minTime) * (pct / 100);

        if (pct === 100) {
            $('#timeCurrent').textContent = 'All transactions';
            State.cy.edges().removeClass('hidden-node');
        } else {
            const date = new Date(cutoff);
            $('#timeCurrent').textContent = date.toLocaleString();

            State.cy.edges().forEach(edge => {
                const ts = new Date(edge.data('timestamp')).getTime();
                edge.toggleClass('hidden-node', ts > cutoff);
            });
        }
    });

    // Play button
    $('#playBtn').addEventListener('click', () => {
        if (State.playInterval) {
            clearInterval(State.playInterval);
            State.playInterval = null;
            return;
        }
        slider.value = 0;
        slider.dispatchEvent(new Event('input'));

        State.playInterval = setInterval(() => {
            const val = parseInt(slider.value) + 1;
            if (val > 100) {
                clearInterval(State.playInterval);
                State.playInterval = null;
                return;
            }
            slider.value = val;
            slider.dispatchEvent(new Event('input'));
        }, 80);
    });

    // Reset
    $('#resetTimeBtn').addEventListener('click', () => {
        if (State.playInterval) {
            clearInterval(State.playInterval);
            State.playInterval = null;
        }
        slider.value = 100;
        slider.dispatchEvent(new Event('input'));
    });
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 7: ACCOUNT DEEP-DIVE
// ═══════════════════════════════════════════════════════════════

async function openAccountPanel(accountId) {
    const panel = $('#accountPanel');
    const content = $('#accountContent');
    const title = $('#accountTitle');

    title.textContent = accountId;
    content.innerHTML = '<p class="hint-text">Loading account details…</p>';
    panel.classList.add('open');

    try {
        const res = await fetch(`/account/${accountId}`);
        if (!res.ok) throw new Error('Failed to load');
        const data = await res.json();
        renderAccountDetail(data, content);
    } catch (err) {
        // Fallback: use local data
        const localData = buildLocalAccountData(accountId);
        renderAccountDetail(localData, content);
    }
}

function buildLocalAccountData(accountId) {
    const d = State.data;
    if (!d) return { account_id: accountId, suspicion_score: 0, is_suspicious: false, detected_patterns: [], reasons: [], rings: [], stats: {}, outgoing_transactions: [], incoming_transactions: [] };

    const sus = d.suspicious_accounts.find(a => a.account_id === accountId);
    const rings = d.fraud_rings.filter(r => r.member_accounts.includes(accountId));
    const node = d.graph_data.nodes.find(n => n.id === accountId);

    const reasons = [];
    if (sus) {
        sus.detected_patterns.forEach(p => {
            if (p.startsWith('cycle_length_')) reasons.push(`Part of a ${p.split('_')[2]}-node circular money loop`);
            else if (p === 'cycle') reasons.push('Involved in circular transaction routing');
            else if (p === 'smurfing') reasons.push('Fan-out pattern: distributing funds to many accounts');
            else if (p === 'shell') reasons.push('Shell chain: layered pass-through transactions');
        });
    }

    const outgoing = d.graph_data.edges.filter(e => e.source === accountId).map(e => ({
        transaction_id: e.transaction_id, to: e.target, amount: e.amount, timestamp: e.timestamp
    }));
    const incoming = d.graph_data.edges.filter(e => e.target === accountId).map(e => ({
        transaction_id: e.transaction_id, from: e.source, amount: e.amount, timestamp: e.timestamp
    }));

    return {
        account_id: accountId,
        suspicion_score: sus ? sus.suspicion_score : 0,
        is_suspicious: !!sus && !State.legitimateAccounts.has(accountId),
        detected_patterns: sus ? sus.detected_patterns : [],
        reasons,
        rings,
        stats: {
            in_degree: node ? node.in_degree : 0,
            out_degree: node ? node.out_degree : 0,
            total_in_amount: incoming.reduce((s, t) => s + t.amount, 0),
            total_out_amount: outgoing.reduce((s, t) => s + t.amount, 0),
        },
        outgoing_transactions: outgoing,
        incoming_transactions: incoming,
    };
}

function renderAccountDetail(data, container) {
    const isLegitimate = State.legitimateAccounts.has(data.account_id);
    const score = isLegitimate ? 0 : data.suspicion_score;
    const scoreColor = score >= 70 ? '#ef476f' : score >= 40 ? '#ffd166' : '#06d6a0';

    let html = `
    <div class="account-score">
      <div class="score-circle" style="background:${scoreColor}15; color:${scoreColor}">
        ${score}
      </div>
      <div class="score-label">${isLegitimate ? 'Marked as Legitimate' : (score >= 70 ? 'HIGH RISK' : score >= 40 ? 'MEDIUM RISK' : 'LOW RISK')}</div>
    </div>
  `;

    // Patterns
    if (data.detected_patterns.length > 0) {
        html += `<div class="account-section"><h4>Detected Patterns</h4><div>`;
        data.detected_patterns.forEach(p => {
            const cls = p.includes('cycle') ? 'cycle' : (p === 'smurfing' ? 'smurfing' : (p === 'shell' ? 'shell' : 'default'));
            html += `<span class="pattern-tag ${cls}">${p}</span>`;
        });
        html += `</div></div>`;
    }

    // Why Flagged
    if (data.reasons.length > 0) {
        html += `<div class="account-section"><h4>🔍 Why Flagged?</h4>`;
        data.reasons.forEach(r => { html += `<div class="reason-card">${r}</div>`; });
        html += `</div>`;
    }

    // Stats
    html += `
    <div class="account-section">
      <h4>Account Statistics</h4>
      <div class="stat-row"><span class="stat-row-label">In-Degree</span><span class="stat-row-value">${data.stats.in_degree || 0}</span></div>
      <div class="stat-row"><span class="stat-row-label">Out-Degree</span><span class="stat-row-value">${data.stats.out_degree || 0}</span></div>
      <div class="stat-row"><span class="stat-row-label">Total Inflow</span><span class="stat-row-value">$${(data.stats.total_in_amount || 0).toLocaleString()}</span></div>
      <div class="stat-row"><span class="stat-row-label">Total Outflow</span><span class="stat-row-value">$${(data.stats.total_out_amount || 0).toLocaleString()}</span></div>
    </div>
  `;

    // Rings
    if (data.rings.length > 0) {
        html += `<div class="account-section"><h4>Member of Rings</h4>`;
        data.rings.forEach(r => {
            html += `<div class="reason-card" style="border-color:var(--accent-orange); background:rgba(255,209,102,0.06)">
        <strong>${r.ring_id}</strong> — ${r.pattern_type} (Risk: ${r.risk_score})
      </div>`;
        });
        html += `</div>`;
    }

    // Outgoing Transactions
    if (data.outgoing_transactions.length > 0) {
        html += `<div class="account-section"><h4>Outgoing Transactions (${data.outgoing_transactions.length})</h4><div class="tx-list">`;
        data.outgoing_transactions.forEach(tx => {
            html += `<div class="tx-item">
        <div><span class="tx-item-id">${tx.transaction_id}</span><br><span class="tx-item-account">→ ${tx.to}</span></div>
        <div style="text-align:right"><span class="tx-item-amount">$${tx.amount.toLocaleString()}</span><br><span class="tx-item-time">${formatTimestamp(tx.timestamp)}</span></div>
      </div>`;
        });
        html += `</div></div>`;
    }

    // Incoming Transactions
    if (data.incoming_transactions.length > 0) {
        html += `<div class="account-section"><h4>Incoming Transactions (${data.incoming_transactions.length})</h4><div class="tx-list">`;
        data.incoming_transactions.forEach(tx => {
            html += `<div class="tx-item">
        <div><span class="tx-item-id">${tx.transaction_id}</span><br><span class="tx-item-account">← ${tx.from}</span></div>
        <div style="text-align:right"><span class="tx-item-amount">$${tx.amount.toLocaleString()}</span><br><span class="tx-item-time">${formatTimestamp(tx.timestamp)}</span></div>
      </div>`;
        });
        html += `</div></div>`;
    }

    // Actions
    html += `<div class="account-actions">`;
    if (data.is_suspicious && !isLegitimate) {
        html += `<button class="btn-success-outline" onclick="markLegitimate('${data.account_id}')">✓ Mark Legitimate</button>`;
    }
    html += `<button class="btn-secondary" onclick="focusOnNode('${data.account_id}')">🎯 Focus in Graph</button>`;
    html += `</div>`;

    container.innerHTML = html;
}

function formatTimestamp(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function focusOnNode(accountId) {
    if (!State.cy) return;
    const node = State.cy.getElementById(accountId);
    if (node.length) {
        State.cy.animate({
            center: { eles: node },
            zoom: 2,
        }, { duration: 500 });
        node.select();
    }
    // Switch to graph tab
    switchTab('graph');
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 8: FALSE POSITIVE CONTROL
// ═══════════════════════════════════════════════════════════════

function markLegitimate(accountId) {
    const modal = $('#fpModal');
    const accountEl = $('#fpAccountId');
    accountEl.textContent = accountId;
    modal.classList.remove('hidden');

    $('#fpConfirm').onclick = () => {
        State.legitimateAccounts.add(accountId);
        modal.classList.add('hidden');

        // Update graph visually
        if (State.cy) {
            const node = State.cy.getElementById(accountId);
            if (node.length) {
                node.data('suspicious', false);
                node.style({
                    'background-color': '#374151',
                    'border-width': 1,
                    'border-color': '#06d6a0',
                    'shadow-blur': 0,
                    'shadow-opacity': 0,
                });
            }
        }

        // Refresh account panel
        openAccountPanel(accountId);

        // Update counters
        const flagged = State.data.summary.suspicious_accounts_flagged - State.legitimateAccounts.size;
        animateCounter('#statSuspicious .stat-value', Math.max(0, flagged));
    };

    $('#fpCancel').onclick = () => { modal.classList.add('hidden'); };
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 9: FRAUD RINGS TABLE
// ═══════════════════════════════════════════════════════════════

function buildRingsTable(data) {
    const body = $('#ringsBody');
    const leaderboard = $('#ringsLeaderboard');
    const meta = $('#ringsMeta');

    meta.innerHTML = `<span>${data.fraud_rings.length} rings detected</span>`;

    // Leaderboard (top 5)
    const top5 = data.fraud_rings.slice(0, 5);
    leaderboard.innerHTML = top5.map((ring, i) => `
    <div class="leaderboard-card" onclick="highlightRingAndSwitch('${ring.ring_id}')">
      <div class="leaderboard-rank">#${i + 1} Most Dangerous</div>
      <div class="leaderboard-id">${ring.ring_id}</div>
      <div class="leaderboard-meta">
        <span class="pattern-badge ${ring.pattern_type}">${ring.pattern_type}</span>
        <span class="leaderboard-score">Risk: ${ring.risk_score}</span>
      </div>
    </div>
  `).join('');

    // Full table
    body.innerHTML = data.fraud_rings.map(ring => {
        const riskClass = ring.risk_score >= 50 ? 'high' : ring.risk_score >= 25 ? 'medium' : 'low';
        return `
      <tr onclick="toggleRingDetail('${ring.ring_id}')">
        <td><strong>${ring.ring_id}</strong></td>
        <td><span class="pattern-badge ${ring.pattern_type}">${ring.pattern_type}</span></td>
        <td>${ring.member_accounts.length} accounts</td>
        <td><span class="risk-badge ${riskClass}">${ring.risk_score}</span></td>
        <td>
          <button class="ring-expand-btn" onclick="event.stopPropagation(); highlightRingAndSwitch('${ring.ring_id}')">
            View in Graph
          </button>
        </td>
      </tr>
      <tr class="ring-detail-row" id="detail_${ring.ring_id}">
        <td colspan="5" class="ring-detail-cell">
          <div class="ring-detail-content">
            <div>
              <strong>Members:</strong>
              <div class="ring-members-list">
                ${ring.member_accounts.map(m => `<span class="ring-member-chip" onclick="event.stopPropagation(); openAccountPanel('${m}')">${m}</span>`).join('')}
              </div>
            </div>
          </div>
        </td>
      </tr>
    `;
    }).join('');
}

function toggleRingDetail(ringId) {
    const row = document.getElementById(`detail_${ringId}`);
    if (row) row.classList.toggle('expanded');
}

function highlightRingAndSwitch(ringId) {
    switchTab('graph');
    setTimeout(() => {
        $('#ringFilter').value = ringId;
        highlightRing(ringId);
    }, 100);
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 10: JSON VIEWER
// ═══════════════════════════════════════════════════════════════

function updateJsonViewer(data) {
    const payload = {
        suspicious_accounts: data.suspicious_accounts,
        fraud_rings: data.fraud_rings,
        summary: {
            ...data.summary,
            processing_time_seconds: data.processing_time_seconds,
        },
    };

    State.jsonPayload = payload;
    renderJson(payload, false);
}

function renderJson(payload, humanReadable) {
    const viewer = $('#jsonViewer');

    if (humanReadable) {
        viewer.innerHTML = generateHumanReadable(payload);
    } else {
        const jsonStr = JSON.stringify(payload, null, 2);
        viewer.innerHTML = `<code>${syntaxHighlight(jsonStr)}</code>`;
    }
}

function syntaxHighlight(json) {
    return json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?/g, (match) => {
            let cls = 'json-string';
            if (/:\s*$/.test(match)) {
                cls = 'json-key';
                match = match.replace(/"([^"]+)"\s*:/, '"$1":');
            }
            return `<span class="${cls}">${match}</span>`;
        })
        .replace(/\b(-?\d+\.?\d*)\b/g, '<span class="json-number">$1</span>')
        .replace(/\b(true|false)\b/g, '<span class="json-boolean">$1</span>')
        .replace(/\bnull\b/g, '<span class="json-null">null</span>');
}

function generateHumanReadable(payload) {
    let html = '<code>';

    html += `<span class="json-key">📊 Analysis Summary</span>\n`;
    html += `  Total accounts analyzed: <span class="json-number">${payload.summary.total_accounts_analyzed}</span>\n`;
    html += `  Suspicious accounts flagged: <span class="json-number">${payload.summary.suspicious_accounts_flagged}</span>\n`;
    html += `  Fraud rings detected: <span class="json-number">${payload.summary.fraud_rings_detected}</span>\n`;
    html += `  Processing time: <span class="json-number">${payload.summary.processing_time_seconds}s</span>\n\n`;

    html += `<span class="json-key">🚨 Suspicious Accounts (${payload.suspicious_accounts.length})</span>\n`;
    payload.suspicious_accounts.forEach((a, i) => {
        const emoji = a.suspicion_score >= 70 ? '🔴' : a.suspicion_score >= 40 ? '🟡' : '🟢';
        html += `  ${emoji} ${a.account_id} — Score: <span class="json-number">${a.suspicion_score}</span>\n`;
        html += `     Patterns: <span class="json-string">${a.detected_patterns.join(', ')}</span>\n`;
        html += `     Ring: <span class="json-string">${a.ring_id || 'none'}</span>\n`;
        if (i < payload.suspicious_accounts.length - 1) html += '\n';
    });

    html += `\n<span class="json-key">🔗 Fraud Rings (${payload.fraud_rings.length})</span>\n`;
    payload.fraud_rings.forEach(r => {
        html += `  📌 ${r.ring_id} [${r.pattern_type}] — Risk: <span class="json-number">${r.risk_score}</span>\n`;
        html += `     Members: <span class="json-string">${r.member_accounts.join(', ')}</span>\n\n`;
    });

    html += '</code>';
    return html;
}

function initJsonControls() {
    $('#jsonHumanToggle').addEventListener('change', (e) => {
        if (State.jsonPayload) renderJson(State.jsonPayload, e.target.checked);
    });

    $('#copyJsonBtn').addEventListener('click', () => {
        if (!State.jsonPayload) return;
        const text = JSON.stringify(State.jsonPayload, null, 2);
        navigator.clipboard.writeText(text).then(() => {
            const btn = $('#copyJsonBtn');
            btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!`;
            setTimeout(() => {
                btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy`;
            }, 2000);
        });
    });

    $('#downloadJsonBtn').addEventListener('click', () => {
        window.open('/download-json', '_blank');
    });
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 11: TAB MANAGEMENT
// ═══════════════════════════════════════════════════════════════

function initTabs() {
    $$('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            switchTab(btn.dataset.tab);
        });
    });
}

function switchTab(tabName) {
    $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
    $$('.tab-panel').forEach(p => p.classList.toggle('active',
        p.id === tabName + 'Panel'));
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 12: MODE TOGGLE (ANALYST / INVESTIGATOR)
// ═══════════════════════════════════════════════════════════════

function initModeToggle() {
    $('#analystBtn').addEventListener('click', () => setMode('analyst'));
    $('#investigatorBtn').addEventListener('click', () => setMode('investigator'));
}

function setMode(mode) {
    State.currentMode = mode;
    document.body.classList.toggle('investigator-mode', mode === 'investigator');
    $$('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 13: ACCOUNT PANEL CLOSE
// ═══════════════════════════════════════════════════════════════

function initAccountPanel() {
    $('#closeAccountPanel').addEventListener('click', () => {
        $('#accountPanel').classList.remove('open');
    });
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 14: ALERT NOTIFICATION SYSTEM
// ═══════════════════════════════════════════════════════════════

function showAlert(type, title, message) {
    const container = $('#toastContainer');
    if (!container) return;

    const icons = {
        critical: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        warning: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
        info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
        success: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <div class="toast-icon">${icons[type] || icons.info}</div>
        <div class="toast-body">
            <div class="toast-title">${title}</div>
            <div class="toast-message">${message}</div>
        </div>
        <button class="toast-close" onclick="this.parentElement.remove()">✕</button>
        <div class="toast-progress"><div class="toast-progress-bar"></div></div>
    `;

    container.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => toast.classList.add('toast-enter'));

    // Auto-dismiss after 6 seconds
    setTimeout(() => {
        toast.classList.add('toast-exit');
        setTimeout(() => toast.remove(), 400);
    }, 6000);
}

function triggerAnalysisAlerts(data) {
    const rings = data.fraud_rings.length;
    const suspicious = data.summary.suspicious_accounts_flagged;
    const total = data.summary.total_accounts_analyzed;

    // Stagger the alerts
    setTimeout(() => {
        showAlert('success', 'Analysis Complete', `Processed ${total} accounts in ${data.processing_time_seconds}s`);
    }, 500);

    if (rings > 0) {
        setTimeout(() => {
            showAlert('critical', `${rings} Fraud Ring${rings > 1 ? 's' : ''} Detected`,
                `${suspicious} suspicious account${suspicious > 1 ? 's' : ''} flagged across ${rings} ring${rings > 1 ? 's' : ''}`);
        }, 1500);
    }

    // High risk accounts alert
    const highRisk = data.suspicious_accounts.filter(a => a.suspicion_score >= 70);
    if (highRisk.length > 0) {
        setTimeout(() => {
            showAlert('warning', 'High Risk Accounts',
                `${highRisk.length} account${highRisk.length > 1 ? 's' : ''} scored above 70 — immediate review recommended`);
        }, 2500);
    }
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 15: COMMAND PALETTE (Ctrl+K)
// ═══════════════════════════════════════════════════════════════

let commandSelectedIndex = -1;

function initCommandPalette() {
    const palette = $('#commandPalette');
    const input = $('#commandInput');
    const results = $('#commandResults');
    const backdrop = palette.querySelector('.command-backdrop');

    // Ctrl+K or Cmd+K to open
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            toggleCommandPalette();
        }
        if (e.key === 'Escape' && !palette.classList.contains('hidden')) {
            closeCommandPalette();
        }
    });

    backdrop.addEventListener('click', closeCommandPalette);

    input.addEventListener('input', () => {
        const query = input.value.trim().toLowerCase();
        commandSelectedIndex = -1;
        if (query.length === 0) {
            showDefaultCommands();
            return;
        }
        searchCommands(query);
    });

    input.addEventListener('keydown', (e) => {
        const items = results.querySelectorAll('.command-item');
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            commandSelectedIndex = Math.min(commandSelectedIndex + 1, items.length - 1);
            updateCommandSelection(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            commandSelectedIndex = Math.max(commandSelectedIndex - 1, 0);
            updateCommandSelection(items);
        } else if (e.key === 'Enter' && commandSelectedIndex >= 0 && items[commandSelectedIndex]) {
            e.preventDefault();
            items[commandSelectedIndex].click();
        }
    });
}

function toggleCommandPalette() {
    const palette = $('#commandPalette');
    if (palette.classList.contains('hidden')) {
        palette.classList.remove('hidden');
        $('#commandInput').value = '';
        $('#commandInput').focus();
        commandSelectedIndex = -1;
        showDefaultCommands();
    } else {
        closeCommandPalette();
    }
}

function closeCommandPalette() {
    $('#commandPalette').classList.add('hidden');
}

function showDefaultCommands() {
    const results = $('#commandResults');
    let html = '<div class="command-section-title">Quick Actions</div>';
    const actions = [
        { icon: '📊', label: 'Switch to Graph View', action: 'nav', id: 'graph' },
        { icon: '🔥', label: 'Switch to Heatmap View', action: 'nav', id: 'heatmap' },
        { icon: '🔗', label: 'Switch to Fraud Rings', action: 'nav', id: 'rings' },
        { icon: '📄', label: 'Export PDF Report', action: 'export', id: 'pdf' },
        { icon: '🔍', label: 'Toggle Investigator Mode', action: 'mode', id: 'toggle' },
    ];

    actions.forEach((a, i) => {
        html += `<div class="command-item" data-index="${i}" data-action="${a.action}" data-id="${a.id}">
            <span class="command-item-icon">${a.icon}</span>
            <span class="command-item-label">${a.label}</span>
            <span class="command-item-type">Action</span>
        </div>`;
    });

    results.innerHTML = html;
    attachCommandItemEvents();
}

function encodeAction(action) {
    return 'function(){}'; // No longer used
}

function searchCommands(query) {
    const results = $('#commandResults');
    let html = '';
    let idx = 0;

    // Search accounts
    if (State.data) {
        const accounts = State.data.graph_data.nodes.filter(n =>
            n.id.toLowerCase().includes(query)
        ).slice(0, 5);

        if (accounts.length > 0) {
            html += '<div class="command-section-title">Accounts</div>';
            accounts.forEach(acc => {
                const sus = State.data.suspicious_accounts.find(a => a.account_id === acc.id);
                const score = sus ? sus.suspicion_score : 0;
                const riskClass = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';
                html += `<div class="command-item" data-index="${idx}" data-action="account" data-id="${acc.id}">
                    <span class="command-item-icon">👤</span>
                    <span class="command-item-label">${acc.id}</span>
                    <span class="risk-badge ${riskClass}">${score}</span>
                </div>`;
                idx++;
            });
        }

        // Search fraud rings
        const rings = State.data.fraud_rings.filter(r =>
            r.ring_id.toLowerCase().includes(query) || r.pattern_type.toLowerCase().includes(query)
        ).slice(0, 3);

        if (rings.length > 0) {
            html += '<div class="command-section-title">Fraud Rings</div>';
            rings.forEach(ring => {
                html += `<div class="command-item" data-index="${idx}" data-action="ring" data-id="${ring.ring_id}">
                    <span class="command-item-icon">🔗</span>
                    <span class="command-item-label">${ring.ring_id} — ${ring.pattern_type}</span>
                    <span class="command-item-type">${ring.member_accounts.length} members</span>
                </div>`;
                idx++;
            });
        }
    }

    // Navigation commands
    const navItems = [
        { icon: '📊', label: 'Go to Graph', action: 'nav', id: 'graph' },
        { icon: '🔥', label: 'Go to Heatmap', action: 'nav', id: 'heatmap' },
        { icon: '🔗', label: 'Go to Fraud Rings', action: 'nav', id: 'rings' },
        { icon: '💾', label: 'Go to JSON Output', action: 'nav', id: 'json' },
        { icon: '📄', label: 'Export PDF Report', action: 'export', id: 'pdf' },
        { icon: '🏠', label: 'Back to Dashboard', action: 'nav', id: 'dashboard' },
    ].filter(item => item.label.toLowerCase().includes(query));

    if (navItems.length > 0) {
        html += '<div class="command-section-title">Navigation</div>';
        navItems.forEach(item => {
            html += `<div class="command-item" data-index="${idx}" data-action="${item.action}" data-id="${item.id}">
                <span class="command-item-icon">${item.icon}</span>
                <span class="command-item-label">${item.label}</span>
                <span class="command-item-type">Navigation</span>
            </div>`;
            idx++;
        });
    }

    if (!html) {
        html = '<div class="command-empty">No results found</div>';
    }

    results.innerHTML = html;
    attachCommandItemEvents();
}

function attachCommandItemEvents() {
    $$('.command-item').forEach(item => {
        item.addEventListener('click', () => {
            const action = item.dataset.action;
            const id = item.dataset.id;

            if (action === 'account') {
                openAccountPanel(id);
                focusOnNode(id);
            } else if (action === 'ring') {
                highlightRingAndSwitch(id);
            } else if (action === 'nav') {
                if (id === 'dashboard') showDashboardPage();
                else switchTab(id);
            } else if (action === 'export') {
                generateReport();
            } else if (action === 'mode') {
                setMode(State.currentMode === 'analyst' ? 'investigator' : 'analyst');
                showAlert('info', 'Mode Switched', `Now in ${State.currentMode} mode`);
            }

            closeCommandPalette();
        });
    });
}

function updateCommandSelection(items) {
    items.forEach((item, i) => {
        item.classList.toggle('selected', i === commandSelectedIndex);
    });
    if (items[commandSelectedIndex]) {
        items[commandSelectedIndex].scrollIntoView({ block: 'nearest' });
    }
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 16: PDF REPORT GENERATOR
// ═══════════════════════════════════════════════════════════════

async function generateReport() {
    if (!State.data) {
        showAlert('warning', 'No Data', 'Please run an analysis first before exporting.');
        return;
    }

    const btn = $('#exportReportBtn');
    const origText = btn.innerHTML;
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> Generating…`;
    btn.disabled = true;

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');
        const d = State.data;
        let y = 20;
        const margin = 20;
        const pageWidth = 170;

        // Header
        doc.setFillColor(10, 14, 23);
        doc.rect(0, 0, 210, 45, 'F');
        doc.setTextColor(6, 214, 160);
        doc.setFontSize(24);
        doc.setFont('helvetica', 'bold');
        doc.text('RIFT', margin, 22);
        doc.setFontSize(10);
        doc.setTextColor(180, 190, 200);
        doc.text('Fraud Detection Intelligence Report', margin, 30);
        doc.setFontSize(8);
        doc.text(`Generated: ${new Date().toLocaleString()}`, margin, 37);

        y = 55;

        // Summary Box
        doc.setFillColor(26, 31, 46);
        doc.roundedRect(margin, y, pageWidth, 30, 3, 3, 'F');
        doc.setTextColor(226, 232, 240);
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text('Analysis Summary', margin + 5, y + 8);

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(160, 170, 180);
        const summaryData = [
            `Total Accounts: ${d.summary.total_accounts_analyzed}`,
            `Suspicious: ${d.summary.suspicious_accounts_flagged}`,
            `Fraud Rings: ${d.summary.fraud_rings_detected}`,
            `Processing: ${d.processing_time_seconds}s`,
        ];
        doc.text(summaryData.join('   |   '), margin + 5, y + 18);
        y += 40;

        // Suspicious Accounts
        doc.setTextColor(239, 71, 111);
        doc.setFontSize(13);
        doc.setFont('helvetica', 'bold');
        doc.text('Suspicious Accounts', margin, y);
        y += 8;

        d.suspicious_accounts.slice(0, 15).forEach(acc => {
            if (y > 270) { doc.addPage(); y = 20; }
            const riskLevel = acc.suspicion_score >= 70 ? 'HIGH' : acc.suspicion_score >= 40 ? 'MEDIUM' : 'LOW';
            doc.setFillColor(26, 31, 46);
            doc.roundedRect(margin, y, pageWidth, 14, 2, 2, 'F');

            doc.setFontSize(9);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(226, 232, 240);
            doc.text(acc.account_id, margin + 5, y + 6);

            doc.setFont('helvetica', 'normal');
            doc.setTextColor(160, 170, 180);
            doc.text(`Score: ${acc.suspicion_score}  |  Risk: ${riskLevel}  |  Patterns: ${acc.detected_patterns.join(', ')}`, margin + 5, y + 11);
            y += 17;
        });

        y += 5;

        // Fraud Rings
        if (y > 250) { doc.addPage(); y = 20; }
        doc.setTextColor(255, 209, 102);
        doc.setFontSize(13);
        doc.setFont('helvetica', 'bold');
        doc.text('Fraud Rings', margin, y);
        y += 8;

        d.fraud_rings.forEach(ring => {
            if (y > 270) { doc.addPage(); y = 20; }
            doc.setFillColor(26, 31, 46);
            doc.roundedRect(margin, y, pageWidth, 14, 2, 2, 'F');

            doc.setFontSize(9);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(226, 232, 240);
            doc.text(`${ring.ring_id} — ${ring.pattern_type}`, margin + 5, y + 6);

            doc.setFont('helvetica', 'normal');
            doc.setTextColor(160, 170, 180);
            doc.text(`Risk Score: ${ring.risk_score}  |  Members: ${ring.member_accounts.join(', ')}`, margin + 5, y + 11);
            y += 17;
        });

        // Footer
        const pages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pages; i++) {
            doc.setPage(i);
            doc.setFillColor(10, 14, 23);
            doc.rect(0, 287, 210, 10, 'F');
            doc.setFontSize(7);
            doc.setTextColor(100, 110, 120);
            doc.text('RIFT — Fraud Detection Intelligence Platform', margin, 293);
            doc.text(`Page ${i} of ${pages}`, 180, 293);
        }

        doc.save(`RIFT_Report_${new Date().toISOString().slice(0, 10)}.pdf`);
        showAlert('success', 'Report Exported', 'PDF report has been downloaded successfully.');
    } catch (err) {
        console.error('PDF generation error:', err);
        showAlert('critical', 'Export Failed', 'Could not generate PDF. Please try again.');
    } finally {
        btn.innerHTML = origText;
        btn.disabled = false;
    }
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 17: RISK HEATMAP
// ═══════════════════════════════════════════════════════════════

function buildRiskHeatmap(data) {
    const grid = $('#heatmapGrid');
    if (!grid) return;

    const sortBy = $('#heatmapSort')?.value || 'score';

    // Build account data
    let accounts = data.graph_data.nodes.map(node => {
        const sus = data.suspicious_accounts.find(a => a.account_id === node.id);
        return {
            id: node.id,
            score: sus ? sus.suspicion_score : 0,
            isSuspicious: !!sus,
            connections: (node.in_degree || 0) + (node.out_degree || 0),
            patterns: sus ? sus.detected_patterns : [],
            volume: data.graph_data.edges.filter(e => e.source === node.id || e.target === node.id)
                .reduce((sum, e) => sum + e.amount, 0),
        };
    });

    // Sort
    if (sortBy === 'score') accounts.sort((a, b) => b.score - a.score);
    else if (sortBy === 'connections') accounts.sort((a, b) => b.connections - a.connections);
    else if (sortBy === 'volume') accounts.sort((a, b) => b.volume - a.volume);

    grid.innerHTML = accounts.map(acc => {
        const intensity = acc.score / 100;
        const r = Math.round(6 + (239 - 6) * intensity);
        const g = Math.round(214 + (71 - 214) * intensity);
        const b = Math.round(160 + (111 - 160) * intensity);
        const bg = `rgba(${r}, ${g}, ${b}, ${0.15 + intensity * 0.55})`;
        const border = `rgba(${r}, ${g}, ${b}, 0.6)`;

        return `<div class="heatmap-cell" 
            style="background:${bg}; border-color:${border}; color:rgb(${r},${g},${b})"
            data-account="${acc.id}"
            onmouseenter="showHeatmapTooltip(event, '${acc.id}', ${acc.score}, ${acc.connections}, ${Math.round(acc.volume)})"
            onmouseleave="hideHeatmapTooltip()">
            <span class="heatmap-cell-score">${acc.score}</span>
            <span class="heatmap-cell-id">${acc.id.length > 10 ? acc.id.substring(0, 10) + '…' : acc.id}</span>
        </div>`;
    }).join('');

    // Click to open account panel
    grid.querySelectorAll('.heatmap-cell').forEach(cell => {
        cell.addEventListener('click', () => {
            openAccountPanel(cell.dataset.account);
        });
    });
}

function showHeatmapTooltip(event, id, score, connections, volume) {
    const tooltip = $('#heatmapTooltip');
    if (!tooltip) return;
    tooltip.innerHTML = `
        <strong>${id}</strong><br>
        Risk Score: <span style="color:${score >= 70 ? '#ef476f' : score >= 40 ? '#ffd166' : '#06d6a0'}">${score}</span><br>
        Connections: ${connections}<br>
        Volume: $${volume.toLocaleString()}
    `;
    tooltip.classList.remove('hidden');
    tooltip.style.left = (event.clientX + 15) + 'px';
    tooltip.style.top = (event.clientY + 15) + 'px';
}

function hideHeatmapTooltip() {
    const tooltip = $('#heatmapTooltip');
    if (tooltip) tooltip.classList.add('hidden');
}

function initHeatmapControls() {
    const sortSelect = $('#heatmapSort');
    if (sortSelect) {
        sortSelect.addEventListener('change', () => {
            if (State.data) buildRiskHeatmap(State.data);
        });
    }
}

// ═══════════════════════════════════════════════════════════════
//  SECTION 18: RISK SCORE COMPARISON
// ═══════════════════════════════════════════════════════════════

function initComparison() {
    const toggleBtn = $('#compareToggleBtn');
    const closeBtn = $('#closeComparisonPanel');

    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            State.comparisonMode = !State.comparisonMode;
            toggleBtn.classList.toggle('active', State.comparisonMode);
            const panel = $('#comparisonPanel');
            panel.classList.toggle('hidden', !State.comparisonMode);
            if (State.comparisonMode) {
                showAlert('info', 'Comparison Mode', 'Click accounts in the graph to add them for comparison.');
            }
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            State.comparisonMode = false;
            State.comparisonAccounts = [];
            $('#comparisonPanel').classList.add('hidden');
            $('#compareToggleBtn').classList.remove('active');
            renderComparison();
        });
    }
}

function addToComparison(accountId) {
    if (!State.comparisonMode) return;
    if (State.comparisonAccounts.length >= 5) {
        showAlert('warning', 'Max Accounts', 'You can compare up to 5 accounts at a time.');
        return;
    }
    if (State.comparisonAccounts.includes(accountId)) {
        State.comparisonAccounts = State.comparisonAccounts.filter(id => id !== accountId);
    } else {
        State.comparisonAccounts.push(accountId);
    }
    renderComparison();
}

function renderComparison() {
    const accountsDiv = $('#comparisonAccounts');
    const detailsDiv = $('#comparisonDetails');
    const canvas = $('#comparisonChart');

    if (!accountsDiv || !State.data) return;

    // Render chips
    accountsDiv.innerHTML = State.comparisonAccounts.map(id => {
        const sus = State.data.suspicious_accounts.find(a => a.account_id === id);
        const score = sus ? sus.suspicion_score : 0;
        return `<div class="comparison-chip">
            <span>${id}</span>
            <span class="risk-badge ${score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low'}">${score}</span>
            <button onclick="removeFromComparison('${id}')">✕</button>
        </div>`;
    }).join('');

    if (State.comparisonAccounts.length === 0) {
        detailsDiv.innerHTML = '';
        return;
    }

    // Draw bar chart
    drawComparisonChart(canvas);

    // Comparison table
    let tableHtml = '<table class="comparison-table"><thead><tr><th>Metric</th>';
    State.comparisonAccounts.forEach(id => {
        tableHtml += `<th>${id.length > 12 ? id.substring(0, 12) + '…' : id}</th>`;
    });
    tableHtml += '</tr></thead><tbody>';

    const metrics = ['Risk Score', 'In-Degree', 'Out-Degree', 'Total Inflow', 'Total Outflow', 'Patterns'];
    metrics.forEach(metric => {
        tableHtml += `<tr><td class="metric-label">${metric}</td>`;
        State.comparisonAccounts.forEach(id => {
            const localData = buildLocalAccountData(id);
            let value = '';
            switch (metric) {
                case 'Risk Score': value = localData.suspicion_score; break;
                case 'In-Degree': value = localData.stats.in_degree || 0; break;
                case 'Out-Degree': value = localData.stats.out_degree || 0; break;
                case 'Total Inflow': value = '$' + (localData.stats.total_in_amount || 0).toLocaleString(); break;
                case 'Total Outflow': value = '$' + (localData.stats.total_out_amount || 0).toLocaleString(); break;
                case 'Patterns': value = localData.detected_patterns.join(', ') || 'None'; break;
            }
            tableHtml += `<td>${value}</td>`;
        });
        tableHtml += '</tr>';
    });
    tableHtml += '</tbody></table>';
    detailsDiv.innerHTML = tableHtml;
}

function removeFromComparison(id) {
    State.comparisonAccounts = State.comparisonAccounts.filter(a => a !== id);
    renderComparison();
}

function drawComparisonChart(canvas) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const padding = { top: 20, right: 20, bottom: 40, left: 50 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = 'rgba(17, 24, 39, 0.5)';
    ctx.fillRect(0, 0, w, h);

    if (State.comparisonAccounts.length === 0) return;

    const barWidth = Math.min(60, chartW / State.comparisonAccounts.length - 10);
    const gap = (chartW - barWidth * State.comparisonAccounts.length) / (State.comparisonAccounts.length + 1);

    // Grid lines
    ctx.strokeStyle = 'rgba(30, 41, 59, 0.6)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const yPos = padding.top + (chartH * i / 4);
        ctx.beginPath();
        ctx.moveTo(padding.left, yPos);
        ctx.lineTo(w - padding.right, yPos);
        ctx.stroke();

        ctx.fillStyle = '#64748b';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(100 - (i * 25), padding.left - 8, yPos + 4);
    }

    // Bars
    State.comparisonAccounts.forEach((id, i) => {
        const sus = State.data.suspicious_accounts.find(a => a.account_id === id);
        const score = sus ? sus.suspicion_score : 0;
        const barH = (score / 100) * chartH;
        const x = padding.left + gap + i * (barWidth + gap);
        const y = padding.top + chartH - barH;

        // Bar gradient
        const gradient = ctx.createLinearGradient(x, y, x, y + barH);
        if (score >= 70) {
            gradient.addColorStop(0, '#ef476f');
            gradient.addColorStop(1, 'rgba(239, 71, 111, 0.3)');
        } else if (score >= 40) {
            gradient.addColorStop(0, '#ffd166');
            gradient.addColorStop(1, 'rgba(255, 209, 102, 0.3)');
        } else {
            gradient.addColorStop(0, '#06d6a0');
            gradient.addColorStop(1, 'rgba(6, 214, 160, 0.3)');
        }

        // Draw bar with rounded top
        ctx.fillStyle = gradient;
        ctx.beginPath();
        const radius = 4;
        ctx.moveTo(x, y + barH);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.lineTo(x + barWidth - radius, y);
        ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + radius);
        ctx.lineTo(x + barWidth, y + barH);
        ctx.fill();

        // Score label
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(score, x + barWidth / 2, y - 6);

        // Account label
        ctx.fillStyle = '#94a3b8';
        ctx.font = '9px Inter, sans-serif';
        const shortId = id.length > 8 ? id.substring(0, 8) + '…' : id;
        ctx.fillText(shortId, x + barWidth / 2, padding.top + chartH + 20);
    });
}

// ═══════════════════════════════════════════════════════════════
//  INITIALIZATION
// ═══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    initParticles();
    initScrollAnimations();
    initUpload();
    initTabs();
    initModeToggle();
    initGraphControls();
    initJsonControls();
    initAccountPanel();
    initCommandPalette();
    initHeatmapControls();
    initComparison();

    // Analyze button
    $('#analyzeBtn').addEventListener('click', runAnalysis);

    // Back to dashboard
    $('#backToDashboard').addEventListener('click', showDashboardPage);

    // Export PDF
    const exportBtn = $('#exportReportBtn');
    if (exportBtn) exportBtn.addEventListener('click', generateReport);
});
