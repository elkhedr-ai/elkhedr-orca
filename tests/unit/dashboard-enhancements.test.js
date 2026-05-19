const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const webDir = path.join(__dirname, '../../apps/web');
const k8sDir = path.join(__dirname, '../../k8s');

describe('T37: Agent Management UI', () => {
  it('should have enhanced agents page with grid/list toggle', () => {
    const pagePath = path.join(webDir, 'src/app/agents/page.tsx');
    assert.ok(fs.existsSync(pagePath), 'agents page exists');
    const content = fs.readFileSync(pagePath, 'utf8');
    assert.ok(content.includes('viewMode'), 'Grid/list toggle');
    assert.ok(content.includes('selectedAgent'), 'Detail panel');
    assert.ok(content.includes('StatusBadge'), 'Status indicators');
    assert.ok(content.includes('currentPage'), 'Pagination');
    assert.ok(content.includes('handleAssignTask'), 'Task assignment');
  });

  it('should support detail panel with task assignment', () => {
    const pagePath = path.join(webDir, 'src/app/agents/page.tsx');
    const content = fs.readFileSync(pagePath, 'utf8');
    assert.ok(content.includes('DetailRow'), 'Detail rows');
    assert.ok(content.includes('Assign Task'), 'Task assignment UI');
    assert.ok(content.includes('tasksCompleted'), 'Task tracking');
    assert.ok(content.includes('avgLatency'), 'Latency metrics');
  });
});

describe('T38: Analytics Dashboard UI', () => {
  it('should have charts using Recharts', () => {
    const pagePath = path.join(webDir, 'src/app/analytics/page.tsx');
    assert.ok(fs.existsSync(pagePath), 'analytics page exists');
    const content = fs.readFileSync(pagePath, 'utf8');
    assert.ok(content.includes('recharts'), 'Recharts imports');
    assert.ok(content.includes('LineChart'), 'Line chart');
    assert.ok(content.includes('BarChart'), 'Bar chart');
    assert.ok(content.includes('PieChart'), 'Pie chart');
  });

  it('should have date range filtering', () => {
    const pagePath = path.join(webDir, 'src/app/analytics/page.tsx');
    const content = fs.readFileSync(pagePath, 'utf8');
    assert.ok(content.includes('dateRange'), 'Date range state');
    assert.ok(content.includes('7d') || content.includes('30d'), 'Date range options');
    assert.ok(content.includes('filteredDaily'), 'Filtered data');
  });

  it('should support CSV export', () => {
    const pagePath = path.join(webDir, 'src/app/analytics/page.tsx');
    const content = fs.readFileSync(pagePath, 'utf8');
    assert.ok(content.includes('handleExportCSV'), 'Export function');
    assert.ok(content.includes('text/csv'), 'CSV blob');
    assert.ok(content.includes('download'), 'Download trigger');
  });

  it('should have real-time cost ticker', () => {
    const pagePath = path.join(webDir, 'src/app/analytics/page.tsx');
    const content = fs.readFileSync(pagePath, 'utf8');
    assert.ok(content.includes('ticker'), 'Ticker state');
    assert.ok(content.includes('setInterval'), 'Interval for updates');
  });
});

describe('T39: Workflow Builder UI', () => {
  it('should have workflow builder page', () => {
    const pagePath = path.join(webDir, 'src/app/workflows/page.tsx');
    assert.ok(fs.existsSync(pagePath), 'workflows page exists');
  });

  it('should use React Flow', () => {
    const pagePath = path.join(webDir, 'src/app/workflows/page.tsx');
    const content = fs.readFileSync(pagePath, 'utf8');
    assert.ok(content.includes('reactflow'), 'React Flow import');
    assert.ok(content.includes('ReactFlow'), 'ReactFlow component');
    assert.ok(content.includes('useNodesState'), 'Node state management');
    assert.ok(content.includes('useEdgesState'), 'Edge state management');
  });

  it('should have node palette with agent types', () => {
    const pagePath = path.join(webDir, 'src/app/workflows/page.tsx');
    const content = fs.readFileSync(pagePath, 'utf8');
    assert.ok(content.includes('nodeTypes'), 'Node types array');
    assert.ok(content.includes('agent'), 'Agent node type');
    assert.ok(content.includes('condition'), 'Condition node type');
    assert.ok(content.includes('loop'), 'Loop node type');
    assert.ok(content.includes('approval'), 'Approval node type');
  });

  it('should support save and execute', () => {
    const pagePath = path.join(webDir, 'src/app/workflows/page.tsx');
    const content = fs.readFileSync(pagePath, 'utf8');
    assert.ok(content.includes('saveWorkflow'), 'Save function');
    assert.ok(content.includes('executeWorkflow'), 'Execute function');
  });
});

