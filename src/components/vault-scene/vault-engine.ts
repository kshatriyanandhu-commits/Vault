import * as THREE from "three";

/**
 * Argus Vault — procedural 3D vault door.
 *
 * The scene is a small state machine driven by `setPhase()`:
 *   sealed    — closed door, bolts extended, amber standby LED
 *   typing    — dial jitters as the user types the master password
 *   unlocking — dial spins to the combination, bolts retract, iris dilates
 *   open      — door swung open, glowing cyan core
 *   error     — red fault flash + mechanical shake (rejected sign-in)
 *   locked    — door sealed again, slow amber blink
 *
 * Everything is built procedurally (no external assets) with PBR materials and
 * an IBL environment for realistic brushed steel. Respects
 * prefers-reduced-motion: the animation loop is replaced by on-demand renders.
 */

export type VaultPhase =
  | "sealed"
  | "typing"
  | "unlocking"
  | "open"
  | "error"
  | "locked";

type Targets = {
  doorAngle: number;
  bolts: number; // 1 = extended, 0 = retracted
  iris: number; // 0 = closed, 1 = open
  glow: number; // core emissive intensity
};

const PHASE_TARGETS: Record<VaultPhase, Targets> = {
  sealed: { doorAngle: 0, bolts: 1, iris: 0, glow: 0.25 },
  typing: { doorAngle: 0, bolts: 1, iris: 0, glow: 0.4 },
  unlocking: { doorAngle: 0, bolts: 0, iris: 1, glow: 1.4 },
  open: { doorAngle: -1.92, bolts: 0, iris: 1, glow: 1.6 },
  error: { doorAngle: 0.05, bolts: 1, iris: 0, glow: 0.15 },
  locked: { doorAngle: 0, bolts: 1, iris: 0, glow: 0.2 },
};

const COLORS = {
  cyan: new THREE.Color("#38dbe8"),
  amber: new THREE.Color("#f2b544"),
  red: new THREE.Color("#f87171"),
  green: new THREE.Color("#4ade80"),
};

/** Procedural brushed-steel texture (roughness + bump). */
function makeBrushedTexture(): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, size, size);
  // Concentric brushing arcs
  for (let i = 0; i < 2400; i++) {
    const r = 30 + Math.random() * size * 0.75;
    const start = Math.random() * Math.PI * 2;
    const span = 0.15 + Math.random() * 0.7;
    const light = Math.random() > 0.5;
    ctx.strokeStyle = light
      ? `rgba(255,255,255,${0.015 + Math.random() * 0.05})`
      : `rgba(0,0,0,${0.015 + Math.random() * 0.05})`;
    ctx.lineWidth = 0.6 + Math.random() * 1.4;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, r, start, start + span);
    ctx.stroke();
  }
  // Fine grain
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    img.data[i] = Math.min(255, Math.max(0, img.data[i] + n));
    img.data[i + 1] = img.data[i]!;
    img.data[i + 2] = img.data[i]!;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

