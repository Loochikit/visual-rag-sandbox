/**
 * canvas-vector.js
 * Renders the 2D vector space visualization using a native HTML5 Canvas
 * driven by an interactive spring-force physics engine.
 */

class VectorSpaceVisualizer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext("2d");
    this.nodes = [];       // List of node objects { id, text, x, y, vx, vy, targetX, targetY, retrieved, hover }
    this.queryNode = null; // Query node representation { x, y, text }
    this.links = [];       // Visual lines from query node to retrieved chunks
    this.isDragging = false;
    this.draggedNode = null;
    
    this.zoom = 1.0;
    this.offsetX = 0;
    this.offsetY = 0;

    this.initEvents();
    this.resize();
    this.animate();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
  }

  // Setup interaction events
  initEvents() {
    window.addEventListener("resize", () => this.resize());

    this.canvas.addEventListener("mousedown", (e) => {
      const pos = this.getMousePos(e);
      const clicked = this.findNodeAt(pos.x, pos.y);
      if (clicked) {
        this.isDragging = true;
        this.draggedNode = clicked;
        clicked.isDragged = true;
      } else {
        // start pan
        this.isDragging = true;
        this.panStart = { x: e.clientX - this.offsetX, y: e.clientY - this.offsetY };
      }
    });

    this.canvas.addEventListener("mousemove", (e) => {
      const pos = this.getMousePos(e);
      
      // Update hover state
      this.nodes.forEach(n => n.hover = false);
      const hovered = this.findNodeAt(pos.x, pos.y);
      if (hovered) hovered.hover = true;

      if (this.isDragging) {
        if (this.draggedNode) {
          // Update node positions mapped back from screen coordinates
          this.draggedNode.x = (pos.x - this.canvas.width / 2) / (this.canvas.width * 0.45);
          this.draggedNode.y = (pos.y - this.canvas.height / 2) / (this.canvas.height * 0.45);
          this.draggedNode.vx = 0;
          this.draggedNode.vy = 0;
        } else if (this.panStart) {
          this.offsetX = e.clientX - this.panStart.x;
          this.offsetY = e.clientY - this.panStart.y;
        }
      }
    });

    this.canvas.addEventListener("mouseup", () => {
      this.isDragging = false;
      if (this.draggedNode) {
        this.draggedNode.isDragged = false;
        this.draggedNode = null;
      }
      this.panStart = null;
    });

    this.canvas.addEventListener("mouseleave", () => {
      this.isDragging = false;
      if (this.draggedNode) this.draggedNode.isDragged = false;
      this.draggedNode = null;
      this.panStart = null;
    });
  }

  getMousePos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - this.offsetX),
      y: (e.clientY - rect.top - this.offsetY)
    };
  }

  findNodeAt(x, y) {
    // Convert screen coordinates back to node positions
    const midX = this.canvas.width / 2;
    const midY = this.canvas.height / 2;
    const scale = Math.min(this.canvas.width, this.canvas.height) * 0.45;

    for (const node of this.nodes) {
      const nx = midX + node.x * scale;
      const ny = midY + node.y * scale;
      const dist = Math.hypot(x - nx, y - ny);
      if (dist < 15) return node; // radius hit detection
    }

    if (this.queryNode) {
      const qx = midX + this.queryNode.x * scale;
      const qy = midY + this.queryNode.y * scale;
      const dist = Math.hypot(x - qx, y - qy);
      if (dist < 18) return this.queryNode;
    }

    return null;
  }

  /**
   * Set nodes mapping from vector store projections
   * @param {Array} backendChunks Chunks with backend projected [x, y] coordinates
   */
  setNodes(backendChunks) {
    // Merge new coordinates but preserve velocity if node existed
    this.nodes = backendChunks.map(chunk => {
      const existing = this.nodes.find(n => n.id === chunk.id);
      return {
        id: chunk.id,
        text: chunk.text,
        x: existing ? existing.x : (chunk.x || (Math.random() - 0.5) * 0.5),
        y: existing ? existing.y : (chunk.y || (Math.random() - 0.5) * 0.5),
        targetX: chunk.x || 0,
        targetY: chunk.y || 0,
        vx: existing ? existing.vx : 0,
        vy: existing ? existing.vy : 0,
        retrieved: false,
        score: 0,
        hover: false
      };
    });
    this.queryNode = null;
    this.links = [];
  }

  /**
   * Animate similarity retrieval projection
   * @param {Object} queryCoords Projected query { x, y }
   * @param {Array} retrievedList List of retrieved { id, score }
   */
  projectQuery(queryCoords, retrievedList) {
    // 1. Reset all node statuses
    this.nodes.forEach(n => {
      n.retrieved = false;
      n.score = 0;
    });

    // 2. Set query node
    this.queryNode = {
      id: "query",
      text: "User Query",
      x: queryCoords.x,
      y: queryCoords.y,
      vx: 0, vy: 0,
      isQuery: true
    };

    // 3. Highlight retrieved nodes
    retrievedList.forEach(item => {
      const node = this.nodes.find(n => n.id === item.id);
      if (node) {
        node.retrieved = true;
        node.score = item.score;
      }
    });
  }

  clearQuery() {
    this.queryNode = null;
    this.nodes.forEach(n => {
      n.retrieved = false;
      n.score = 0;
    });
  }

  // Physics loop (repulsion & spring forces to stabilize clusters)
  updatePhysics() {
    const kRepulsion = 0.0003;  // Coulomb repulsion strength
    const kSpring = 0.02;      // Spring alignment to target coordinates
    const damping = 0.85;       // Velocity damping

    // Apply pairwise node repulsion (so items don't overlap)
    for (let i = 0; i < this.nodes.length; i++) {
      const nodeA = this.nodes[i];
      if (nodeA.isDragged) continue;

      for (let j = i + 1; j < this.nodes.length; j++) {
        const nodeB = this.nodes[j];
        
        const dx = nodeB.x - nodeA.x;
        const dy = nodeB.y - nodeA.y;
        const dist = Math.hypot(dx, dy) || 0.01;

        if (dist < 0.25) { // Force repulsion for close nodes
          const force = kRepulsion / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          
          if (!nodeA.isDragged) {
            nodeA.vx -= fx;
            nodeA.vy -= fy;
          }
          if (!nodeB.isDragged) {
            nodeB.vx += fx;
            nodeB.vy += fy;
          }
        }
      }
      
      // Pull nodes towards their mathematical projection coordinates (stable anchor)
      const dx = nodeA.targetX - nodeA.x;
      const dy = nodeA.targetY - nodeA.y;
      nodeA.vx += dx * kSpring;
      nodeA.vy += dy * kSpring;

      // Integrate velocity and damping
      nodeA.vx *= damping;
      nodeA.vy *= damping;
      nodeA.x += nodeA.vx;
      nodeA.y += nodeA.vy;

      // Bound nodes within canvas limits [-1, 1]
      nodeA.x = Math.max(-0.95, Math.min(0.95, nodeA.x));
      nodeA.y = Math.max(-0.95, Math.min(0.95, nodeA.y));
    }
  }

  // Drawing loop
  draw() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Draw background grid lines
    this.drawGrid();

    const midX = this.canvas.width / 2;
    const midY = this.canvas.height / 2;
    const scale = Math.min(this.canvas.width, this.canvas.height) * 0.45;

    this.ctx.save();
    this.ctx.translate(this.offsetX, this.offsetY);

    // 1. Draw connections from Query to Retrieved Chunks (Links)
    if (this.queryNode) {
      const qx = midX + this.queryNode.x * scale;
      const qy = midY + this.queryNode.y * scale;

      this.nodes.forEach(node => {
        if (node.retrieved) {
          const nx = midX + node.x * scale;
          const ny = midY + node.y * scale;

          // Glowing neon line
          this.ctx.shadowBlur = 10;
          this.ctx.shadowColor = "rgba(255, 214, 0, 0.4)";
          this.ctx.strokeStyle = "rgba(255, 214, 0, 0.6)";
          this.ctx.lineWidth = 2;
          this.ctx.setLineDash([4, 4]); // Animated dashes
          this.ctx.lineDashOffset = -(Date.now() / 40) % 8;
          
          this.ctx.beginPath();
          this.ctx.moveTo(qx, qy);
          this.ctx.lineTo(nx, ny);
          this.ctx.stroke();
          this.ctx.setLineDash([]); // Reset dash
          this.ctx.shadowBlur = 0; // Reset shadow
        }
      });
    }

    // 2. Draw standard chunk nodes
    this.nodes.forEach(node => {
      const nx = midX + node.x * scale;
      const ny = midY + node.y * scale;

      // Glowing outer ring for hover/retrieved states
      if (node.retrieved) {
        this.ctx.beginPath();
        this.ctx.arc(nx, ny, 14, 0, Math.PI * 2);
        this.ctx.fillStyle = "rgba(0, 230, 118, 0.15)";
        this.ctx.strokeStyle = "rgba(0, 230, 118, 0.8)";
        this.ctx.lineWidth = 2;
        this.ctx.fill();
        this.ctx.stroke();
      } else if (node.hover) {
        this.ctx.beginPath();
        this.ctx.arc(nx, ny, 12, 0, Math.PI * 2);
        this.ctx.fillStyle = "rgba(0, 242, 254, 0.15)";
        this.ctx.strokeStyle = "rgba(0, 242, 254, 0.8)";
        this.ctx.lineWidth = 1.5;
        this.ctx.fill();
        this.ctx.stroke();
      }

      // Inner dot
      this.ctx.beginPath();
      this.ctx.arc(nx, ny, 6, 0, Math.PI * 2);
      this.ctx.fillStyle = node.retrieved ? "#00e676" : "#00f2fe";
      this.ctx.fill();

      // Draw chunk labels
      this.ctx.font = "10px Inter";
      this.ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
      this.ctx.textAlign = "center";
      this.ctx.fillText(node.id, nx, ny - 18);

      // Score indicators
      if (node.retrieved && node.score > 0) {
        this.ctx.font = "bold 9px JetBrains Mono";
        this.ctx.fillStyle = "#ffd600";
        this.ctx.fillText(`cos:${node.score}`, nx, ny + 24);
      }
    });

    // 3. Draw Query Node
    if (this.queryNode) {
      const qx = midX + this.queryNode.x * scale;
      const qy = midY + this.queryNode.y * scale;

      // Pulse ring animation
      const pulseSize = 14 + Math.sin(Date.now() / 150) * 4;
      this.ctx.beginPath();
      this.ctx.arc(qx, qy, pulseSize, 0, Math.PI * 2);
      this.ctx.fillStyle = "rgba(255, 214, 0, 0.15)";
      this.ctx.strokeStyle = "rgba(255, 214, 0, 0.8)";
      this.ctx.lineWidth = 1.5;
      this.ctx.fill();
      this.ctx.stroke();

      // Query core dot
      this.ctx.beginPath();
      this.ctx.arc(qx, qy, 7, 0, Math.PI * 2);
      this.ctx.fillStyle = "#ffd600";
      this.ctx.fill();

      this.ctx.font = "bold 10px Inter";
      this.ctx.fillStyle = "#ffd600";
      this.ctx.textAlign = "center";
      this.ctx.fillText("QUERY", qx, qy - 20);
    }

    // 4. Render details popup on hovered node
    const activeHoverNode = this.nodes.find(n => n.hover) || (this.queryNode && this.queryNode.hover ? this.queryNode : null);
    if (activeHoverNode) {
      this.drawTooltip(activeHoverNode, midX, midY, scale);
    }

    this.ctx.restore();
  }

  drawGrid() {
    this.ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
    this.ctx.lineWidth = 1;
    
    // Vertical grid lines
    const gridSpacing = 40;
    for (let x = this.offsetX % gridSpacing; x < this.canvas.width; x += gridSpacing) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, this.canvas.height);
      this.ctx.stroke();
    }

    // Horizontal grid lines
    for (let y = this.offsetY % gridSpacing; y < this.canvas.height; y += gridSpacing) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.canvas.width, y);
      this.ctx.stroke();
    }
    
    // Draw concentric scale rings to frame vector bounds
    const midX = this.canvas.width / 2 + this.offsetX;
    const midY = this.canvas.height / 2 + this.offsetY;
    const scale = Math.min(this.canvas.width, this.canvas.height) * 0.45;
    
    this.ctx.strokeStyle = "rgba(0, 242, 254, 0.06)";
    this.ctx.setLineDash([5, 5]);
    
    [0.3, 0.6, 0.9].forEach(r => {
      this.ctx.beginPath();
      this.ctx.arc(midX, midY, scale * r, 0, Math.PI * 2);
      this.ctx.stroke();
    });
    this.ctx.setLineDash([]);
  }

  drawTooltip(node, midX, midY, scale) {
    const nx = midX + node.x * scale;
    const ny = midY + node.y * scale;

    const pad = 10;
    const boxW = 220;
    const boxH = 90;
    
    let boxX = nx + 15;
    let boxY = ny - boxH / 2;

    // Boundary corrections
    if (boxX + boxW > this.canvas.width - this.offsetX) {
      boxX = nx - boxW - 15;
    }
    if (boxY < -this.offsetY) boxY = 10 - this.offsetY;
    if (boxY + boxH > this.canvas.height - this.offsetY) boxY = this.canvas.height - boxH - 10 - this.offsetY;

    // Tooltip backdrop glass card
    this.ctx.fillStyle = "rgba(10, 16, 28, 0.95)";
    this.ctx.strokeStyle = node.isQuery ? "#ffd600" : (node.retrieved ? "#00e676" : "#00f2fe");
    this.ctx.lineWidth = 1;
    
    this.ctx.beginPath();
    this.ctx.roundRect(boxX, boxY, boxW, boxH, 6);
    this.ctx.fill();
    this.ctx.stroke();

    // Text Content
    this.ctx.font = "bold 11px Outfit";
    this.ctx.fillStyle = node.isQuery ? "#ffd600" : (node.retrieved ? "#00e676" : "#00f2fe");
    this.ctx.textAlign = "left";
    this.ctx.fillText(node.id.toUpperCase(), boxX + pad, boxY + 18);

    this.ctx.font = "10px Inter";
    this.ctx.fillStyle = "rgba(255,255,255,0.8)";
    
    // Word wrap helper
    const text = node.text;
    const words = text.split(" ");
    let line = "";
    let lines = [];
    const maxLineW = boxW - pad * 2;

    for (let i = 0; i < words.length; i++) {
      const testLine = line + words[i] + " ";
      const metrics = this.ctx.measureText(testLine);
      if (metrics.width > maxLineW && i > 0) {
        lines.push(line);
        line = words[i] + " ";
      } else {
        line = testLine;
      }
    }
    lines.push(line);

    // Draw up to 4 lines
    let yPos = boxY + 32;
    lines.slice(0, 4).forEach(l => {
      this.ctx.fillText(l.trim(), boxX + pad, yPos);
      yPos += 12;
    });

    if (lines.length > 4) {
      this.ctx.fillText("...", boxX + pad, yPos);
    }
  }

  animate() {
    this.updatePhysics();
    this.draw();
    requestAnimationFrame(() => this.animate());
  }
}

// Attach to window for modular loading
window.VectorSpaceVisualizer = VectorSpaceVisualizer;