describe('T40: WebSocket Collaboration', () => {
  it('should have collaboration server module', () => {
    const collabPath = path.join(__dirname, '../../src/server/collab.js');
    assert.ok(fs.existsSync(collabPath), 'collab.js exists');
    const content = fs.readFileSync(collabPath, 'utf8');
    assert.ok(content.includes('socket.io'), 'Socket.io');
    assert.ok(content.includes('join-room'), 'Room joining');
    assert.ok(content.includes('chat-message'), 'Chat messages');
  });

  it('should support presence and typing indicators', () => {
    const collabPath = path.join(__dirname, '../../src/server/collab.js');
    const content = fs.readFileSync(collabPath, 'utf8');
    assert.ok(content.includes('user-joined'), 'User joined event');
    assert.ok(content.includes('user-left'), 'User left event');
    assert.ok(content.includes('typing'), 'Typing indicator');
    assert.ok(content.includes('cursor-move'), 'Cursor tracking');
  });

  it('should be integrated into main server', () => {
    const serverPath = path.join(__dirname, '../../src/server/index.js');
    const content = fs.readFileSync(serverPath, 'utf8');
    assert.ok(content.includes('CollaborationServer'), 'Server integration');
    assert.ok(content.includes('collab.js'), 'Collaboration import');
  });
});

describe('T53: Kubernetes Manifests', () => {
  it('should have deployment manifest', () => {
    const deployPath = path.join(k8sDir, 'deployment.yaml');
    assert.ok(fs.existsSync(deployPath), 'deployment.yaml exists');
    const content = fs.readFileSync(deployPath, 'utf8');
    assert.ok(content.includes('Deployment'), 'Deployment kind');
    assert.ok(content.includes('replicas: 2'), 'Minimum replicas');
    assert.ok(content.includes('livenessProbe'), 'Liveness probe');
    assert.ok(content.includes('readinessProbe'), 'Readiness probe');
  });

  it('should have service manifest', () => {
    const svcPath = path.join(k8sDir, 'service.yaml');
    assert.ok(fs.existsSync(svcPath), 'service.yaml exists');
    const content = fs.readFileSync(svcPath, 'utf8');
    assert.ok(content.includes('Service'), 'Service kind');
    assert.ok(content.includes('ClusterIP'), 'ClusterIP type');
  });

  it('should have HPA manifest', () => {
    const hpaPath = path.join(k8sDir, 'hpa.yaml');
    assert.ok(fs.existsSync(hpaPath), 'hpa.yaml exists');
    const content = fs.readFileSync(hpaPath, 'utf8');
    assert.ok(content.includes('HorizontalPodAutoscaler'), 'HPA kind');
    assert.ok(content.includes('minReplicas: 2'), 'Min replicas 2');
    assert.ok(content.includes('maxReplicas: 10'), 'Max replicas 10');
  });

  it('should have ingress manifest with TLS', () => {
    const ingPath = path.join(k8sDir, 'ingress.yaml');
    assert.ok(fs.existsSync(ingPath), 'ingress.yaml exists');
    const content = fs.readFileSync(ingPath, 'utf8');
    assert.ok(content.includes('Ingress'), 'Ingress kind');
    assert.ok(content.includes('tls'), 'TLS config');
    assert.ok(content.includes('nginx'), 'Nginx class');
  });

  it('should have configmap and secret', () => {
    assert.ok(fs.existsSync(path.join(k8sDir, 'configmap.yaml')), 'configmap.yaml exists');
    assert.ok(fs.existsSync(path.join(k8sDir, 'secret.yaml')), 'secret.yaml exists');
  });

  it('should have PVC for persistence', () => {
    const pvcPath = path.join(k8sDir, 'pvc.yaml');
    assert.ok(fs.existsSync(pvcPath), 'pvc.yaml exists');
    const content = fs.readFileSync(pvcPath, 'utf8');
    assert.ok(content.includes('PersistentVolumeClaim'), 'PVC kind');
  });
});
