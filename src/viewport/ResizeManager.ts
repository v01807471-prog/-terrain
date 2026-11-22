export class ResizeManager {
  private observer: ResizeObserver;
  width = 1;
  height = 1;
  pixelRatio = 1;
  aspect = 1;

  constructor(private readonly element: HTMLElement, private readonly onResize: (width:number,height:number,pixelRatio:number)=>void) {
    this.observer = new ResizeObserver(() => this.measure());
    this.observer.observe(element);
    window.addEventListener('orientationchange', this.measure);
    this.measure();
  }
  private measure = () => {
    const rect = this.element.getBoundingClientRect();
    this.width = Math.max(1, Math.floor(rect.width));
    this.height = Math.max(1, Math.floor(rect.height));
    this.aspect = this.width / this.height;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.onResize(this.width, this.height, this.pixelRatio);
  };
  dispose() { this.observer.disconnect(); window.removeEventListener('orientationchange', this.measure); }
}