export class VaultEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private rafId: number | null = null;
  private resizeObserver: ResizeObserver;
  private disposables: Array<{ dispose: () => void }> = [];
  private reducedMotion: boolean;

  private doorPivot = new THREE.Group();
  private dialGroup = new THREE.Group();
  private irisPivots: THREE.Group[] = [];
  private boltMeshes: THREE.Mesh[] = [];
  private ledGreen: THREE.MeshStandardMaterial;
  private ledAmber: THREE.MeshStandardMaterial;
  private ledRed: THREE.MeshStandardMaterial;
  private coreGlow: THREE.MeshStandardMaterial;
  private coreLight: THREE.PointLight;
  private doorShaker = new THREE.Group();

  private phase: VaultPhase = "sealed";
  private current: Targets = { ...PHASE_TARGETS.sealed };
  private dialVelocity = 0;
  private shake = 0;
  private elapsed = 0;
  private pointer = { x: 0, y: 0 };
  private cameraBase = new THREE.Vector3(0.55, 0.3, 7.6);

  constructor(container: HTMLElement) {
    this.container = container;
    this.reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07090c);
    this.scene.fog = new THREE.Fog(0x07090c, 10, 18);

    this.camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 60);
    this.camera.position.copy(this.cameraBase);
    this.camera.lookAt(0, 0, 0);

    this.setupEnvironment();
    this.setupLights();
    const mats = this.buildVault();

    this.ledGreen = mats.ledGreen;
    this.ledAmber = mats.ledAmber;
    this.ledRed = mats.ledRed;
    this.coreGlow = mats.coreGlow;
    this.coreLight = mats.coreLight;

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);

    container.addEventListener("pointermove", this.onPointerMove);
    container.addEventListener("pointerleave", this.onPointerLeave);

    if (this.reducedMotion) {
      this.snapToPhase("sealed");
      this.renderOnce();
    } else {
      this.loop();
    }
  }

  /* ------------------------------------------------------------------ setup */

  private setupEnvironment(): void {
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      // Built-in studio environment for believable metal reflections.
      const envScene = new THREE.Scene();
      const top = new THREE.Mesh(
        new THREE.PlaneGeometry(20, 20),
        new THREE.MeshBasicMaterial({ color: 0x5a6a78, side: THREE.FrontSide }),
      );
      top.position.y = 6;
      top.rotation.x = Math.PI / 2;
      envScene.add(top);
      const side = new THREE.Mesh(
        new THREE.PlaneGeometry(20, 14),
        new THREE.MeshBasicMaterial({ color: 0x1c2830, side: THREE.FrontSide }),
      );
      side.position.set(-8, 0, 0);
      side.rotation.y = Math.PI / 2;
      envScene.add(side);
      const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(6, 10),
        new THREE.MeshBasicMaterial({ color: 0x38dbe8, side: THREE.FrontSide }),
      );
      glow.position.set(8, 0, -2);
      glow.rotation.y = -Math.PI / 2;
      envScene.add(glow);
      const envTex = pmrem.fromScene(envScene, 0.08).texture;
      this.scene.environment = envTex;
      this.scene.environmentIntensity = 0.5;
      this.disposables.push(envTex);
      [top.geometry, side.geometry, glow.geometry].forEach((g) =>
        this.disposables.push(g),
      );
      [top.material, side.material, glow.material].forEach((m) =>
        this.disposables.push(m),
      );
      pmrem.dispose();
    } catch {
      // Environment is cosmetic; the scene still renders with direct lights.
    }
  }

  private setupLights(): void {
    const key = new THREE.DirectionalLight(0xcfe2ec, 2.1);
    key.position.set(5, 7, 9);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x46627a, 0.7);
    fill.position.set(-7, 2, 5);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0x38dbe8, 1.0);
    rim.position.set(-3, -2, -7);
    this.scene.add(rim);

    const amb = new THREE.AmbientLight(0x223040, 0.55);
    this.scene.add(amb);
  }

  private buildVault(): {
    ledGreen: THREE.MeshStandardMaterial;
    ledAmber: THREE.MeshStandardMaterial;
    ledRed: THREE.MeshStandardMaterial;
    coreGlow: THREE.MeshStandardMaterial;
    coreLight: THREE.PointLight;
  } {
    const brushed = makeBrushedTexture();
    this.disposables.push(brushed);

    const steel = new THREE.MeshStandardMaterial({
      color: 0x96a2ae,
      metalness: 0.94,
      roughness: 0.42,
      roughnessMap: brushed,
      bumpMap: brushed,
      bumpScale: 0.6,
    });
    const darkSteel = new THREE.MeshStandardMaterial({
      color: 0x39424e,
      metalness: 0.88,
      roughness: 0.5,
      roughnessMap: brushed,
    });
    const gunmetal = new THREE.MeshStandardMaterial({
      color: 0x1d232c,
      metalness: 0.7,
      roughness: 0.62,
    });
    const edgeSteel = new THREE.MeshStandardMaterial({
      color: 0x6d7986,
      metalness: 0.95,
      roughness: 0.3,
    });
    this.disposables.push(steel, darkSteel, gunmetal, edgeSteel);

    /* Wall + frame ------------------------------------------------------- */
    const backPlate = new THREE.Mesh(
      new THREE.CylinderGeometry(3.1, 3.1, 0.6, 96),
      darkSteel,
    );
    backPlate.rotation.x = Math.PI / 2;
    backPlate.position.z = -0.75;
    this.scene.add(backPlate);

    const frameRing = new THREE.Mesh(
      new THREE.TorusGeometry(2.62, 0.3, 24, 120),
      steel,
    );
    frameRing.position.z = -0.18;
    this.scene.add(frameRing);

    // Hex bolts around the frame
    const hexGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.08, 6);
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const hex = new THREE.Mesh(hexGeo, gunmetal);
      hex.rotation.x = Math.PI / 2;
      hex.position.set(Math.cos(a) * 2.62, Math.sin(a) * 2.62, 0.13);
      this.scene.add(hex);
    }
    this.disposables.push(hexGeo);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(50, 50),
      new THREE.MeshStandardMaterial({
        color: 0x0a0d12,
        metalness: 0.2,
        roughness: 0.95,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -3.6;
    this.scene.add(floor);
    this.disposables.push(floor.geometry, floor.material as THREE.Material);

    /* Door (hinged at left edge) ---------------------------------------- */
    this.doorPivot.position.set(-2.4, 0, 0);
    this.scene.add(this.doorPivot);
    this.doorPivot.add(this.doorShaker);

    const doorDisc = new THREE.Mesh(
      new THREE.CylinderGeometry(2.36, 2.36, 0.46, 96),
      steel,
    );
    doorDisc.rotation.x = Math.PI / 2;
    doorDisc.position.set(2.4, 0, 0.18);
    this.doorShaker.add(doorDisc);

    const doorEdge = new THREE.Mesh(
      new THREE.TorusGeometry(2.36, 0.13, 20, 120),
      edgeSteel,
    );
    doorEdge.position.set(2.4, 0, 0.18);
    this.doorShaker.add(doorEdge);

    /* Lock bolts --------------------------------------------------------- */
    const boltGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.62, 20);
    this.disposables.push(boltGeo);
    const boltAngles = [0.35, Math.PI / 2 - 0.2, Math.PI + 0.2, -Math.PI / 2 + 0.1];
    for (const angle of boltAngles) {
      const dir = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
      const bolt = new THREE.Mesh(boltGeo, edgeSteel);
      bolt.rotation.z = angle + Math.PI / 2;
      bolt.userData.dir = dir;
      this.boltMeshes.push(bolt);
      this.doorShaker.add(bolt);
    }

    /* Combination dial ---------------------------------------------------- */
    this.dialGroup.position.set(3.35, -0.35, 0.5);
    this.doorShaker.add(this.dialGroup);

    const dialBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.78, 0.84, 0.22, 64),
      darkSteel,
    );
    dialBase.rotation.x = Math.PI / 2;
    this.dialGroup.add(dialBase);

    const dialFace = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.7, 0.1, 64),
      steel,
    );
    dialFace.rotation.x = Math.PI / 2;
    dialFace.position.z = 0.12;
    this.dialGroup.add(dialFace);

    // Knurled grip ring
    const knurlGeo = new THREE.BoxGeometry(0.035, 0.16, 0.1);
    this.disposables.push(knurlGeo);
    for (let i = 0; i < 56; i++) {
      const a = (i / 56) * Math.PI * 2;
      const k = new THREE.Mesh(knurlGeo, gunmetal);
      k.position.set(Math.cos(a) * 0.74, Math.sin(a) * 0.74, 0.12);
      k.rotation.z = a + Math.PI / 2;
      this.dialGroup.add(k);
    }

    // Graduation ticks
    const tickGeo = new THREE.BoxGeometry(0.022, 0.1, 0.03);
    this.disposables.push(tickGeo);
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const major = i % 5 === 0;
      const t = new THREE.Mesh(tickGeo, major ? edgeSteel : gunmetal);
      t.position.set(Math.cos(a) * 0.58, Math.sin(a) * 0.58, 0.19);
      t.rotation.z = a + Math.PI / 2;
      if (major) t.scale.set(1.5, 1.4, 1);
      this.dialGroup.add(t);
    }

    // Pointer mark on the door (static index mark above dial)
    const mark = new THREE.Mesh(
      new THREE.ConeGeometry(0.05, 0.14, 3),
      new THREE.MeshStandardMaterial({
        color: 0xf2b544,
        metalness: 0.4,
        roughness: 0.5,
        emissive: 0xf2b544,
        emissiveIntensity: 0.25,
      }),
    );
    mark.position.set(3.35, 0.62, 0.55);
    mark.rotation.z = Math.PI;
    this.doorShaker.add(mark);
    this.disposables.push(mark.geometry, mark.material as THREE.Material);

    // Spoke handle on the dial
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.16, 0.18, 24),
      edgeSteel,
    );
    hub.rotation.x = Math.PI / 2;
    hub.position.z = 0.22;
    this.dialGroup.add(hub);
    const spokeGeo = new THREE.CapsuleGeometry(0.035, 0.8, 6, 12);
    this.disposables.push(spokeGeo);
    for (let i = 0; i < 3; i++) {
      const spoke = new THREE.Mesh(spokeGeo, edgeSteel);
      spoke.position.z = 0.24;
      spoke.rotation.z = (i / 3) * Math.PI;
      this.dialGroup.add(spoke);
    }

    /* Iris --------------------------------------------------------------- */
    const irisCenter = new THREE.Vector3(2.4, 0.95, 0.44);
    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(-0.16, 0);
    bladeShape.lineTo(0.16, 0);
    bladeShape.quadraticCurveTo(0.34, -0.55, 0.1, -1.05);
    bladeShape.lineTo(-0.1, -1.05);
    bladeShape.quadraticCurveTo(-0.34, -0.55, -0.16, 0);
    const bladeGeo = new THREE.ShapeGeometry(bladeShape, 12);
    this.disposables.push(bladeGeo);
    const bladeMat = new THREE.MeshStandardMaterial({
      color: 0x2b333d,
      metalness: 0.85,
      roughness: 0.45,
      side: THREE.DoubleSide,
    });
    this.disposables.push(bladeMat);

    const irisRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.62, 0.07, 16, 72),
      edgeSteel,
    );
    irisRing.position.copy(irisCenter);
    this.doorShaker.add(irisRing);

    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const pivot = new THREE.Group();
      pivot.position.set(
        irisCenter.x + Math.cos(angle) * 0.58,
        irisCenter.y + Math.sin(angle) * 0.58,
        irisCenter.z - 0.02,
      );
      pivot.rotation.z = angle - Math.PI / 2;
      const blade = new THREE.Mesh(bladeGeo, bladeMat);
      blade.position.y = 0.06;
      pivot.add(blade);
      pivot.userData.baseAngle = angle - Math.PI / 2;
      this.irisPivots.push(pivot);
      this.doorShaker.add(pivot);
    }

    /* Glowing core behind the iris --------------------------------------- */
    const coreGlow = new THREE.MeshStandardMaterial({
      color: 0x0c2b30,
      emissive: COLORS.amber.clone(),
      emissiveIntensity: 0.25,
      roughness: 0.4,
      metalness: 0,
    });
    this.disposables.push(coreGlow);
    const core = new THREE.Mesh(new THREE.CircleGeometry(0.6, 48), coreGlow);
    core.position.set(irisCenter.x, irisCenter.y, irisCenter.z - 0.14);
    this.doorShaker.add(core);
    this.disposables.push(core.geometry);

    const coreLight = new THREE.PointLight(COLORS.amber.clone(), 0.4, 6, 2);
    coreLight.position.set(irisCenter.x, irisCenter.y, 0.9);
    this.doorShaker.add(coreLight);

    /* Indicator light panel ---------------------------------------------- */
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(1.15, 0.34, 0.09),
      gunmetal,
    );
    panel.position.set(2.4, -1.62, 0.46);
    this.doorShaker.add(panel);

    const ledGeo = new THREE.SphereGeometry(0.075, 20, 20);
    this.disposables.push(ledGeo);
    const mkLed = (color: THREE.Color, x: number) => {
      const mat = new THREE.MeshStandardMaterial({
        color: color.clone().multiplyScalar(0.25),
        emissive: color.clone(),
        emissiveIntensity: 0.05,
        roughness: 0.3,
        metalness: 0,
      });
      this.disposables.push(mat);
      const mesh = new THREE.Mesh(ledGeo, mat);
      mesh.position.set(x, -1.62, 0.53);
      this.doorShaker.add(mesh);
      return mat;
    };
    const ledRed = mkLed(COLORS.red, 1.95);
    const ledAmber = mkLed(COLORS.amber, 2.4);
    const ledGreen = mkLed(COLORS.green, 2.85);

    return { ledGreen, ledAmber, ledRed, coreGlow, coreLight };
  }

  /* ------------------------------------------------------------- public API */

  setPhase(phase: VaultPhase): void {
    if (phase === this.phase) return;
    const previous = this.phase;
    this.phase = phase;

    if (phase === "error") {
      this.shake = 1;
      this.dialVelocity += (Math.random() > 0.5 ? 1 : -1) * 3;
    }
    if (phase === "unlocking" && previous !== "open") {
      this.dialVelocity += 14;
    }
    if (this.reducedMotion) {
      this.snapToPhase(phase);
      this.renderOnce();
    }
  }

  /** Kick the combination dial — called for each typed character. */
  nudgeDial(direction: 1 | -1 = 1): void {
    if (this.reducedMotion) return;
    this.dialVelocity += direction * (1.4 + Math.random() * 1.6);
  }

  dispose(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.resizeObserver.disconnect();
    this.container.removeEventListener("pointermove", this.onPointerMove);
    this.container.removeEventListener("pointerleave", this.onPointerLeave);
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else if (material) material.dispose();
    });
    for (const d of this.disposables) {
      try {
        d.dispose();
      } catch {
        /* already disposed */
      }
    }
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }

  /* --------------------------------------------------------------- internals */

  private snapToPhase(phase: VaultPhase): void {
    this.current = { ...PHASE_TARGETS[phase] };
    this.apply();
  }

  private onPointerMove = (event: PointerEvent): void => {
    const rect = this.container.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = ((event.clientY - rect.top) / rect.height) * 2 - 1;
  };

  private onPointerLeave = (): void => {
    this.pointer.x = 0;
    this.pointer.y = 0;
  };

  private handleResize(): void {
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    // Pull the camera back on narrow (mobile) viewports so the door fits.
    const fit = width / height < 1 ? 1.45 : width / height < 1.5 ? 1.18 : 1;
    this.cameraBase.set(0.55 * fit, 0.3, 7.6 * fit);
    this.camera.updateProjectionMatrix();
    if (this.reducedMotion) this.renderOnce();
  }

  private loop = (): void => {
    this.rafId = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.elapsed += dt;
    this.step(dt);
    this.renderer.render(this.scene, this.camera);
  };

  private step(dt: number): void {
    const target = PHASE_TARGETS[this.phase];
    const k = 1 - Math.exp(-dt * 3.2); // frame-rate independent damping

    this.current.doorAngle += (target.doorAngle - this.current.doorAngle) * k;
    this.current.bolts += (target.bolts - this.current.bolts) * k;
    this.current.iris += (target.iris - this.current.iris) * k;
    this.current.glow += (target.glow - this.current.glow) * k;

    this.apply();

    // Dial dynamics: friction + idle drift
    this.dialVelocity *= Math.exp(-dt * 2.4);
    if (this.phase !== "open") {
      this.dialVelocity += Math.sin(this.elapsed * 0.6) * dt * 0.12;
    }
    this.dialGroup.rotation.z -= this.dialVelocity * dt;

    // Shake decay (rejected sign-in)
    if (this.shake > 0.001) {
      this.shake *= Math.exp(-dt * 5);
      this.doorShaker.position.x =
        Math.sin(this.elapsed * 60) * 0.035 * this.shake;
      this.doorShaker.position.y =
        Math.cos(this.elapsed * 47) * 0.02 * this.shake;
    } else {
      this.doorShaker.position.set(0, 0, 0);
    }

    // Status LED behavior
    const t = this.elapsed;
    const errorBlink = this.phase === "error" ? (Math.sin(t * 26) > 0 ? 1 : 0.05) : 0;
    const lockedBlink =
      this.phase === "locked" ? 0.35 + 0.65 * (Math.sin(t * 2.2) > 0.3 ? 1 : 0) : 0;
    const typingPulse =
      this.phase === "typing" ? 0.5 + 0.5 * Math.sin(t * 5) : 0;

    this.setLed(this.ledRed, errorBlink > 0 ? 2.4 : this.phase === "error" ? 0.2 : 0.02);
    this.setLed(
      this.ledAmber,
      this.phase === "open" || this.phase === "unlocking"
        ? 0.02
        : this.phase === "locked"
          ? 0.2 + lockedBlink * 1.6
          : this.phase === "typing"
            ? 0.6 + typingPulse * 1.2
            : 1.1,
    );
    this.setLed(
      this.ledGreen,
      this.phase === "open" || this.phase === "unlocking" ? 2.2 : 0.02,
    );

    // Core glow color/intensity by phase
    const targetColor =
      this.phase === "error"
        ? COLORS.red
        : this.phase === "open" || this.phase === "unlocking"
          ? COLORS.cyan
          : COLORS.amber;
    this.coreGlow.emissive.lerp(targetColor, 0.08);
    this.coreGlow.emissiveIntensity = this.current.glow;
    this.coreLight.color.lerp(targetColor, 0.08);
    this.coreLight.intensity = 0.25 + this.current.glow * 0.9;

    // Camera parallax (skipped under reduced motion)
    if (!this.reducedMotion) {
      const px = this.pointer.x * 0.5;
      const py = -this.pointer.y * 0.3;
      const drift = Math.sin(this.elapsed * 0.25) * 0.08;
      this.camera.position.x += (this.cameraBase.x + px + drift - this.camera.position.x) * (1 - Math.exp(-dt * 2));
      this.camera.position.y += (this.cameraBase.y + py - this.camera.position.y) * (1 - Math.exp(-dt * 2));
      this.camera.lookAt(0.4, 0, 0);
    }
  }

  /** Push `current` state into the scene graph. */
  private apply(): void {
    this.doorPivot.rotation.y = this.current.doorAngle;

    // Bolts slide radially in/out of the door edge.
    for (const bolt of this.boltMeshes) {
      const dir = bolt.userData.dir as THREE.Vector3;
      const extended = 2.44 + this.current.bolts * 0.16;
      bolt.position.set(
        2.4 + dir.x * extended,
        dir.y * extended,
        0.18,
      );
    }

    // Iris blades swing outward as `iris` goes 0 → 1.
    for (const pivot of this.irisPivots) {
      const base = pivot.userData.baseAngle as number;
      pivot.rotation.z = base + this.current.iris * 0.85;
    }
  }

  private setLed(mat: THREE.MeshStandardMaterial, intensity: number): void {
    mat.emissiveIntensity += (intensity - mat.emissiveIntensity) * 0.25;
  }

  private renderOnce(): void {
    this.step(0.016);
    this.renderer.render(this.scene, this.camera);
  }
}
