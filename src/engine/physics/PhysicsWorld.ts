import type { Terrain } from '../terrain/Terrain.js';
import type { PhysicsConfig, SphereBody, TerrainCollision, Vec3 } from './types.js';

const DEFAULT_CONFIG: PhysicsConfig = {
  gravity: { x: 0, y: -9.81, z: 0 },
  fixedDelta: 1 / 60,
  maxSubSteps: 8,
  maxFrameDelta: 0.1,
  positionCorrection: 0.8
};

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x
});
const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
const normalize = (a: Vec3): Vec3 => {
  const l = length(a);
  return l > 1e-9 ? scale(a, 1 / l) : { x: 0, y: 1, z: 0 };
};

/** Небольшой heightfield-решатель: проверяет центр и восемь точек вокруг проекции сферы. */
export class PhysicsWorld {
  readonly config: PhysicsConfig;
  readonly bodies = new Map<string, SphereBody>();
  private readonly terrain: Terrain;

  constructor(terrain: Terrain, config: Partial<PhysicsConfig> = {}) {
    this.terrain = terrain;
    this.config = { ...DEFAULT_CONFIG, ...config, gravity: { ...DEFAULT_CONFIG.gravity, ...config.gravity } };
    if (!(this.config.fixedDelta > 0)) throw new Error('fixedDelta должен быть больше нуля');
  }

