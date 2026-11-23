import type { QuadTile } from './QuadTile.ts';

export class QuadNode {
  readonly key: string;
  readonly level: number;
  readonly xIndex: number;
  readonly zIndex: number;
  readonly size: number;
  readonly minX: number;
  readonly minZ: number;
  private childNodes?: readonly QuadNode[];

  constructor(rootSize: number, level: number, xIndex: number, zIndex: number) {
    this.level = level;
    this.xIndex = xIndex;
    this.zIndex = zIndex;
    this.size = rootSize / 2 ** level;
    this.minX = -rootSize / 2 + xIndex * this.size;
    this.minZ = -rootSize / 2 + zIndex * this.size;
    this.key = `${level}:${xIndex}:${zIndex}`;
  }

  get tile(): QuadTile {
    return {
      key: this.key,
      level: this.level,
      xIndex: this.xIndex,
      zIndex: this.zIndex,
      size: this.size,
      minX: this.minX,
      minZ: this.minZ,
      centerX: this.minX + this.size / 2,
      centerZ: this.minZ + this.size / 2
    };
  }

  children(rootSize: number): readonly QuadNode[] {
    if (!this.childNodes) {
      const level = this.level + 1;
      const x = this.xIndex * 2;
      const z = this.zIndex * 2;
      this.childNodes = [
        new QuadNode(rootSize, level, x, z),
        new QuadNode(rootSize, level, x + 1, z),
        new QuadNode(rootSize, level, x, z + 1),
        new QuadNode(rootSize, level, x + 1, z + 1)
      ];
    }
    return this.childNodes;
  }
}
