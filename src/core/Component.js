// 器材组件：可放置到导轨(rail)或固定插槽(slot)，可选中、拖动并在面板中调节
import * as THREE from 'three';

export class Component {
  /**
   * @param {object} o
   *  key, name, desc, icon, zone: 'rail'|'slot', slots?: [slotId], defaultPos, required,
   *  build(): THREE.Object3D, controls(): descriptor[], label(comp): string, movable
   */
  constructor(o) {
    Object.assign(this, { movable: true, required: false, desc: '' }, o);
    this.root = new THREE.Group();
    this.root.userData.component = this;
    if (o.object) this.root.add(o.object);
    this.placed = false;
    this.pos = o.defaultPos ?? 0; // 导轨位置 (cm)
    this.slot = null;
    this._hl = false;
  }

  /** 导轨读数（滑座刻线位置） */
  get x() { return this.pos; }

  setHighlight(on) {
    if (this._hl === on) return;
    this._hl = on;
    this.root.traverse((o) => {
      if (!o.isMesh || !o.material || o.userData.noHL) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m.emissive) continue;
        if (on) {
          if (m.userData._em == null) { m.userData._em = m.emissive.getHex(); m.userData._ei = m.emissiveIntensity; }
          if (m.userData._em === 0) { m.emissive.setHex(0x1d4ed8); m.emissiveIntensity = 0.35; }
        } else if (m.userData._em != null) {
          m.emissive.setHex(m.userData._em); m.emissiveIntensity = m.userData._ei;
          m.userData._em = null;
        }
      }
    });
  }
}
