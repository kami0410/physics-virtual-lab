// 可换元件座：一个挂点（座）+ 几个可以装上去的元件（各有一个台面上的放置处）。
// 实验里用 mount.value 读“现在装的是哪个”（没装为 null），自动操作用 mount.set(v) 换装。
// 座在运动的部件上时传 follow()，每帧由 sync() 把挂点和装着的元件移到 follow() 给出的位置。
import * as THREE from 'three';
import { Component } from './Component.js';

export class Mount {
  /**
   * @param app
   * @param {object} o
   * @param {string} o.id 座的挂点 id
   * @param {string} o.label 座的名字（拖动时显示）
   * @param {THREE.Vector3} o.pos 座的位置（有 follow 时只是初值）
   * @param {Array<{key,name,value,object,icon?,desc?,group?,labelY?}>} o.items 可装的元件
   * @param {(i:number)=>THREE.Vector3} o.rest 第 i 个元件在台面上的放置处
   * @param {()=>THREE.Vector3} [o.follow] 座随部件运动时的位置
   * @param {number} [o.rotY] 装上去时元件的朝向
   * @param {boolean} [o.placeFirst] 一开始就把第一个元件装在座上（默认都在器材柜里）
   */
  constructor(app, { id, label, pos, items, rest, follow = null, rotY = 0, r = 2.5, snap = 8, restRotY = 0, restLabel = '台面', placeFirst = false }) {
    this.app = app; this.id = id; this.items = items; this.follow = follow;
    app.addSlot({ id, pos: pos.clone(), rotY, accepts: items.map((i) => i.key), label, r, snap });
    items.forEach((it, i) => {
      app.addSlot({ id: `${id}_r${i}`, pos: rest(i), rotY: restRotY, accepts: [it.key], label: restLabel, r: 3, snap: 8 });
      app.addComponent(new Component({ key: it.key, name: it.name, group: it.group, zone: 'slot', defaultSlot: id, object: it.object, labelY: it.labelY ?? 3, icon: it.icon, desc: it.desc, showLabel: it.showLabel, controls: it.controls, noFree: true }));
    });
    if (placeFirst) app.place(app.comp(items[0].key), { slot: id, silent: true });
  }
  get zone() { return this.app.zones.find((q) => q.id === this.id); }
  /** 装着的元件条目（没装为 null） */
  get item() { const z = this.zone, o = z && z.occupant; return o ? this.items.find((i) => i.key === o.key) : null; }
  get value() { const it = this.item; return it ? it.value : null; }
  /** 某个元件是不是这个座的 */
  owns(comp) { return !!comp && this.items.some((i) => i.key === comp.key); }
  sync() {
    if (!this.follow) return;
    const z = this.zone, a = this.app; if (!z) return;
    z.pos.copy(this.follow());
    if (z.marker) z.marker.position.copy(z.pos).y += 0.15;
    if (z.occupant && !(a.drag && a.drag.comp === z.occupant)) z.occupant.root.position.copy(z.pos);
  }
  /** 自动操作：换装成 value 为 v 的元件（v 为 null 时卸下放回台面） */
  async set(v, { anim = true } = {}) {
    const a = this.app, cur = this.item;
    if (cur && cur.value === v) return;
    if (cur) a.moveSlot(a.comp(cur.key), `${this.id}_r${this.items.indexOf(cur)}`, { silent: true });
    if (v == null) return;
    const it = this.items.find((i) => i.value === v); if (!it) return;
    this.sync();
    if (anim) await a.autoPut(it.key, this.id);
    else { const c = a.comp(it.key); if (c.placed) a.moveSlot(c, this.id, { silent: true }); else a.place(c, { slot: this.id, silent: true }); }
  }
}
