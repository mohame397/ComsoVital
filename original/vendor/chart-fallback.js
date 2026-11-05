(() => {
  if (typeof window.Chart !== "undefined") return;
  class CanvasFallbackChart {
    static isFallback = true;
    constructor(canvas, config) {
      this.canvas = canvas;
      this.context = canvas.getContext("2d");
      this.data = config.data;
      this.options = config.options || {};
      this.resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => this.render()) : null;
      if (this.resizeObserver) this.resizeObserver.observe(canvas.parentElement);
      this.render();
    }
    update() { this.render(); }
    render() {
      if (!this.context) return;
      const canvas = this.canvas;
      const bounds = canvas.parentElement.getBoundingClientRect();
      const w = Math.max(250, bounds.width || 500);
      const h = Math.max(140, bounds.height || 225);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = this.context;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const values = (this.data.datasets[0]?.data || []).map(Number).filter(Number.isFinite);
      if (!values.length) return;
      const scale = this.options.scales?.y || {};
      let low = Math.min(...values, Number.isFinite(scale.suggestedMin) ? scale.suggestedMin : Infinity);
      let high = Math.max(...values, Number.isFinite(scale.suggestedMax) ? scale.suggestedMax : -Infinity);
      if (high === low) { high += 1; low -= 1; }
      const plot = { x: 43, y: 14, w: w - 58, h: h - 45 };
      const toX = i => plot.x + i / Math.max(1, values.length - 1) * plot.w;
      const toY = v => plot.y + plot.h - (v - low) / (high - low) * plot.h;
      ctx.font = "10px system-ui,sans-serif";
      ctx.strokeStyle = "#e2ebef";
      ctx.fillStyle = "#8da0ad";
      ctx.textAlign = "right";
      for (let i = 0; i <= 4; i++) {
        const y = plot.y + i / 4 * plot.h;
        ctx.beginPath();ctx.moveTo(plot.x,y);ctx.lineTo(plot.x + plot.w,y);ctx.stroke();
        ctx.fillText((high - i / 4 * (high - low)).toFixed(1), plot.x - 7, y + 4);
      }
      const dataset = this.data.datasets[0];
      const color = dataset.borderColor || "#35b4a6";
      const gradient = ctx.createLinearGradient(0, plot.y, 0, plot.y + plot.h);
      gradient.addColorStop(0, `${color}36`);gradient.addColorStop(1, `${color}00`);
      ctx.beginPath();ctx.moveTo(toX(0), toY(values[0]));
      for (let i = 1; i < values.length; i++) ctx.lineTo(toX(i), toY(values[i]));
      ctx.lineTo(toX(values.length-1),plot.y+plot.h);ctx.lineTo(toX(0),plot.y+plot.h);ctx.closePath();ctx.fillStyle=gradient;ctx.fill();
      ctx.beginPath();ctx.moveTo(toX(0),toY(values[0]));
      for(let i=1;i<values.length;i++)ctx.lineTo(toX(i),toY(values[i]));
      ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke();
      ctx.fillStyle=color;
      for(let i=0;i<values.length;i++){if(i%Math.max(1,Math.ceil(values.length/12))===0||i===values.length-1){ctx.beginPath();ctx.arc(toX(i),toY(values[i]),2.1,0,Math.PI*2);ctx.fill();}}
      const labels=this.data.labels||[];ctx.font="10px system-ui,sans-serif";ctx.fillStyle="#8da0ad";ctx.textAlign="center";
      for(let i=0;i<labels.length;i+=Math.max(1,Math.ceil(labels.length/4))){let label=String(labels[i]||"");ctx.fillText(label.slice(-8),toX(i),h-12);}
    }
    destroy(){if(this.resizeObserver)this.resizeObserver.disconnect();this.context?.clearRect(0,0,this.canvas.width,this.canvas.height);}
  }
  window.Chart = CanvasFallbackChart;
})();