  addSphere(options: Partial<SphereBody> & Pick<SphereBody, 'id' | 'position' | 'radius'>): SphereBody {
    if (this.bodies.has(options.id)) throw new Error('Тело с таким id уже существует');
    if (!(options.radius > 0)) throw new Error('Радиус сферы должен быть больше нуля');
    const body: SphereBody = {
      id: options.id,
      position: { ...options.position },
      previousPosition: { ...options.position },
      velocity: { x: 0, y: 0, z: 0 },
      angularVelocity: { x: 0, y: 0, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
      radius: options.radius,
      mass: options.mass && options.mass > 0 ? options.mass : 1,
      restitution: Math.max(0, Math.min(1, options.restitution ?? 0.12)),
      friction: Math.max(0, options.friction ?? 0.65),
      linearDamping: Math.max(0, options.linearDamping ?? 0.015),
      angularDamping: Math.max(0, options.angularDamping ?? 0.02),
      grounded: false
    };
    this.bodies.set(body.id, body);
    return body;
  }

  removeBody(id: string): void {
    this.bodies.delete(id);
  }

  step(dt = this.config.fixedDelta): void {
    for (const body of this.bodies.values()) this.stepSphere(body, dt);
  }

  private findTerrainContact(body: SphereBody): TerrainCollision | null {
    const r = body.radius;
    const offsets: Array<[number, number]> = [
      [0, 0], [0.7, 0], [-0.7, 0], [0, 0.7], [0, -0.7],
      [0.5, 0.5], [-0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]
    ];
    let deepest: TerrainCollision | null = null;

    for (const [ox, oz] of offsets) {
      const dx = ox * r;
      const dz = oz * r;
      const radialSq = dx * dx + dz * dz;
      if (radialSq >= r * r) continue;
      const x = body.position.x + dx;
      const z = body.position.z + dz;
      const surfaceY = this.terrain.getHeight(x, z);
      const sphereBottom = body.position.y - Math.sqrt(r * r - radialSq);
      const verticalPenetration = surfaceY - sphereBottom;
      if (verticalPenetration <= 0) continue;
      const normal = this.terrain.getNormal(x, z);
      const penetration = verticalPenetration / Math.max(0.2, normal.y);
      if (!deepest || penetration > deepest.penetration) {
        deepest = {
          point: { x, y: surfaceY, z },
          normal,
          penetration
        };
      }
    }
    return deepest;
  }

  private resolveTerrainContact(body: SphereBody, contact: TerrainCollision, dt: number): void {
    const n = normalize(contact.normal);
    body.position = add(body.position, scale(n, contact.penetration * this.config.positionCorrection));

    // Для сферы радиус-вектор контакта направлен от центра к поверхности.
    // Не вычисляем его из уже скорректированной позиции: это давало нестабильный рычаг.
    const arm = scale(n, -body.radius);
    const contactVelocity = add(body.velocity, cross(body.angularVelocity, arm));
    const normalSpeed = dot(contactVelocity, n);

    const inverseMass = 1 / body.mass;
    const inverseInertia = 2.5 / (body.mass * body.radius * body.radius);
    let normalImpulseMagnitude = 0;

    // Обычный импульс отскока — только если тело движется внутрь поверхности.
    if (normalSpeed < 0) {
      const armCrossNormal = cross(arm, n);
      const rotationalTerm = dot(cross(scale(armCrossNormal, inverseInertia), arm), n);
      const denominator = inverseMass + rotationalTerm;
      normalImpulseMagnitude = -(1 + body.restitution) * normalSpeed / Math.max(denominator, 1e-8);
      const impulse = scale(n, normalImpulseMagnitude);
      body.velocity = add(body.velocity, scale(impulse, inverseMass));
      body.angularVelocity = add(body.angularVelocity, scale(cross(arm, impulse), inverseInertia));
    }

    // Даже когда нормальная скорость уже равна нулю, опора продолжает
    // прижимать шар к склону. Используем её импульс для ограничения трения.
    const gravityIntoSurface = Math.max(0, -dot(this.config.gravity, n));
    const supportImpulse = Math.max(
      normalImpulseMagnitude,
      body.mass * gravityIntoSurface * dt
    );

    const afterNormal = add(body.velocity, cross(body.angularVelocity, arm));
    const tangentVelocity = sub(afterNormal, scale(n, dot(afterNormal, n)));
    const tangentSpeed = length(tangentVelocity);
    if (tangentSpeed > 1e-7 && body.friction > 0 && supportImpulse > 0) {
      const tangent = scale(tangentVelocity, 1 / tangentSpeed);
      const tangentArm = cross(arm, tangent);
      const rotationalTerm = dot(cross(scale(tangentArm, inverseInertia), arm), tangent);
      const denominator = inverseMass + rotationalTerm;
      const desiredImpulse = tangentSpeed / Math.max(denominator, 1e-8);
      const frictionImpulse = Math.min(desiredImpulse, body.friction * supportImpulse);
      const frictionVector = scale(tangent, -frictionImpulse);
      body.velocity = add(body.velocity, scale(frictionVector, inverseMass));
      body.angularVelocity = add(body.angularVelocity, scale(cross(arm, frictionVector), inverseInertia));
    }

    // Сам геометрический контакт считается grounded, даже если импульс не нужен.
    body.grounded = true;
  }

  private stepSphere(body: SphereBody, dt: number): void {
    body.previousPosition = { ...body.position };
    body.grounded = false;
    body.velocity = add(body.velocity, scale(this.config.gravity, dt));

    const travel = length(scale(body.velocity, dt));
    // Ограниченные подшаги уменьшают риск туннелирования быстрых сфер через рельеф.
    const subSteps = Math.max(1, Math.min(12, Math.ceil(travel / Math.max(body.radius * 0.35, 0.02))));
    const subDt = dt / subSteps;

    for (let i = 0; i < subSteps; i++) {
      body.position = add(body.position, scale(body.velocity, subDt));
      const contact = this.findTerrainContact(body);
      if (contact) this.resolveTerrainContact(body, contact, subDt);
    }

    body.velocity = scale(body.velocity, Math.max(0, 1 - body.linearDamping * dt));
    body.angularVelocity = scale(body.angularVelocity, Math.max(0, 1 - body.angularDamping * dt));
    this.integrateOrientation(body, dt);
  }

  private integrateOrientation(body: SphereBody, dt: number): void {
    const w = body.angularVelocity;
    const speed = length(w);
    if (speed < 1e-8) return;
    const halfAngle = speed * dt * 0.5;
    const s = Math.sin(halfAngle) / speed;
    const dq = { x: w.x * s, y: w.y * s, z: w.z * s, w: Math.cos(halfAngle) };
    const q = body.orientation;
    const next = {
      x: q.w * dq.x + q.x * dq.w + q.y * dq.z - q.z * dq.y,
      y: q.w * dq.y - q.x * dq.z + q.y * dq.w + q.z * dq.x,
      z: q.w * dq.z + q.x * dq.y - q.y * dq.x + q.z * dq.w,
      w: q.w * dq.w - q.x * dq.x - q.y * dq.y - q.z * dq.z
    };
    const norm = Math.hypot(next.x, next.y, next.z, next.w) || 1;
    body.orientation = { x: next.x / norm, y: next.y / norm, z: next.z / norm, w: next.w / norm };
  }

  /** Линейная интерполяция для визуализации между физическими шагами. */
  getInterpolatedPosition(id: string, alpha: number): Vec3 {
    const body = this.bodies.get(id);
    if (!body) throw new Error('Физическое тело не найдено: ' + id);
    const t = Math.max(0, Math.min(1, alpha));
    return {
      x: body.previousPosition.x + (body.position.x - body.previousPosition.x) * t,
      y: body.previousPosition.y + (body.position.y - body.previousPosition.y) * t,
      z: body.previousPosition.z + (body.position.z - body.previousPosition.z) * t
    };
  }
}
