// 收录自 geomagnetism 0.2.0（https://github.com/naturalatlas/geomagnetism，Apache-2.0，许可全文见 licenses/geomagnetism-LICENSE.txt）
// 修改：CommonJS 改写为 ES 模块。
export default MagneticVector;

function MagneticVector(options){
	this.bx = options.bx;
	this.by = options.by;
	this.bz = options.bz;
}

MagneticVector.prototype.rotate = function(coord_spherical, coord_geodetic) {
	var psi = Math.PI/180 * (coord_spherical.phig - coord_geodetic.phi);
	return new MagneticVector({
		bz: this.bx*Math.sin(psi) + this.bz*Math.cos(psi),
		bx: this.bx*Math.cos(psi) - this.bz*Math.sin(psi),
		by: this.by
	});
};